from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from mcp import Client
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
from editgpt_mask_tracking_visual_driver import (
    click_screen,
    ground_mask_analyze,
    verify_mask_binding,
)

METHOD = "Face Tracking (Detailed Features)"


def validate_request(value: dict) -> dict:
    if value.get("schema") != "editflow.face-tracking.visual.v1":
        raise ValueError("unsupported face tracking request schema")
    if value.get("direction") != "FORWARD" or value.get("expectedControl") != "FACE_ANALYZE_FORWARD":
        raise ValueError("only verified face Analyze Forward is supported")
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


def verify_detailed_face_binding(qwen, image, request: dict, source: str) -> tuple[bool, dict]:
    comp = literal_label(request["expectedCompName"])
    layer = literal_label(request["expectedLayerName"])
    mask = literal_label(request["expectedMaskName"])
    return verify_visible(
        qwen,
        image,
        (
            f"The active Composition viewer is {comp}. The selected Timeline layer corresponds to {layer}; "
            "AE may visually ellipsize the layer label. The Tracker panel Masks field shows the selected mask "
            f"beginning with {mask}, and its Method field is Face Tracking (Detailed Features). "
            "Reject ordinary Position/Scale/Rotation mask tracking, Face Tracking (Outline Only), or a different mask."
        ),
        source,
    )


async def ensure_detailed_method(eyes, hands, qwen, output: Path, request: dict, proof: dict):
    meta, image = await capture(eyes, hands, output, "face_pre_method")
    mask_ok, mask_evidence = verify_mask_binding(qwen, image, request, "m4_face_mask_binding_pre")
    proof["maskBindingPre"] = mask_evidence
    if not mask_ok:
        raise RuntimeError("face fixture mask binding was not visually verified")
    detailed, evidence = verify_detailed_face_binding(qwen, image, request, "m4_face_detailed_pre")
    proof["detailedMethodPreAdvisory"] = evidence
    proof["detailedMethodPreAdvisoryMatched"] = detailed
    proof["methodDropdown"] = await guarded_click_target(
        eyes, hands, qwen, output,
        "Point to the Method dropdown control in the Tracker panel, on the row beginning 'Method:'.",
        "face_method_dropdown",
    )
    _menu_meta, menu_image = await capture(eyes, hands, output, "face_method_menu_open")
    menu_ok, menu_evidence = verify_visible(
        qwen, menu_image,
        "The Tracker Method dropdown menu is open and visibly contains an item labeled Face Tracking (Detailed Features).",
        "m4_face_method_menu",
    )
    proof["methodMenuVerified"] = menu_evidence
    if not menu_ok:
        raise RuntimeError("Face Tracking (Detailed Features) was not visible in the Method menu")
    proof["detailedMethodItem"] = await guarded_click_target(
        eyes, hands, qwen, output,
        "Point to the menu item labeled exactly Face Tracking (Detailed Features) in the open Tracker Method menu.",
        "face_detailed_method_item",
    )
    await asyncio.sleep(0.45)
    meta, image = await capture(eyes, hands, output, "face_method_selected")
    detailed, evidence = verify_detailed_face_binding(qwen, image, request, "m4_face_detailed_ready")
    proof["detailedMethodReady"] = evidence
    proof["detailedMethodReadyAdvisoryMatched"] = detailed
    return meta, image


async def run(request: dict, output: Path, analysis_window_s: float = 4.0) -> dict:
    request = validate_request(request)
    qwen = LocalQwenVLClient()
    if not qwen.health().get("ok"):
        raise RuntimeError("local EditGPT semantic model is not ready")
    proof: dict[str, object] = {
        "driverId": "editgpt.eyes-hands.face-tracking.v1",
        "targetBinding": target_binding(request),
        "method": METHOD,
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
                raise RuntimeError("After Effects could not be focused before face tracking")
            await hands.call_tool("hands_keypress", {"keys": ["ESC"]})
            await asyncio.sleep(0.20)
            meta, image = await ensure_detailed_method(eyes, hands, qwen, output, request, proof)
            grounded = ground_mask_analyze(qwen, image, "FORWARD")
            proof["analyzeSelection"] = grounded
            screen = await click_screen(hands, meta, grounded["encoded"])
            proof["analyzeClickScreen"] = screen
            await asyncio.sleep(max(1.0, float(analysis_window_s)))
            stopped = await hands.call_tool(
                "hands_click", {"x": screen["x"], "y": screen["y"], "button": "left", "count": 1}
            )
            if stopped.is_error:
                raise RuntimeError("bounded face Tracker Stop click failed")
            proof["boundedStopClicked"] = True
            await asyncio.sleep(0.75)
            _final_meta, final_image = await capture(eyes, hands, output, "face_after_analysis")
            bound, binding_evidence = verify_detailed_face_binding(qwen, final_image, request, "m4_face_binding_after")
            proof["faceBindingAfter"] = binding_evidence
            proof["faceBindingAfterAdvisoryMatched"] = bound
            evidence = str((output / "face_after_analysis.jpg").resolve())
            return {
                "status": "COMPLETED",
                "visualEvidenceId": evidence,
                "detail": "Completed guarded Face Tracking (Detailed Features) Analyze Forward visual action; host facial-point readback remains authoritative.",
                "guardedVisualTargetVerified": True,
                "targetBinding": target_binding(request),
                "proof": proof,
            }
        finally:
            if started_here:
                await eyes.call_tool("eyes_stop_live", {})
            await hands.call_tool("hands_disarm", {})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EditFlow guarded EditGPT Detailed Face Tracking visual driver")
    parser.add_argument("--request-json", required=True)
    parser.add_argument("--evidence-dir", default="proofs/artifacts/m4-face-tracking-visual-runtime")
    parser.add_argument("--analysis-window-seconds", type=float, default=4.0)
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
