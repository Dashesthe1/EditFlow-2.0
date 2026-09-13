from __future__ import annotations

import argparse
import asyncio
import json
import cv2
from pathlib import Path

from mcp import Client
from editgpt.controller.coordinates import CoordinateTransform
from editgpt.controller.semantic_pointer import SemanticPointerTarget
from editgpt.eyes.semantic import LocalQwenVLClient

from editgpt_tracker_visual_driver import (
    EYES_URL, HANDS_URL, capture, detect_analyze_row_cv, exception_detail,
    guarded_click_target, locate_tracker_panel_signature, offset_pointer_target,
    structured, target_patch_change, verify_visible, wait_for_analysis_completion,
)


def validate_request(value: dict) -> dict:
    if value.get("schema") != "editflow.stabilization.visual.v1":
        raise ValueError("unsupported stabilization request schema")
    if value.get("direction") != "FORWARD" or value.get("expectedControl") != "STABILIZE_ANALYZE_APPLY_FORWARD":
        raise ValueError("only verified position Stabilize Motion Analyze Forward + Apply is supported")
    for key in ("compHostId", "layerHostId"):
        if not isinstance(value.get(key), int) or value[key] <= 0:
            raise ValueError(f"{key} must be a positive integer")
    for key in ("expectedCompName", "expectedLayerName"):
        if not isinstance(value.get(key), str) or not value[key].strip():
            raise ValueError(f"{key} must be a non-empty string")
    return value


def target_binding(request: dict) -> dict:
    return {key: request[key] for key in (
        "direction", "expectedControl", "compHostId", "layerHostId", "expectedCompName", "expectedLayerName",
    )}


def verify_binding(qwen, image, request: dict, source: str):
    return verify_visible(
        qwen, image,
        f"The visible After Effects tracking workspace belongs to composition {json.dumps(request['expectedCompName'])} "
        f"and target layer {json.dumps(request['expectedLayerName'])}. Accept visibly truncated tab or layer labels that begin with those names. "
        "Reject a different composition, different target layer, or another application.",
        source,
    )


async def ensure_tracker_panel(eyes, hands, qwen, output: Path, request: dict, proof: dict):
    _meta, image = await capture(eyes, hands, output, "stabilize_pre_panel")
    bound, evidence = verify_binding(qwen, image, request, "m4_stabilize_binding_pre")
    proof["bindingPre"] = evidence
    if not bound:
        raise RuntimeError("stabilization target binding was not visually verified")
    panel_ok, panel = locate_tracker_panel_signature(qwen, image, "m4_stabilize_panel_initial")
    proof["panelInitial"] = panel
    if not panel_ok:
        proof["windowMenu"] = await guarded_click_target(
            eyes, hands, qwen, output,
            "Point to the Window menu label in the top Adobe After Effects menu bar. Do not choose a dropdown item.",
            "stabilize_window_menu",
        )
        _meta, menu = await capture(eyes, hands, output, "stabilize_window_menu_open")
        visible, menu_evidence = verify_visible(qwen, menu, "The Window menu dropdown is open and visibly contains a Tracker item.", "m4_stabilize_window_menu")
        proof["windowMenuVerified"] = menu_evidence
        if not visible:
            raise RuntimeError("Window menu did not expose Tracker")
        proof["trackerMenuItem"] = await guarded_click_target(
            eyes, hands, qwen, output, "Point to the Tracker item in the currently open Window menu dropdown.", "stabilize_tracker_menu_item"
        )
        _meta, image = await capture(eyes, hands, output, "stabilize_tracker_panel_open")
        panel_ok, panel = locate_tracker_panel_signature(qwen, image, "m4_stabilize_panel_opened")
    if not panel_ok:
        raise RuntimeError("Tracker panel geometry was not visually verified")
    proof["panelReady"] = panel
    return image, panel


