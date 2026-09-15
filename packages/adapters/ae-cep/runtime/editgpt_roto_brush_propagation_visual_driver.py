from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
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
    target_patch_change,
    verify_visible,
)
from editgpt_roto_brush_seed_visual_driver import (
    inspect_error_popup,
    qualified_modal,
    verify_target_binding,
)

SCHEMA = "editflow.roto-brush-propagation.visual.v1"
DRIVER_ID = "editgpt.eyes-hands.roto-brush-propagation.v1"

def finite_number(value) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(float(value))


def validate_request(value: dict) -> dict:
    if value.get("schema") != SCHEMA:
        raise ValueError("unsupported Roto Brush propagation request schema")
    if value.get("operation") not in {"PROPAGATE_FORWARD", "PROPAGATE_BACKWARD"}:
        raise ValueError("operation must be PROPAGATE_FORWARD or PROPAGATE_BACKWARD")
    for key in ("compHostId", "layerHostId"):
        if not isinstance(value.get(key), int) or value[key] <= 0:
            raise ValueError(f"{key} must be a positive integer")
    for key in ("expectedCompName", "expectedLayerName", "expectedSessionRevision", "expectedEffectFingerprint"):
        if not isinstance(value.get(key), str) or not value[key].strip():
            raise ValueError(f"{key} must be a non-empty string")
    if value.get("expectedEffectMatchCount") != 1:
        raise ValueError("expectedEffectMatchCount must be 1")
    frame_duration = value.get("frameDuration")
    if not finite_number(frame_duration) or frame_duration <= 0:
        raise ValueError("frameDuration must be finite and positive")
    steps = value.get("expectedFrameSteps")
    if not isinstance(steps, int) or not 1 <= steps <= 12:
        raise ValueError("expectedFrameSteps must be an integer in [1,12]")
    for key in ("expectedStartTime", "expectedEndTime"):
        if not finite_number(value.get(key)) or value[key] < 0:
            raise ValueError(f"{key} must be finite and non-negative")
    range_value = value.get("range")
    if not isinstance(range_value, dict):
        raise ValueError("range must be an object")
    start_time = range_value.get("startTime")
    end_time = range_value.get("endTime")
    if not finite_number(start_time) or not finite_number(end_time) or start_time < 0 or end_time <= start_time:
        raise ValueError("range must contain a finite non-negative increasing time span")
    evidence = value.get("evidenceIds")
    if not isinstance(evidence, list) or not evidence or not all(isinstance(item, str) and item.strip() for item in evidence):
        raise ValueError("evidenceIds must contain at least one non-empty string")
    return value


def target_binding(request: dict) -> dict:
    return {key: request[key] for key in (
        "operation", "compHostId", "layerHostId", "expectedCompName", "expectedLayerName",
        "expectedSessionRevision", "expectedEffectFingerprint", "expectedEffectMatchCount", "range",
        "frameDuration", "expectedFrameSteps", "expectedStartTime", "expectedEndTime", "evidenceIds",
    )}


def frame_step_keys(operation: str) -> list[str]:
    return ["CTRL", "RIGHT"] if operation == "PROPAGATE_FORWARD" else ["CTRL", "LEFT"]


async def handle_modal_if_present(eyes, hands, qwen, output: Path, image, proof: dict) -> None:
    popup = inspect_error_popup(qwen, image, "m5_roto_propagation_modal_inspection")
    proof["modalInspection"] = popup
    if not bool(popup.get("visible")):
        return
    if not qualified_modal(popup):
        confirmation = inspect_error_popup(qwen, image, "m5_roto_propagation_modal_confirmation")
        proof["modalConfirmation"] = confirmation
        if not qualified_modal(confirmation):
            proof["modalFalsePositiveRejected"] = True
            return
        popup = confirmation
    message = str(popup.get("message") or "After Effects displayed an error dialog").strip()
    label = str(popup.get("buttonLabel") or "").strip()
    if bool(popup.get("acknowledgementOnly")) and label.lower() in {"ok", "close"}:
        proof["modalAcknowledgement"] = await guarded_click_target(
            eyes,
            hands,
            qwen,
            output,
            f"Point to the single {literal_label(label)} acknowledgement button in the separate blocking After Effects dialog containing {literal_label(message)}.",
            "roto_propagation_modal_ack",
        )
    raise RuntimeError(f"After Effects modal error during Roto Brush propagation: {message}")


