from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from mcp import Client
from editgpt.controller.coordinates import CoordinateTransform
from editgpt.controller.semantic_pointer import choose_pointer_target
from editgpt.eyes.semantic import LocalQwenVLClient

from editgpt_tracker_visual_driver import (
    EYES_URL,
    HANDS_URL,
    capture,
    exception_detail,
    guarded_click_target,
    literal_label,
    structured,
    verify_visible,
)
def validate_request(value: dict) -> dict:
    if value.get("schema") != "editflow.mask-tracking.visual.v1":
        raise ValueError("unsupported mask tracking request schema")
    direction = value.get("direction")
    if direction not in ("FORWARD", "BACKWARD"):
        raise ValueError("unsupported mask tracking direction")
    expected = "MASK_ANALYZE_FORWARD" if direction == "FORWARD" else "MASK_ANALYZE_BACKWARD"
    if value.get("expectedControl") != expected:
        raise ValueError("expectedControl does not match mask tracking direction")
    for key in ("compHostId", "layerHostId"):
        if not isinstance(value.get(key), int) or value[key] <= 0:
            raise ValueError(f"{key} must be a positive integer")
    for key in ("maskStableId", "expectedCompName", "expectedLayerName", "expectedMaskName"):
        if not isinstance(value.get(key), str) or not value[key].strip():
            raise ValueError(f"{key} must be a non-empty string")
    return value


def target_binding(request: dict) -> dict:
    return {key: request[key] for key in (
        "direction", "expectedControl", "compHostId", "layerHostId", "maskStableId",
        "expectedCompName", "expectedLayerName", "expectedMaskName",
    )}
def verify_mask_binding(qwen, image, request: dict, source: str) -> tuple[bool, dict]:
    comp = literal_label(request["expectedCompName"])
    layer = literal_label(request["expectedLayerName"])
    mask = literal_label(request["expectedMaskName"])
    return verify_visible(
        qwen,
        image,
        (
            f"The active Composition viewer is {comp}. The selected Timeline layer corresponds to {layer}; "
            "AE may visually ellipsize that layer label, so accept a clearly matching identifying prefix/suffix. "
            f"The Tracker panel is in mask tracking mode: its Masks field shows the selected mask beginning with {mask}, "
            "and a Method selector is visible. Reject point Track Motion mode or a different comp/mask."
        ),
        source,
    )


async def ensure_mask_panel(eyes, hands, qwen, output: Path, request: dict, proof: dict):
    meta, image = await capture(eyes, hands, output, "pre_action_target")
    ok, evidence = verify_mask_binding(qwen, image, request, "m4_mask_binding_pre")
    proof["maskBindingPre"] = evidence
    if ok:
        return meta, image
    proof["windowMenu"] = await guarded_click_target(
        eyes, hands, qwen, output,
        "Point to the Window menu label in the top Adobe After Effects menu bar. Do not choose a dropdown item.",
        "mask_window_menu",
    )
    _menu_meta, menu_image = await capture(eyes, hands, output, "mask_window_menu_open")
    menu_ok, menu_evidence = verify_visible(
        qwen, menu_image, "The Window menu dropdown is open and visibly contains a Tracker item.",
        "m4_mask_window_menu",
    )
    proof["windowMenuVerified"] = menu_evidence
    if not menu_ok:
        raise RuntimeError("Window menu did not expose Tracker for mask tracking")
    proof["trackerMenuItem"] = await guarded_click_target(
        eyes, hands, qwen, output,
        "Point to the Tracker item in the currently open Window menu dropdown.",
        "mask_tracker_menu_item",
    )
    meta, image = await capture(eyes, hands, output, "mask_tracker_panel_open")
    ok, evidence = verify_mask_binding(qwen, image, request, "m4_mask_binding_ready")
    proof["maskBindingReady"] = evidence
    if not ok:
        raise RuntimeError("bound mask tracking panel was not visually verified")
    return meta, image
def ground_mask_analyze(qwen, image, direction: str) -> dict:
    left, left_obs = choose_pointer_target(
        image,
        instruction="Point to Analyze One Frame Backward in the Tracker Analyze row: the leftmost of four controls, bar plus left triangle.",
        client=qwen, min_confidence=0.60,
    )
    right, right_obs = choose_pointer_target(
        image,
        instruction="Point to Analyze One Frame Forward in the Tracker Analyze row: the rightmost of four controls, right triangle plus bar.",
        client=qwen, min_confidence=0.60,
    )
    slot = 2 if direction == "FORWARD" else 1
    claimed, claimed_obs = choose_pointer_target(
        image,
        instruction=("Point to continuous Analyze Forward: the third of four controls, a plain right triangle."
                     if direction == "FORWARD" else
                     "Point to continuous Analyze Backward: the second of four controls, a plain left triangle."),
        client=qwen, min_confidence=0.60,
    )
    span = right.x - left.x
    step = span / 3.0 if span > 0 else 0.0
    x = left.x + slot * step
    y = (left.y + right.y) / 2.0
    same_row = abs(left.y - right.y) <= 24
    span_ok = 45 <= span <= 150
    claimed_ok = abs(claimed.x - x) <= max(8.0, abs(step) * 0.55) and abs(claimed.y - y) <= 24
    if not (same_row and span_ok and claimed_ok):
        raise RuntimeError("mask Analyze control geometry/order was not verified")
    row_ok, row_evidence = verify_visible(
        qwen, image,
        "The mask Tracker Analyze row shows four controls in order: one-frame backward, Analyze Backward, Analyze Forward, one-frame forward.",
        "m4_mask_analyze_row",
    )
    return {
        "encoded": {"x": int(round(x)), "y": int(round(y))},
        "edgeLeft": left.__dict__, "edgeLeftSemantic": left_obs.as_dict(),
        "edgeRight": right.__dict__, "edgeRightSemantic": right_obs.as_dict(),
        "claimed": claimed.__dict__, "claimedSemantic": claimed_obs.as_dict(),
        "span": span, "step": step, "rowEvidence": row_evidence, "rowVerificationAdvisory": row_ok,
    }