async def ensure_stabilize_mode(eyes, hands, qwen, output: Path, image, panel: dict, proof: dict):
    ready, evidence = verify_visible(
        qwen, image,
        "The Tracker panel is already in native Stabilize Motion mode: Current Track is not None, Track Type is Stabilize, and Position stabilization is enabled.",
        "m4_stabilize_mode_pre",
    )
    proof["modePre"] = evidence
    if not ready:
        proof["stabilizeMotionClick"] = await guarded_click_target(
            eyes, hands, qwen, output,
            "Point to the Stabilize Motion button inside the Tracker panel. Do not point to Warp Stabilizer, Track Motion, Track Camera, or Track Type.",
            "stabilize_motion_button", tuple(panel["bounds"]),
        )
        await asyncio.sleep(0.55)
        _meta, image = await capture(eyes, hands, output, "stabilize_mode_selected")
        panel_ok, panel = locate_tracker_panel_signature(qwen, image, "m4_stabilize_panel_mode_ready")
        if not panel_ok:
            raise RuntimeError("Tracker panel disappeared after Stabilize Motion")
        ready, evidence = verify_visible(
            qwen, image,
            "The Tracker panel is in native Stabilize Motion mode: Current Track is not None, Track Type is Stabilize, and Position stabilization is enabled.",
            "m4_stabilize_mode_ready",
        )
        proof["modeReady"] = evidence
        if not ready:
            raise RuntimeError("native Stabilize Motion mode was not visually verified")
    return image, panel


def ground_forward_analyze(image, panel: dict) -> dict:
    x1, y1, x2, y2 = tuple(panel["bounds"])
    crop = image[y1:y2, x1:x2]
    detected = detect_analyze_row_cv(crop)
    boxes, centers = detected["bboxes"], detected["centers"]
    pb, nb = boxes[2], boxes[3]
    pc, nc = centers[2], centers[3]
    primary = SemanticPointerTarget(x=int(round(pc[0])), y=int(round(pc[1])), confidence=.99, target="continuous Analyze Forward", reason="third group in verified 2-1-1-2 Tracker Analyze row signature", bbox_pixels=pb)
    neighbor = SemanticPointerTarget(x=int(round(nc[0])), y=int(round(nc[1])), confidence=.99, target="one-frame forward", reason="fourth group in verified 2-1-1-2 Tracker Analyze row signature", bbox_pixels=nb)
    return {
        "primary": offset_pointer_target(primary, x1, y1), "neighbor": offset_pointer_target(neighbor, x1, y1),
        "cv_signature": detected, "panel_bounds": list(panel["bounds"]), "image": image, "control_index": 2, "direction": "FORWARD",
    }


async def click_forward_analyze(eyes, hands, qwen, output: Path, grounded: dict, proof: dict):
    meta, fresh = await capture(eyes, hands, output, "stabilize_analyze_action_fresh")
    ok, panel = locate_tracker_panel_signature(qwen, fresh, "m4_stabilize_panel_before_analyze")
    if not ok:
        raise RuntimeError("Tracker panel geometry changed before Analyze")
    primary, neighbor = grounded["primary"], grounded["neighbor"]
    if target_patch_change(grounded["image"], fresh, primary.bbox_pixels) > .12 or target_patch_change(grounded["image"], fresh, neighbor.bbox_pixels) > .12:
        raise RuntimeError("Analyze row changed before action")
    status = structured(await hands.call_tool("hands_status", {}))
    transform = CoordinateTransform.from_status(meta, status)
    sx, sy = transform.encoded_to_screen(primary.x, primary.y)
    clicked = await hands.call_tool("hands_click", {"x": sx, "y": sy, "button": "left", "count": 1})
    if clicked.is_error:
        raise RuntimeError("Analyze Forward click failed")
    proof["analyzeClick"] = {"x": sx, "y": sy, "panel": panel}