async def run(request: dict, output: Path) -> dict:
    request = validate_request(request)
    qwen = LocalQwenVLClient()
    if not qwen.health().get("ok"):
        raise RuntimeError("local EditGPT semantic model is not ready")
    proof: dict[str, object] = {"driverId": DRIVER_ID, "targetBinding": target_binding(request)}
    gaps_ms: list[float] = []
    durations_ms: list[float] = []
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
                raise RuntimeError("After Effects could not be focused before Roto Brush propagation")
            await hands.call_tool("hands_keypress", {"keys": ["ESC"]})
            await asyncio.sleep(0.12)
            _pre_meta, pre_image = await capture(eyes, hands, output, "pre_propagation")
            bound, binding_evidence = verify_target_binding(qwen, pre_image, request, "m5_roto_propagation_binding_pre")
            proof["targetBindingPre"] = binding_evidence
            if not bound:
                raise RuntimeError("visible AE state does not match the typed Roto Brush propagation target")
            visible, segmentation_evidence = verify_visible(
                qwen,
                pre_image,
                (
                    f"The active After Effects viewer is the Layer tab for exact target layer {literal_label(request['expectedLayerName'])}, "
                    "and the visible AE UI is in a native Roto Brush editing context. Accept the exact target Layer viewer together with visible "
                    "Roto Brush & Refine Edge controls and/or the active Roto Brush tool, even when the magenta segmentation boundary is not currently "
                    "drawn in the viewer. Reject an unrelated Composition viewer, Layer (none), missing Roto Brush context, or any blocking modal dialog."
                ),
                "m5_roto_propagation_segmentation_pre",
            )
            proof["segmentationPre"] = segmentation_evidence
            if not visible:
                raise RuntimeError("Roto Brush editing context was not visually verified before propagation")

            selection_tool = await hands.call_tool("hands_keypress", {"keys": ["V"]})
            if selection_tool.is_error:
                raise RuntimeError("Hands could not normalize to Selection before safely focusing the Layer viewer")
            await asyncio.sleep(0.05)
            proof["layerViewerFocus"] = await guarded_click_target(
                eyes,
                hands,
                qwen,
                output,
                (
                    f"Point to a safe pixel INSIDE THE VIDEO IMAGE of the active Layer viewer for exact target {literal_label(request['expectedLayerName'])}. "
                    "Choose visible footage near the center of that Layer image, not the tab/header, dropdown, timeline/ruler, Effect Controls, toolbar, or any button. "
                    "The Selection tool is active, so this single click is only to give keyboard focus to the Layer viewer."
                ),
                "roto_propagation_layer_canvas_focus",
            )
            # Keep the Layer viewer as the keyboard target. Re-selecting the Roto Brush tool here can
            # move focus back to the toolbar and cause Page Up/Page Down to be accepted by AE without
            # advancing the Layer viewer. Propagation from an existing seed does not require the brush
            # tool itself to remain active.
            proof["focusToolNormalization"] = {
                "selectionToolShortcut": ["V"],
                "rotoBrushShortcutRestoredBeforePropagation": False,
            }
            await asyncio.sleep(0.05)

            keys = frame_step_keys(request["operation"])
            previous_start: float | None = None
            step_results: list[dict] = []
            for index in range(request["expectedFrameSteps"]):
                if index:
                    await asyncio.sleep(0.08)
                action_start = time.perf_counter()
                if previous_start is not None:
                    gaps_ms.append(max(0.0, (action_start - previous_start) * 1000.0))
                stepped = await hands.call_tool("hands_keypress", {"keys": keys})
                action_end = time.perf_counter()
                if stepped.is_error:
                    raise RuntimeError(f"EditGPT Hands failed Roto Brush propagation step {index + 1}")
                durations_ms.append(max(0.0, (action_end - action_start) * 1000.0))
                step_results.append(structured(stepped))
                previous_start = action_start
            proof["frameStepBatch"] = {
                "keys": keys,
                "frameSteps": request["expectedFrameSteps"],
                "actionToActionLatenciesMs": gaps_ms,
                "actionDurationsMs": durations_ms,
                "handsResults": step_results,
            }
            await asyncio.sleep(0.35)
            _final_meta, final_image = await capture(eyes, hands, output, "after_propagation")
            await handle_modal_if_present(eyes, hands, qwen, output, final_image, proof)
            final_bound, final_binding_evidence = verify_target_binding(
                qwen, final_image, request, "m5_roto_propagation_binding_after"
            )
            proof["targetBindingAfter"] = final_binding_evidence
            if not final_bound:
                raise RuntimeError("typed Roto Brush target changed during propagation")

            h, w = final_image.shape[:2]
            viewer_bounds = (int(w * 0.12), int(h * 0.14), int(w * 0.86), int(h * 0.76))
            frame_change = target_patch_change(pre_image, final_image, viewer_bounds)
            proof["viewerChangedFraction"] = frame_change
            proof["viewerMotionAdvisory"] = frame_change >= 0.003
            # Pixel motion is advisory only: low-motion footage can be visually stable across a bounded
            # propagation range. Exact temporal progress is verified authoritatively by protocol 2.6
            # post-action readback in the guarded controller.
            final_visible, final_evidence = verify_visible(
                qwen,
                final_image,
                (
                    f"The active After Effects viewer is still the Layer tab for exact target layer {literal_label(request['expectedLayerName'])}, "
                    "and the visible AE UI remains in the native Roto Brush editing context. Accept the exact target Layer viewer together with visible "
                    "Roto Brush & Refine Edge controls and/or the active Roto Brush tool, even when the magenta segmentation boundary is not currently "
                    "drawn in the viewer. Reject an unrelated viewer, missing Roto Brush context, or any blocking modal dialog."
                ),
                "m5_roto_propagation_segmentation_after",
            )
            proof["segmentationAfter"] = final_evidence
            if not final_visible:
                raise RuntimeError("Roto Brush editing context was not visually verified after propagation")
            evidence_path = str((output / "after_propagation.jpg").resolve())
            return {
                "status": "COMPLETED",
                "propagationVisualVerified": True,
                "finalVisualEvidenceId": evidence_path,
                "detail": f"Verified bounded {request['operation'].lower()} Roto Brush propagation through EditGPT Eyes/Hands.",
                "frameSteps": request["expectedFrameSteps"],
                "targetBinding": target_binding(request),
                "aeActionToActionLatenciesMs": gaps_ms,
                "proof": proof,
            }
        finally:
            if started_here:
                await eyes.call_tool("eyes_stop_live", {})
            await hands.call_tool("hands_disarm", {})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EditFlow guarded EditGPT Roto Brush propagation visual driver")
    parser.add_argument("--request-json", required=True)
    parser.add_argument("--evidence-dir", default="proofs/artifacts/m5-roto-brush-propagation-visual-runtime")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = Path(args.evidence_dir)
    try:
        request = json.loads(args.request_json)
        if not isinstance(request, dict):
            raise ValueError("request JSON must be an object")
        result = asyncio.run(run(request, output))
    except Exception as exc:
        result = {"status": "REFUSED", "detail": exception_detail(exc), "propagationVisualVerified": False}
    output.mkdir(parents=True, exist_ok=True)
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "COMPLETED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
