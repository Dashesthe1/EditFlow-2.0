from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

RUNTIME_DIR = Path(__file__).resolve().parents[1] / "packages" / "adapters" / "ae-cep" / "runtime"
sys.path.insert(0, str(RUNTIME_DIR))

from mcp import Client
from editgpt.controller.coordinates import CoordinateTransform
from editgpt.controller.semantic_pointer import choose_pointer_target
from editgpt.eyes.semantic import LocalQwenVLClient
from editgpt_tracker_visual_driver import EYES_URL, HANDS_URL, capture, exception_detail, frame_parts, parse_json_text, structured, target_patch_change, verify_visible
from editgpt_roto_brush_refine_edge_visual_driver import select_native_tool


def observe_state(qwen, image, source: str) -> dict:
    obs = qwen.observe(
        image,
        prompt=(
            "Inspect only visible pixels in the maximized Adobe After Effects Layer panel that is in Roto Brush view. "
            "Read the exact lower-right Freeze/Unfreeze control, the Roto Brush span/cache band, and any centered Roto Brush & Refine Edge progress dialog. "
            "Return only JSON with keys state, freezeControlText, frozenPurpleSpanVisible, freezeInProgress, progressText, confidence, evidence. "
            "state must be exactly FROZEN, UNFROZEN, or UNKNOWN. If a visible dialog says Freezing N of M (or otherwise visibly shows Freeze processing) "
            "and offers Stop, set freezeInProgress=true and state=UNKNOWN regardless of the disabled control behind it. If the control visibly reads Freeze and "
            "there is no continuous purple/magenta cached band across a substantial horizontal portion of the Roto span, state must be UNFROZEN. "
            "If the control visibly reads Unfreeze, state must be FROZEN. A small magenta square/icon, stroke-color swatch, cursor, or isolated purple UI accent "
            "is NOT a frozen cache band. Use UNKNOWN if the relevant visible state cannot be read. Do not infer from prior actions or After Effects knowledge."
        ),
        source=source,
        max_tokens=260,
        max_width=image.shape[1],
        jpeg_quality=96,
    )
    payload = parse_json_text(obs.text)
    control = str(payload.get("freezeControlText") or "").strip().lower()
    purple = bool(payload.get("frozenPurpleSpanVisible"))
    progress = bool(payload.get("freezeInProgress"))
    if progress:
        payload["state"] = "UNKNOWN"
    elif control == "unfreeze":
        payload["state"] = "FROZEN"
    elif control == "freeze" and purple:
        payload["state"] = "FROZEN"
    elif control == "freeze":
        payload["state"] = "UNFROZEN"
    else:
        payload["state"] = "UNKNOWN"
    payload["semantic"] = obs.as_dict()
    return payload


def ground_freeze(qwen, image, source: str):
    target, obs = choose_pointer_target(
        image,
        instruction=(
            "Use only visible pixels in the MAXIMIZED active Adobe After Effects Layer panel in Roto Brush view. "
            "Point to the actual Freeze/Unfreeze control at the lower-right of that Layer panel. "
            "Do not point to Reset Exposure, exposure percentage, color-management/view buttons, span handles, browser controls, or anything outside the Layer panel. "
            "If the actual Freeze control is not visibly identifiable, return confidence below 0.25 rather than guessing."
        ),
        client=qwen,
        min_confidence=0.0,
    )
    return target, obs


