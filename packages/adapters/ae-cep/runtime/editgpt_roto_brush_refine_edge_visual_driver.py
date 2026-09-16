from __future__ import annotations

import argparse
import asyncio
import json
import math
import urllib.request
import tempfile
import time
from pathlib import Path

from mcp import Client
from editgpt.controller.coordinates import CoordinateTransform
from editgpt.eyes.semantic import LocalQwenVLClient

from editgpt_tracker_visual_driver import (
    EYES_URL,
    HANDS_URL,
    capture,
    exception_detail,
    frame_parts,
    guarded_click_target,
    literal_label,
    parse_json_text,
    structured,
    target_patch_change,
    verify_visible,
)
from editgpt_roto_brush_seed_visual_driver import (
    encoded_stroke_path,
    locate_layer_canvas,
    screen_stroke_path,
    verify_target_binding,
)

SCHEMA = "editflow.roto-brush-refine-edge.visual.v1"
DRIVER_ID = "editgpt.eyes-hands.roto-brush-refine-edge.v1"


def validate_stroke(stroke) -> None:
    if not isinstance(stroke, dict) or stroke.get("role") != "REFINE_EDGE":
        raise ValueError("stroke.role must be REFINE_EDGE")
    points = stroke.get("pointsNormalized")
    if not isinstance(points, list) or len(points) < 2 or len(points) > 128:
        raise ValueError("stroke requires between 2 and 128 normalized points")
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("stroke points must be objects")
        for key in ("x", "y"):
            value = point.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)) or not 0 <= value <= 1:
                raise ValueError(f"stroke point {key} must be finite in [0,1]")
    radius = stroke.get("radiusNormalized")
    if isinstance(radius, bool) or not isinstance(radius, (int, float)) or not math.isfinite(float(radius)) or not 0 < radius <= 0.25:
        raise ValueError("radiusNormalized must be in (0,0.25]")


def validate_request(value: dict) -> dict:
    if value.get("schema") != SCHEMA or value.get("operation") != "REFINE_EDGE":
        raise ValueError("unsupported Refine Edge request schema or operation")
    for key in ("compHostId", "layerHostId"):
        if not isinstance(value.get(key), int) or value[key] <= 0:
            raise ValueError(f"{key} must be a positive integer")
    for key in ("expectedCompName", "expectedLayerName", "expectedSessionRevision", "expectedEffectFingerprint"):
        if not isinstance(value.get(key), str) or not value[key].strip():
            raise ValueError(f"{key} must be a non-empty string")
    if value.get("expectedEffectMatchCount") != 1:
        raise ValueError("Refine Edge requires exactly one native Roto effect")
    if value.get("expectedTool") != "REFINE_EDGE":
        raise ValueError("expectedTool must be REFINE_EDGE")
    at_time = value.get("atTime")
    if isinstance(at_time, bool) or not isinstance(at_time, (int, float)) or not math.isfinite(float(at_time)) or at_time < 0:
        raise ValueError("atTime must be finite and non-negative")
    evidence = value.get("evidenceIds")
    if not isinstance(evidence, list) or not evidence or not all(isinstance(item, str) and item.strip() for item in evidence):
        raise ValueError("evidenceIds must contain at least one non-empty string")
    validate_stroke(value.get("stroke"))
    return value


def target_binding(request: dict) -> dict:
    return {key: request[key] for key in (
        "operation", "compHostId", "layerHostId", "expectedCompName", "expectedLayerName",
        "expectedSessionRevision", "expectedEffectFingerprint", "expectedEffectMatchCount", "atTime",
        "stroke", "expectedTool", "evidenceIds",
    )}


def inspect_error_popup(qwen, image, source: str = "m5_roto_refine_modal_inspection") -> dict:
    observation = qwen.observe(
        image,
        prompt=(
            "Inspect only the visible Adobe After Effects UI for a SEPARATE MODAL error or warning dialog that overlays and blocks normal editor interaction. "
            "A docked panel, inline banner, status message, tooltip, tab, or the EditFlow Bridge message 'Local runtime unavailable: Failed to fetch' is NOT a modal dialog. "
            "Return only JSON with keys visible, isModalDialog, blocksEditorUI, message, acknowledgementOnly, buttonLabel, confidence. "
            "Set visible=false unless a distinct floating dialog box is visibly present. Transcribe visible dialog text briefly and exactly enough to diagnose it. "
            "acknowledgementOnly is true only when that same modal dialog has a single harmless OK or Close acknowledgement action."
        ),
        source=source,
        max_tokens=220,
        max_width=image.shape[1],
        jpeg_quality=92,
    )
    payload = parse_json_text(observation.text)
    payload["semantic"] = observation.as_dict()
    return payload