async def apply_stabilization(eyes, hands, qwen, output: Path, proof: dict):
    meta, image = await capture(eyes, hands, output, "stabilize_before_apply")
    ok, panel = locate_tracker_panel_signature(qwen, image, "m4_stabilize_panel_apply")
    if not ok:
        raise RuntimeError("Tracker panel disappeared before Apply")
    pre, evidence = verify_visible(qwen, image, "The Tracker panel visibly shows a selected Current Track, Track Type is Stabilize, Position is checked, and the Analyze controls are in their normal non-Stop state.", "m4_stabilize_apply_pre")
    proof["applyPre"] = evidence
    if not pre:
        raise RuntimeError("native stabilization post-analysis state was not visually verified")
    apply_visible, apply_evidence = verify_visible(qwen, image, "An Apply button is visibly present inside the Tracker panel.", "m4_stabilize_apply_visible")
    proof["applyVisibleInitial"] = apply_evidence
    bounds = tuple(panel["bounds"])
    if not apply_visible:
        status = structured(await hands.call_tool("hands_status", {}))
        transform = CoordinateTransform.from_status(meta, status)
        x1, y1, x2, y2 = bounds
        sx, sy = transform.encoded_to_screen(int((x1 + x2) / 2), int(y2 - 28))
        for attempt in range(2):
            scrolled = await hands.call_tool("hands_scroll", {"scroll_x": 0, "scroll_y": 520, "x": sx, "y": sy})
            if scrolled.is_error:
                raise RuntimeError("could not scroll Tracker panel to reveal Apply")
            await asyncio.sleep(.35)
            _meta, image = await capture(eyes, hands, output, f"stabilize_apply_reveal_{attempt + 1}")
            apply_visible, apply_evidence = verify_visible(qwen, image, "An Apply button is visibly present inside the Tracker panel.", f"m4_stabilize_apply_visible_{attempt + 1}")
            proof[f"applyVisibleAfterScroll{attempt + 1}"] = apply_evidence
            if apply_visible:
                break
        if not apply_visible:
            raise RuntimeError("Apply button remained outside the visible Tracker panel after bounded scroll")
    gmeta, gimg = await capture(eyes, hands, output, "stabilize_apply_cv_ground")
    gok, gpanel = locate_tracker_panel_signature(qwen, gimg, "m4_stabilize_apply_cv")
    if not gok: raise RuntimeError("Tracker panel geometry missing for Apply")
    x1, y1, x2, y2 = map(int, gpanel["bounds"]); top = y1 + int((y2-y1)*.50)
    roi = cv2.cvtColor(gimg[top:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    mask = cv2.inRange(roi, 55, 135); mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT,(5,3)))
    contours,_ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cands=[]
    for c in contours:
        x,y,w,h=cv2.boundingRect(c)
        if int((x2-x1)*.24)<=w<=int((x2-x1)*.55) and 14<=h<=36 and w*h>=500: cands.append({"x":x1+x+w//2,"y":top+y+h//2,"bbox":(x1+x,top+y,x1+x+w,top+y+h)})
    if len(cands)<2: raise RuntimeError("Tracker button geometry missing")
    by=max(v["y"] for v in cands); row=[v for v in cands if abs(v["y"]-by)<=8]
    if len(row)<2: raise RuntimeError("Reset/Apply row missing")
    target=max(row,key=lambda v:v["x"])
    if target["x"] <= x1 + (x2-x1)*.55 or target["y"] <= y1 + (y2-y1)*.68:
        raise RuntimeError("CV Apply target escaped expected bottom-right Tracker geometry")
    ameta,aimg=await capture(eyes,hands,output,"stabilize_apply_cv_action")
    if gmeta.get("geometry") != ameta.get("geometry"):
        raise RuntimeError("Eyes geometry changed before Apply")
    changed=target_patch_change(gimg,aimg,target["bbox"])
    if changed > .12:
        raise RuntimeError(f"Apply target changed before action ({changed:.3f})")
    status=structured(await hands.call_tool("hands_status",{})); transform=CoordinateTransform.from_status(ameta,status)
    sx,sy=transform.encoded_to_screen(target["x"],target["y"]); clicked=await hands.call_tool("hands_click",{"x":sx,"y":sy,"button":"left","count":1})
    if clicked.is_error: raise RuntimeError("Apply click failed")
    proof["applyClick"]={"target":target,"screen":{"x":sx,"y":sy},"target_patch_changed_fraction":changed,"panelBounds":gpanel["bounds"]}
    await asyncio.sleep(.45)
    _meta, post = await capture(eyes, hands, output, "stabilize_apply_options")
    dialog, dialog_evidence = verify_visible(qwen, post, "A modal Motion Tracker Apply Options dialog is open, Apply Dimensions is X and Y, and OK and Cancel buttons are visible.", "m4_stabilize_apply_dialog")
    proof["applyDialog"] = dialog_evidence
    proof["applyDialogDetected"] = dialog
    if not dialog:
        raise RuntimeError("Motion Tracker Apply Options did not open after Apply")
    entered = await hands.call_tool("hands_keypress", {"keys": ["ENTER"]})
    if entered.is_error:
        raise RuntimeError("could not confirm Motion Tracker Apply Options")
    await asyncio.sleep(.75)
    _meta, final = await capture(eyes, hands, output, "stabilize_after_apply")
    closed, closed_evidence = verify_visible(qwen, final, "No modal dialog is open and Adobe After Effects is back in the stabilization tracking workspace.", "m4_stabilize_apply_after")
    proof["applyAfter"] = closed_evidence
    if not closed:
        raise RuntimeError("stabilization Apply did not return to the tracking workspace")
    return final


async def run(request: dict, output: Path, analysis_window_s: float = 4.0) -> dict:
    request = validate_request(request)
    qwen = LocalQwenVLClient()
    if not qwen.health().get("ok"):
        raise RuntimeError("local EditGPT semantic model is not ready")
    proof = {"driverId": "editgpt.eyes-hands.stabilization.v1", "targetBinding": target_binding(request)}
    async with Client(EYES_URL) as eyes, Client(HANDS_URL) as hands:
        armed = await hands.call_tool("hands_arm", {})
        if armed.is_error:
            raise RuntimeError("EditGPT Hands could not arm")
        started_here = False
        try:
            started = await eyes.call_tool("eyes_start_live", {"fps": 30, "buffer_seconds": .7})
            if started.is_error:
                raise RuntimeError("EditGPT Eyes could not start")
            started_here = bool(structured(started).get("started", False))
            focused = await hands.call_tool("hands_focus_after_effects", {})
            if focused.is_error:
                raise RuntimeError("After Effects could not be focused before stabilization")
            await hands.call_tool("hands_keypress", {"keys": ["ESC"]})
            await asyncio.sleep(.2)
            image, panel = await ensure_tracker_panel(eyes, hands, qwen, output, request, proof)
            image, panel = await ensure_stabilize_mode(eyes, hands, qwen, output, image, panel, proof)
            grounded = ground_forward_analyze(image, panel)
            proof["analyzeGround"] = {"primary": grounded["primary"].__dict__, "neighbor": grounded["neighbor"].__dict__, "cv": grounded["cv_signature"], "panelBounds": grounded["panel_bounds"]}
            await click_forward_analyze(eyes, hands, qwen, output, grounded, proof)
            proof["analysisCompletion"] = await wait_for_analysis_completion(eyes, hands, output, grounded, analysis_window_s=max(1.0, float(analysis_window_s)), timeout_s=35)
            await apply_stabilization(eyes, hands, qwen, output, proof)
            evidence = str((output / "stabilize_after_apply.jpg").resolve())
            return {"status": "COMPLETED", "visualEvidenceId": evidence, "detail": "Completed guarded native Stabilize Motion Analyze Forward + X/Y Apply; protocol 2.3 host readback remains authoritative.", "guardedVisualTargetVerified": True, "targetBinding": target_binding(request), "proof": proof}
        finally:
            if started_here:
                await eyes.call_tool("eyes_stop_live", {})
            await hands.call_tool("hands_disarm", {})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EditFlow guarded native Stabilize Motion visual driver")
    parser.add_argument("--request-json", required=True)
    parser.add_argument("--evidence-dir", default="proofs/artifacts/m4-stabilization-visual-runtime")
    parser.add_argument("--analysis-window-seconds", type=float, default=4.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args(); output = Path(args.evidence_dir)
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