async def wait_for_roto_state(qwen, eyes, hands, evidence_dir: Path, desired_state: str, label: str, timeout_s: float, poll_interval_s: float):
    loop = asyncio.get_running_loop()
    started = loop.time()
    deadline = started + timeout_s
    samples = []
    attempt = 0
    while loop.time() < deadline:
        await asyncio.sleep(poll_interval_s)
        attempt += 1
        latest = await eyes.call_tool("eyes_latest_frame", {"max_width": 1280, "jpeg_quality": 94})
        if latest.is_error:
            raise RuntimeError(f"{label} visual watcher could not capture AE")
        _meta, image, _ = frame_parts(latest)
        observed = observe_state(qwen, image, f"{label}_poll_{attempt}")
        samples.append({
            "elapsedSeconds": round(loop.time() - started, 3),
            "state": observed.get("state"),
            "freezeInProgress": bool(observed.get("freezeInProgress")),
            "progressText": observed.get("progressText"),
            "freezeControlText": observed.get("freezeControlText"),
            "frozenPurpleSpanVisible": bool(observed.get("frozenPurpleSpanVisible")),
            "confidence": float(observed.get("confidence") or 0.0),
        })
        if (not observed.get("freezeInProgress") and observed.get("state") == desired_state and float(observed.get("confidence") or 0.0) >= 0.85):
            _final_meta, final_image = await capture(eyes, hands, evidence_dir, label)
            final_state = observe_state(qwen, final_image, f"{label}_final")
            if (not final_state.get("freezeInProgress") and final_state.get("state") == desired_state and float(final_state.get("confidence") or 0.0) >= 0.85):
                return final_image, final_state, samples
    last = samples[-1] if samples else {}
    raise RuntimeError(f"{label} timed out waiting for visible {desired_state}: {last}")