async def click_screen(hands, meta: dict, encoded: dict) -> dict:
    status = structured(await hands.call_tool("hands_status", {}))
    transform = CoordinateTransform.from_status(meta, status)
    screen_x, screen_y = transform.encoded_to_screen(encoded["x"], encoded["y"])
    clicked = await hands.call_tool(
        "hands_click", {"x": screen_x, "y": screen_y, "button": "left", "count": 1}
    )
    if clicked.is_error:
        raise RuntimeError("Hands could not click the verified mask Analyze control")
    return {"x": screen_x, "y": screen_y}


async def run(request: dict, output: Path, analysis_window_s: float = 3.0) -> dict:
    request = validate_request(request)
    qwen = LocalQwenVLClient()
    if not qwen.health().get("ok"):
        raise RuntimeError("local EditGPT semantic model is not ready")
    proof: dict[str, object] = {
        "driverId": "editgpt.eyes-hands.mask-tracking.v1",
        "targetBinding": target_binding(request),
    }
    async with Client(EYES_URL) as eyes, Client(HANDS_URL) as hands:
        armed = await hands.call_tool("hands_arm", {})
        if armed.is_error:
            raise RuntimeError("EditGPT Hands could not arm")
        started_here = False
        try:
            started = await eyes.call_tool("eyes_start_live", {"fps": 30, "buffer_seconds": 0.7})
            if started.is_error:
                raise RuntimeError("EditGPT Eyes could not start")
            started_here = bool(structured(started).get("started", False))
            focused = await hands.call_tool("hands_focus_after_effects", {})
            if focused.is_error:
                raise RuntimeError("After Effects could not be focused before mask tracking")
            await hands.call_tool("hands_keypress", {"keys": ["ESC"]})
            await asyncio.sleep(0.20)
            meta, image = await ensure_mask_panel(eyes, hands, qwen, output, request, proof)
            grounded = ground_mask_analyze(qwen, image, request["direction"])
            proof["analyzeSelection"] = grounded
            screen = await click_screen(hands, meta, grounded["encoded"])
            proof["analyzeClickScreen"] = screen
            await asyncio.sleep(max(1.0, float(analysis_window_s)))
            stopped = await hands.call_tool(
                "hands_click", {"x": screen["x"], "y": screen["y"], "button": "left", "count": 1}
            )
            if stopped.is_error:
                raise RuntimeError("bounded mask Tracker Stop click failed")
            proof["boundedStopClicked"] = True
            await asyncio.sleep(0.65)
            _final_meta, final_image = await capture(eyes, hands, output, "after_analysis")
            bound, binding_evidence = verify_mask_binding(qwen, final_image, request, "m4_mask_binding_after")
            proof["maskBindingAfter"] = binding_evidence
            if not bound:
                raise RuntimeError("typed mask visual binding changed after analysis")
            restored, restored_evidence = verify_visible(
                qwen, final_image,
                "The mask Tracker Analyze row shows its four directional controls and no continuous Analyze control is a square Stop button.",
                "m4_mask_analyze_row_restored",
            )
            proof["analyzeRowRestored"] = restored_evidence
            proof["analyzeRowRestoredAdvisory"] = restored
            evidence = str((output / "after_analysis.jpg").resolve())
            return {
                "status": "COMPLETED",
                "visualEvidenceId": evidence,
                "detail": f"Verified native mask Analyze {request['direction'].title()} through EditGPT Eyes/Hands.",
                "guardedVisualTargetVerified": True,
                "targetBinding": target_binding(request),
                "proof": proof,
            }
        finally:
            if started_here:
                await eyes.call_tool("eyes_stop_live", {})
            await hands.call_tool("hands_disarm", {})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EditFlow guarded EditGPT mask tracking visual driver")
    parser.add_argument("--request-json", required=True)
    parser.add_argument("--evidence-dir", default="proofs/artifacts/m4-mask-tracking-visual-runtime")
    parser.add_argument("--analysis-window-seconds", type=float, default=3.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = Path(args.evidence_dir)
    try:
        request = json.loads(args.request_json)
        if not isinstance(request, dict):
            raise ValueError("request JSON must be an object")
        result = asyncio.run(run(request, output, max(1.0, min(30.0, float(args.analysis_window_seconds)))))
    except Exception as exc:
        result = {"status": "REFUSED", "detail": exception_detail(exc), "guardedVisualTargetVerified": False}
    output.mkdir(parents=True, exist_ok=True)
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "COMPLETED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