def qualified_modal(popup: dict) -> bool:
    try:
        confidence = float(popup.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    message = str(popup.get("message") or "").strip()
    return bool(popup.get("visible")) and bool(popup.get("isModalDialog")) and bool(popup.get("blocksEditorUI")) and confidence >= 0.90 and len(message) >= 3


async def refuse_modal_if_present(eyes, hands, qwen, output: Path, image, proof: dict) -> None:
    popup = inspect_error_popup(qwen, image)
    proof["modalInspection"] = popup
    if not bool(popup.get("visible")):
        return
    if not qualified_modal(popup):
        confirmation = inspect_error_popup(qwen, image, "m5_roto_refine_modal_confirmation")
        proof["modalConfirmation"] = confirmation
        if not qualified_modal(confirmation):
            proof["modalFalsePositiveRejected"] = True
            return
        popup = confirmation
    message = str(popup.get("message") or "After Effects displayed an error dialog").strip()
    label = str(popup.get("buttonLabel") or "").strip()
    if bool(popup.get("acknowledgementOnly")) and label.lower() in {"ok", "close"}:
        try:
            proof["modalAcknowledgement"] = await guarded_click_target(
                eyes, hands, qwen, output,
                f"Point to the single {literal_label(label)} acknowledgement button in the currently visible separate modal After Effects dialog containing {literal_label(message)}.",
                "roto_refine_modal_ack",
            )
        except Exception as exc:
            raise RuntimeError(f"After Effects modal error after Refine Edge stroke: {message}; acknowledgement could not be safely grounded: {exception_detail(exc)}") from exc
    raise RuntimeError(f"After Effects modal error after Refine Edge stroke: {message}")


def select_native_tool(_afterfx_path: str, tool_select_script: str, tool: str) -> dict:
    request_path = Path(tempfile.gettempdir()) / "EditFlow2-m5-roto-brush-tool-select-request.json"
    response_path = Path(tempfile.gettempdir()) / "EditFlow2-m5-roto-brush-tool-select-response.json"
    response_path.unlink(missing_ok=True)
    request_id = f"M5_TOOL_{tool}_{time.time_ns()}"
    request_path.write_text(json.dumps({"schema": "editflow.roto-brush-tool-select.v1", "requestId": request_id, "tool": tool}) + "\n", encoding="utf-8")
    started = time.perf_counter()
    payload = json.dumps({"scriptPath": tool_select_script}).encode("utf-8")
    dispatch_request = urllib.request.Request(
        "http://127.0.0.1:32146/proof-script",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(dispatch_request, timeout=2.0) as dispatch_response:
            dispatch = json.loads(dispatch_response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Warm CEP native {tool} tool selection dispatch failed: {exception_detail(exc)}") from exc
    if dispatch.get("ok") is not True:
        raise RuntimeError(f"Warm CEP native {tool} tool selection dispatch was refused")
    deadline = time.monotonic() + 0.75
    while time.monotonic() < deadline:
        if response_path.is_file() and response_path.stat().st_size > 0:
            response = json.loads(response_path.read_text(encoding="utf-8-sig"))
            break
        time.sleep(0.005)
    else:
        raise RuntimeError(f"Warm CEP native {tool} tool selection timed out waiting for correlated readback")
    elapsed_ms = max(0.0, (time.perf_counter() - started) * 1000.0)
    if response.get("schema") != "editflow.roto-brush-tool-select.v1" or response.get("requestId") != request_id:
        raise RuntimeError("After Effects native tool selector correlation mismatch")
    if response.get("ok") is not True or response.get("tool") != tool:
        raise RuntimeError(str(response.get("error") or f"After Effects refused native {tool} tool selection"))
    expected_tool_type = "9041" if tool == "ROTO_BRUSH" else "9042" if tool == "REFINE_EDGE" else None
    if expected_tool_type is None or str(response.get("toolType")) != expected_tool_type:
        raise RuntimeError(f"After Effects native {tool} toolType mismatch: {response.get('toolType')}")
    return {**response, "roundtripMs": elapsed_ms, "dispatchTransport": "WARM_CEP"}


async def run(request: dict, output: Path, afterfx_path: str, tool_select_script: str) -> dict:
    request = validate_request(request)
    qwen = LocalQwenVLClient()
    if not qwen.health().get("ok"):
        raise RuntimeError("local EditGPT semantic model is not ready")
    proof: dict[str, object] = {"driverId": DRIVER_ID, "targetBinding": target_binding(request)}
    latencies: list[float] = []
    async with Client(EYES_URL) as eyes, Client(HANDS_URL) as hands:
        armed = await hands.call_tool("hands_arm", {})
        if armed.is_error:
            raise RuntimeError("EditGPT Hands could not arm")
        started_here = False
        maximized_here = False
        try:
            started = await eyes.call_tool("eyes_start_live", {"fps": 30, "buffer_seconds": 0.7})
            if started.is_error:
                raise RuntimeError("EditGPT Eyes could not start")
            started_here = bool(structured(started).get("started", False))
            focused = await hands.call_tool("hands_focus_after_effects", {})
            if focused.is_error:
                raise RuntimeError("After Effects could not be focused before Refine Edge")
            await hands.call_tool("hands_keypress", {"keys": ["ESC"]})
            await asyncio.sleep(0.12)
            canvas_meta, canvas_image = await capture(eyes, hands, output, "refine_layer_viewer_ready")
            bound, binding_evidence = verify_target_binding(qwen, canvas_image, request, "m5_roto_refine_binding_pre")
            proof["targetBindingPre"] = binding_evidence
            if not bound:
                raise RuntimeError("visible AE state does not match the typed Refine Edge target")
            layer_ready, layer_evidence = verify_visible(
                qwen, canvas_image,
                f"The active After Effects viewer is the Layer tab for exact target layer {literal_label(request['expectedLayerName'])}, with that layer image visibly displayed. Reject Layer (none), a Composition viewer, a different layer, or a Project item.",
                "m5_roto_refine_layer_viewer_ready",
            )
            proof["layerViewerReady"] = layer_evidence
            if not layer_ready:
                raise RuntimeError("exact target Layer viewer was not visually verified")
            try:
                bounds, canvas_ground = locate_layer_canvas(qwen, canvas_image, request)
            except RuntimeError as exc:
                if "Layer canvas bounding box is implausibly small" not in str(exc):
                    raise
                proof["smallLayerCanvasDetected"] = str(exc)
                proof["layerTabFocusBeforeMaximize"] = await guarded_click_target(
                    eyes, hands, qwen, output,
                    f"Point to the active After Effects Layer viewer tab whose visible label is exactly Layer {literal_label(request['expectedLayerName'])}. Do not point to Effect Controls, Composition, Project, Preview, or another tab.",
                    "refine_layer_tab_focus",
                )
                toggled = await hands.call_tool("hands_keypress", {"keys": ["GRAVE"]})
                if toggled.is_error:
                    raise RuntimeError("Hands could not maximize the verified Refine Edge Layer viewer")
                maximized_here = True
                await asyncio.sleep(0.12)
                canvas_meta, canvas_image = await capture(eyes, hands, output, "refine_layer_viewer_maximized")
                rebound, rebound_evidence = verify_target_binding(qwen, canvas_image, request, "m5_roto_refine_binding_maximized")
                proof["targetBindingMaximized"] = rebound_evidence
                if not rebound:
                    raise RuntimeError("typed Refine Edge target changed after maximizing the Layer viewer")
                bounds, canvas_ground = locate_layer_canvas(qwen, canvas_image, request)
                proof["layerViewerMaximized"] = True
            proof["layerCanvas"] = {**canvas_ground, "bounds": list(bounds)}

            # Roto Brush may continue repainting the Layer image briefly after a seed stroke.
            # Lease only the local frame geometry until two consecutive frames settle; do not
            # re-enter semantic reasoning between these micro-observations.
            action_meta = canvas_meta
            action_image = canvas_image
            stabilization_changes: list[float] = []
            stable_frames = 0
            for _attempt in range(20):
                await asyncio.sleep(0.10)
                latest = await eyes.call_tool("eyes_latest_frame", {"max_width": 1280, "jpeg_quality": 92})
                if latest.is_error:
                    raise RuntimeError("freshness capture failed while waiting for Refine Edge Layer stability")
                latest_meta, latest_image, _ = frame_parts(latest)
                if canvas_meta.get("geometry") != latest_meta.get("geometry"):
                    raise RuntimeError("Eyes geometry changed while waiting for Refine Edge Layer stability")
                canvas_change = target_patch_change(action_image, latest_image, bounds)
                stabilization_changes.append(float(canvas_change))
                action_meta, action_image = latest_meta, latest_image
                if canvas_change <= 0.16:
                    stable_frames += 1
                    if stable_frames >= 2:
                        break
                else:
                    stable_frames = 0
            if stable_frames < 2:
                last_change = stabilization_changes[-1] if stabilization_changes else 1.0
                raise RuntimeError(f"Layer canvas did not settle before Refine Edge tool selection ({last_change:.3f})")
            proof["canvasStabilization"] = {
                "method": "local_frame_stability_lease",
                "changes": stabilization_changes,
                "requiredConsecutiveStableFrames": 2,
                "threshold": 0.16,
            }
            settled_bound, settled_evidence = verify_target_binding(
                qwen, action_image, request, "m5_roto_refine_binding_stable"
            )
            proof["targetBindingStable"] = settled_evidence
            if not settled_bound:
                raise RuntimeError("typed Roto Brush target changed while waiting for Refine Edge Layer stability")
            bounds, settled_canvas_ground = locate_layer_canvas(qwen, action_image, request)
            proof["layerCanvasSettled"] = {**settled_canvas_ground, "bounds": list(bounds)}
            encoded = encoded_stroke_path(request["stroke"], bounds)

            status = structured(await hands.call_tool("hands_status", {}))
            tool_started = time.perf_counter()
            tool_select = select_native_tool(afterfx_path, tool_select_script, "REFINE_EDGE")
            tool_finished = time.perf_counter()
            await asyncio.sleep(0.03)
            tool_meta, tool_image = await capture(eyes, hands, output, "refine_edge_tool_selected")
            if action_meta.get("geometry") != tool_meta.get("geometry"):
                raise RuntimeError("Eyes geometry changed after native Refine Edge tool selection")
            h, w = action_image.shape[:2]
            toolbar_bounds = (0, int(h * 0.06), int(w * 0.44), int(h * 0.17))
            toolbar_change = target_patch_change(action_image, tool_image, toolbar_bounds)
            tool_canvas_change = target_patch_change(action_image, tool_image, bounds)
            if tool_canvas_change > 0.16:
                raise RuntimeError(f"Layer canvas changed before the Refine Edge stroke ({tool_canvas_change:.3f})")
            proof["toolSelection"] = {
                **tool_select,
                "toolbarBounds": list(toolbar_bounds),
                "toolbarChangedFraction": toolbar_change,
                "toolIdentityAuthority": "verified app.project.toolType over warm CEP + native protocol-2.6 post-readback",
                "selectorRoundtripMs": float(tool_select["roundtripMs"]),
                "layerCanvasChangedFraction": tool_canvas_change,
                "retainedFrame": str((output / "refine_edge_tool_selected.jpg").resolve()),
            }
            screen_path = screen_stroke_path(tool_meta, status, encoded)
            stroke_started = time.perf_counter()
            latencies.append(max(0.0, (stroke_started - tool_finished) * 1000.0))
            proof["actionLatencyLabels"] = ["native_refine_tool_to_draw"]
            dragged = await hands.call_tool("hands_computer_action", {"action": {"type": "drag", "button": "left", "path": screen_path, "modifiers": []}})
            stroke_finished = time.perf_counter()
            if dragged.is_error:
                raise RuntimeError("Hands could not draw the verified Refine Edge stroke")
            proof["strokeAction"] = {
                "encodedPath": encoded,
                "screenPath": screen_path,
                "modifiers": [],
                "strokeDurationMs": max(0.0, (stroke_finished - stroke_started) * 1000.0),
                "actionToActionLatencyMs": latencies[-1],
                "handsResult": structured(dragged),
            }
            await asyncio.sleep(0.35)
            _final_meta, final_image = await capture(eyes, hands, output, "after_refine_edge")
            await refuse_modal_if_present(eyes, hands, qwen, output, final_image, proof)
            final_bound, final_evidence = verify_target_binding(qwen, final_image, request, "m5_roto_refine_binding_after")
            proof["targetBindingAfter"] = final_evidence
            if not final_bound:
                raise RuntimeError("typed Roto Brush target changed after Refine Edge stroke")
            evidence_path = str((output / "after_refine_edge.jpg").resolve())
            return {
                "status": "COMPLETED",
                "visualEvidenceId": evidence_path,
                "detail": "Verified Refine Edge stroke attempted through EditGPT Eyes/Hands.",
                "guardedVisualTargetVerified": True,
                "nativeStrokeAttempted": True,
                "targetBinding": target_binding(request),
                "aeActionToActionLatenciesMs": latencies,
                "proof": proof,
            }
        finally:
            if maximized_here:
                try:
                    await hands.call_tool("hands_keypress", {"keys": ["GRAVE"]})
                    await asyncio.sleep(0.05)
                except Exception:
                    pass
            if started_here:
                await eyes.call_tool("eyes_stop_live", {})
            await hands.call_tool("hands_disarm", {})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EditFlow guarded EditGPT Refine Edge visual driver")
    parser.add_argument("--request-json", required=True)
    parser.add_argument("--afterfx-path", required=True)
    parser.add_argument("--tool-select-script", required=True)
    parser.add_argument("--evidence-dir", default="proofs/artifacts/m5-roto-brush-refine-edge-visual-runtime")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = Path(args.evidence_dir)
    try:
        request = json.loads(args.request_json)
        if not isinstance(request, dict):
            raise ValueError("request JSON must be an object")
        result = asyncio.run(run(request, output, args.afterfx_path, args.tool_select_script))
    except Exception as exc:
        result = {"status": "REFUSED", "detail": exception_detail(exc), "guardedVisualTargetVerified": False}
    output.mkdir(parents=True, exist_ok=True)
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "COMPLETED" else 2


if __name__ == "__main__":
    raise SystemExit(main())