async def run(evidence_dir: Path, expected_layer_name: str, tool_select_script: str) -> dict:
    evidence_dir.mkdir(parents=True, exist_ok=True)
    qwen = LocalQwenVLClient()
    if not qwen.health().get("ok"):
        raise RuntimeError("local semantic verifier unavailable")
    proof = {}
    async with Client(EYES_URL) as eyes, Client(HANDS_URL) as hands:
        armed = await hands.call_tool("hands_arm", {})
        if armed.is_error:
            raise RuntimeError("Hands could not arm")
        started_here = False
        maximized = False
        try:
            started = await eyes.call_tool("eyes_start_live", {"fps": 30, "buffer_seconds": 0.7})
            if started.is_error:
                raise RuntimeError("Eyes could not start")
            started_here = bool(structured(started).get("started", False))
            focused = await hands.call_tool("hands_focus_after_effects", {})
            if focused.is_error:
                raise RuntimeError("After Effects could not be focused")
            await hands.call_tool("hands_keypress", {"keys": ["ESC"]})
            await asyncio.sleep(0.12)
            meta, initial = await capture(eyes, hands, evidence_dir, "freeze_state_initial")
            h, w = initial.shape[:2]
            status = structured(await hands.call_tool("hands_status", {}))
            transform = CoordinateTransform.from_status(meta, status)
            layer_tab, layer_tab_obs = choose_pointer_target(
                initial,
                instruction=(
                    f"Point to the visible Adobe After Effects VIEWER TAB for exact target layer '{expected_layer_name}' so clicking it activates that Layer viewer. "
                    "Target the tab label/header itself, not the footage canvas, project item, timeline layer row, Effect Controls, Composition tab, close button, or panel menu. "
                    "If the exact target Layer viewer tab is not visibly identifiable, return confidence below 0.25 rather than guessing."
                ),
                client=qwen,
                min_confidence=0.0,
            )
            proof["layerTabActivationPointer"] = layer_tab_obs.as_dict()
            proof["layerTabActivationTarget"] = {
                "x": int(layer_tab.x),
                "y": int(layer_tab.y),
                "confidence": float(layer_tab.confidence),
                "target": layer_tab.target,
            }
            tab_x, tab_y = int(layer_tab.x), int(layer_tab.y)
            tab_label = str(layer_tab.target or "").lower()
            if (
                layer_tab.confidence < 0.90
                or expected_layer_name.lower() not in tab_label
                or "tab" not in tab_label
                or tab_x < int(w * 0.40)
                or tab_x > int(w * 0.95)
                or tab_y < int(h * 0.06)
                or tab_y > int(h * 0.30)
            ):
                raise RuntimeError(
                    f"exact target Layer viewer tab could not be safely grounded before activation: target={layer_tab.target!r} x={tab_x} y={tab_y} confidence={layer_tab.confidence:.3f}"
                )
            tab_sx, tab_sy = transform.encoded_to_screen(tab_x, tab_y)
            tab_clicked = await hands.call_tool("hands_click", {"x": tab_sx, "y": tab_sy, "button": "left", "count": 1})
            if tab_clicked.is_error:
                raise RuntimeError("Hands could not activate the exact target Layer viewer tab")
            proof["layerTabActivated"] = True
            # Clicking an already-active Layer viewer tab can open AE's viewer-selector menu
            # instead of changing focus. Dismiss that reversible menu before native tool
            # selection/maximize so GRAVE is delivered to the verified Layer panel.
            dismissed = await hands.call_tool("hands_keypress", {"keys": ["ESC"]})
            if dismissed.is_error:
                raise RuntimeError("Hands could not dismiss the Layer viewer selector after tab activation")
            proof["layerViewerSelectorDismissed"] = True
            await asyncio.sleep(0.08)
            tool_select = select_native_tool("", tool_select_script, "ROTO_BRUSH")
            proof["rotoBrushToolSelection"] = tool_select
            await asyncio.sleep(0.08)
            meta, initial = await capture(eyes, hands, evidence_dir, "freeze_state_layer_activated")
            h, w = initial.shape[:2]
            status = structured(await hands.call_tool("hands_status", {}))
            transform = CoordinateTransform.from_status(meta, status)
            ready, ready_evidence = verify_visible(
                qwen,
                initial,
                f"The exact Adobe After Effects Layer viewer for target layer '{expected_layer_name}' is visibly selected/open and its Roto Brush span/footer UI is visibly present. Judge the target Layer viewer itself. A separate non-active Composition viewer elsewhere in the workspace is allowed and must not invalidate this check. Reject only if the exact target Layer tab/content is absent, Layer (none), a different layer, or the target Layer viewer is not in Roto Brush view.",
                "m5_freeze_state_layer_ready_after_activation",
            )
            proof["layerReady"] = ready_evidence
            if not ready:
                raise RuntimeError("exact Roto Brush Layer viewer content was not verified after explicit tab activation")
            panel_hover, panel_hover_obs = choose_pointer_target(
                initial,
                instruction=(
                    f"Point well INSIDE the visible footage canvas of the active Adobe After Effects Layer viewer for exact target layer '{expected_layer_name}'. "
                    "The point must be on the displayed footage/image area inside that Layer panel, not on the Layer tab strip, tab menu, close button, Roto span/timeline, "
                    "Effect Controls, Composition (none), Preview, Properties, or any other panel. This is only to place the mouse over the Layer panel before the Grave/Tilde maximize shortcut; do not target any clickable control."
                ),
                client=qwen,
                min_confidence=0.0,
            )
            proof["layerPanelBodyHover"] = panel_hover_obs.as_dict()
            proof["layerPanelBodyHoverTarget"] = {
                "x": int(panel_hover.x),
                "y": int(panel_hover.y),
                "confidence": float(panel_hover.confidence),
                "target": panel_hover.target,
            }
            px, py = int(panel_hover.x), int(panel_hover.y)
            if (panel_hover.confidence < 0.85 or px < int(w * 0.60) or px > int(w * 0.86) or py < int(h * 0.18) or py > int(h * 0.62)):
                raise RuntimeError(f"Layer panel body could not be safely grounded before maximize: target={panel_hover.target!r} x={px} y={py} confidence={panel_hover.confidence:.3f}")
            sx, sy = transform.encoded_to_screen(px, py)
            moved = await hands.call_tool("hands_move", {"x": sx, "y": sy})
            if moved.is_error:
                raise RuntimeError("Hands could not move inside the verified target Layer panel")
            await asyncio.sleep(0.05)
            toggled = await hands.call_tool("hands_keypress", {"keys": ["GRAVE"]})
            if toggled.is_error:
                raise RuntimeError("Hands could not maximize target Layer panel")
            maximized = True
            await asyncio.sleep(0.45)
            max_meta, before = await capture(eyes, hands, evidence_dir, "freeze_state_before")
            if meta.get("geometry") != max_meta.get("geometry"):
                raise RuntimeError("Eyes geometry changed while maximizing Layer panel")
            maximized_ok, maximized_evidence = verify_visible(
                qwen,
                before,
                f"The Adobe After Effects Layer viewer for exact target layer '{expected_layer_name}' is now maximized across the main workspace, still in Roto Brush view, and the lower-right Freeze or Unfreeze control is visibly readable. Reject Composition (none), Layer (none), split multi-panel layouts, or a Layer viewer where the Freeze/Unfreeze control is not visible.",
                "m5_freeze_state_layer_maximized",
            )
            proof["maximizedLayerVerified"] = maximized_evidence
            if not maximized_ok:
                raise RuntimeError("grave toggle did not produce a verified maximized Roto Brush Layer panel with visible Freeze control")
            proof["maximizedViaVerifiedLayerToggle"] = True
            before_state = observe_state(qwen, before, "m5_freeze_state_before_observation")
            proof["beforeState"] = before_state
            if before_state.get("state") != "UNFROZEN" or float(before_state.get("confidence") or 0.0) < 0.85:
                raise RuntimeError(f"FREEZE refused from unexpected visible state: {before_state.get('state')}")
            target, pointer_obs = ground_freeze(qwen, before, "m5_freeze_button_ground_before")
            proof["freezePointerBefore"] = {
                **pointer_obs.as_dict(),
                "bboxPixels": list(target.bbox_pixels) if target.bbox_pixels is not None else None,
            }
            if target.confidence < 0.85 or "freeze" not in target.target.lower():
                raise RuntimeError("actual Freeze control was not visually grounded after maximizing Layer panel")
            if target.x > int(w * 0.84) or target.y < int(h * 0.45):
                raise RuntimeError("grounded Freeze target fell outside retained After Effects Layer-panel bounds")

            # A successful SendInput call only proves that Windows accepted a click, not that
            # After Effects consumed it as Freeze. Use the grounded button box to choose safe
            # interior points and require immediate visible Freeze progress/state before the
            # long native-processing watcher is allowed to run.
            click_candidates: list[tuple[int, int]] = []
            if target.bbox_pixels is not None:
                x1, y1, x2, y2 = target.bbox_pixels
                center_x = int(round((x1 + x2) / 2.0))
                center_y = int(round((y1 + y2) / 2.0))
                lower_y = min(y2 - 1, int(round(y1 + (y2 - y1) * 0.70)))
                click_candidates.extend([(center_x, center_y), (center_x, lower_y)])
            click_candidates.append((int(target.x), int(target.y)))
            click_candidates = list(dict.fromkeys(click_candidates))

            initiation_samples: list[dict[str, object]] = []
            initiated: tuple[int, int, int, int] | None = None
            for attempt, (encoded_x, encoded_y) in enumerate(click_candidates[:2], start=1):
                if encoded_x > int(w * 0.84) or encoded_y < int(h * 0.45):
                    raise RuntimeError("Freeze button interior candidate fell outside retained Layer-panel bounds")
                screen_x, screen_y = transform.encoded_to_screen(encoded_x, encoded_y)
                clicked = await hands.call_tool("hands_click", {"x": screen_x, "y": screen_y, "button": "left", "count": 1})
                if clicked.is_error:
                    raise RuntimeError("Hands could not click grounded Freeze control")
                await asyncio.sleep(0.75)
                latest = await eyes.call_tool("eyes_latest_frame", {"max_width": 1280, "jpeg_quality": 94})
                if latest.is_error:
                    raise RuntimeError("Freeze initiation verifier could not capture AE")
                _init_meta, init_image, _ = frame_parts(latest)
                init_state = observe_state(qwen, init_image, f"m5_freeze_initiation_attempt_{attempt}")
                sample = {
                    "attempt": attempt,
                    "encoded": {"x": encoded_x, "y": encoded_y},
                    "screen": {"x": screen_x, "y": screen_y},
                    "state": init_state.get("state"),
                    "freezeInProgress": bool(init_state.get("freezeInProgress")),
                    "freezeControlText": init_state.get("freezeControlText"),
                    "frozenPurpleSpanVisible": bool(init_state.get("frozenPurpleSpanVisible")),
                    "confidence": float(init_state.get("confidence") or 0.0),
                }
                initiation_samples.append(sample)
                if bool(init_state.get("freezeInProgress")) or (
                    init_state.get("state") == "FROZEN" and float(init_state.get("confidence") or 0.0) >= 0.85
                ):
                    initiated = (encoded_x, encoded_y, screen_x, screen_y)
                    break
                if init_state.get("state") != "UNFROZEN" or float(init_state.get("confidence") or 0.0) < 0.85:
                    raise RuntimeError(f"Freeze initiation became ambiguous after click: {sample}")
            proof["freezeInitiationSamples"] = initiation_samples
            if initiated is None:
                raise RuntimeError(f"Freeze click did not initiate visible processing/state change: {initiation_samples}")
            freeze_x, freeze_y, fx, fy = initiated
            proof["verifiedFreezeClick"] = {
                "encoded": {"x": freeze_x, "y": freeze_y},
                "screen": {"x": fx, "y": fy},
                "method": "semantic_bbox_interior_with_visible_state_acknowledgement",
            }
            frozen_image, frozen_state, freeze_wait = await wait_for_roto_state(
                qwen, eyes, hands, evidence_dir, "FROZEN", "freeze_state_after_freeze", 240.0, 8.0
            )
            proof["freezeWait"] = freeze_wait
            proof["afterFreezeState"] = frozen_state
            # Adobe uses the same Freeze button to unfreeze. Reuse the exact screen point that
            # successfully initiated Freeze instead of semantically reacquiring through the
            # frozen-state cache tooltip, which can obscure or shift the apparent target.
            proof["unfreezeTargetReuse"] = {
                "method": "reuse_verified_freeze_button_coordinate",
                "encoded": {"x": freeze_x, "y": freeze_y},
                "screen": {"x": fx, "y": fy},
            }
            moved_away = await hands.call_tool("hands_move", {"x": sx, "y": sy})
            if moved_away.is_error:
                raise RuntimeError("Hands could not dismiss the frozen-state Freeze tooltip before UNFREEZE")
            await asyncio.sleep(0.10)
            unclicked = await hands.call_tool("hands_click", {"x": fx, "y": fy, "button": "left", "count": 1})
            if unclicked.is_error:
                raise RuntimeError("Hands could not click the verified Freeze control for UNFREEZE")
            unfrozen_image, unfrozen_state, unfreeze_wait = await wait_for_roto_state(
                qwen, eyes, hands, evidence_dir, "UNFROZEN", "freeze_state_after_unfreeze", 40.0, 1.0
            )
            proof["unfreezeWait"] = unfreeze_wait
            proof["afterUnfreezeState"] = unfrozen_state
            return {
                "ok": True,
                "status": "COMPLETED",
                "beforeState": before_state,
                "afterFreezeState": frozen_state,
                "afterUnfreezeState": unfrozen_state,
                "freezeTarget": {"x": freeze_x, "y": freeze_y, "confidence": float(target.confidence), "target": target.target, "visibleStateAcknowledged": True},
                "unfreezeTarget": {"x": freeze_x, "y": freeze_y, "confidence": float(target.confidence), "target": target.target, "reusedVerifiedCoordinate": True},
                "proof": proof,
                "beforeFrame": str((evidence_dir / "freeze_state_before.jpg").resolve()),
                "frozenFrame": str((evidence_dir / "freeze_state_after_freeze.jpg").resolve()),
                "unfrozenFrame": str((evidence_dir / "freeze_state_after_unfreeze.jpg").resolve()),
            }
        finally:
            if maximized:
                await hands.call_tool("hands_keypress", {"keys": ["GRAVE"]})
                await asyncio.sleep(0.25)
            if started_here:
                await eyes.call_tool("eyes_stop_live", {})
            await hands.call_tool("hands_disarm", {})


def main():
    parser = argparse.ArgumentParser(description="M5 proof-owned Freeze/Unfreeze visible-state discovery")
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--expected-layer-name", required=True)
    parser.add_argument("--tool-select-script", required=True)
    args = parser.parse_args()
    result_path = Path(args.result).resolve()
    try:
        result = asyncio.run(run(Path(args.evidence_dir).resolve(), args.expected_layer_name, args.tool_select_script))
    except Exception as exc:
        result = {"ok": False, "status": "REFUSED", "failure": exception_detail(exc)}
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") is True else 2


if __name__ == "__main__":
    raise SystemExit(main())
