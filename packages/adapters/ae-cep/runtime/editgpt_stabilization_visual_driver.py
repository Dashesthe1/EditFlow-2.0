from __future__ import annotations

import argparse
import asyncio
import json
import cv2
from pathlib import Path

from mcp import Client
from editgpt.controller.coordinates import CoordinateTransform
from editgpt.controller.semantic_pointer import SemanticPointerTarget, choose_pointer_target
from editgpt.eyes.semantic import LocalQwenVLClient

from editgpt_tracker_visual_driver import (
    EYES_URL, HANDS_URL, capture, detect_analyze_row_cv, exception_detail,
    ensure_timeline_layer_selected, guarded_click_target, locate_tracker_panel_signature, offset_pointer_target, reveal_analyze_row,
    structured, target_patch_change, tool_result_detail, validate_menu_item_below, verify_visible,
    wait_for_analysis_completion,
)


LAST_PROOF: dict = {}


def detect_tracker_mode_button_grid_cv(image, bounds: tuple[int, int, int, int], title_data: dict) -> dict:
    x1, y1, x2, y2 = map(int, bounds)
    panel_w, panel_h = max(1, x2 - x1), max(1, y2 - y1)
    title_bbox = title_data.get("bbox_pixels") if isinstance(title_data, dict) else None
    title_y = int(title_data.get("y", y1)) if isinstance(title_data, dict) else y1
    band_y1 = max(y1, int(title_bbox[3]) if isinstance(title_bbox, (list, tuple)) and len(title_bbox) == 4 else title_y + 8)
    band_y2 = min(y2, title_y + max(95, int(round(panel_h * .32))))
    crop = image[band_y1:band_y2, x1:x2]
    if crop.size == 0:
        return {"ok": False, "reason": "Tracker button-grid crop was empty", "bandBounds": [x1, band_y1, x2, band_y2]}
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 40, 120)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    min_w = max(48, int(round(panel_w * .16)))
    max_w = max(min_w + 1, int(round(panel_w * .34)))
    min_h = max(14, int(round(panel_h * .035)))
    max_h = max(min_h + 1, int(round(panel_h * .10)))
    boxes = []
    for contour in contours:
        rx, ry, rw, rh = cv2.boundingRect(contour)
        if min_w <= rw <= max_w and min_h <= rh <= max_h:
            box = (rx + x1, ry + band_y1, rw, rh)
            if box not in boxes:
                boxes.append(box)
    boxes.sort(key=lambda box: (box[1], box[0], box[2], box[3]))

    def row_pair(a, b):
        left, right = (a, b) if a[0] <= b[0] else (b, a)
        lcx = left[0] + left[2] / 2.0
        rcx = right[0] + right[2] / 2.0
        lcy = left[1] + left[3] / 2.0
        rcy = right[1] + right[3] / 2.0
        width_ratio = abs(left[2] - right[2]) / max(left[2], right[2])
        height_ratio = abs(left[3] - right[3]) / max(left[3], right[3])
        gap = right[0] - (left[0] + left[2])
        same_row = abs(lcy - rcy) <= max(4.0, max(left[3], right[3]) * .30)
        adjacent = -3 <= gap <= max(18, int(round(panel_w * .055)))
        center_dx = rcx - lcx
        aligned_size = width_ratio <= .18 and height_ratio <= .25
        plausible_dx = max(left[2], right[2]) * .82 <= center_dx <= max(left[2], right[2]) * 1.28
        return (left, right, (lcy + rcy) / 2.0) if same_row and adjacent and aligned_size and plausible_dx else None

    rows = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            pair = row_pair(boxes[i], boxes[j])
            if pair is not None and pair not in rows:
                rows.append(pair)
    rows.sort(key=lambda row: row[2])
    grid = None
    for i in range(len(rows) - 1):
        upper, lower = rows[i], rows[i + 1]
        ux = [upper[0][0] + upper[0][2] / 2.0, upper[1][0] + upper[1][2] / 2.0]
        lx = [lower[0][0] + lower[0][2] / 2.0, lower[1][0] + lower[1][2] / 2.0]
        row_dy = lower[2] - upper[2]
        if 12 <= row_dy <= max(55, panel_h * .18) and max(abs(ux[0] - lx[0]), abs(ux[1] - lx[1])) <= max(10, panel_w * .035):
            grid = (upper, lower)
            break
    if grid is None:
        return {
            "ok": False,
            "reason": "Tracker 2x2 mode-button grid was not geometrically resolved",
            "bandBounds": [x1, band_y1, x2, band_y2],
            "candidateBoxes": [list(box) for box in boxes],
            "rowPairCount": len(rows),
        }
    upper, lower = grid
    track_box, stabilize_box = lower[0], lower[1]

    def center(box):
        bx, by, bw, bh = box
        return int(round(bx + bw / 2.0)), int(round(by + bh / 2.0))

    track_center, stabilize_center = center(track_box), center(stabilize_box)
    return {
        "ok": True,
        "route": "TRACKER_MODE_2X2_CV_GRID",
        "bandBounds": [x1, band_y1, x2, band_y2],
        "candidateBoxes": [list(box) for box in boxes],
        "upperRow": [list(upper[0]), list(upper[1])],
        "lowerRow": [list(track_box), list(stabilize_box)],
        "trackMotionCenter": list(track_center),
        "stabilizeMotionCenter": list(stabilize_center),
        "pairDx": stabilize_center[0] - track_center[0],
        "pairDy": abs(stabilize_center[1] - track_center[1]),
    }


def locate_stabilization_tracker_panel(qwen, image, source: str):
    shared_ok, shared_attempt = locate_tracker_panel_signature(qwen, image, source + "_shared")
    if shared_ok and shared_attempt.get("bounds") and shared_attempt.get("title"):
        try:
            bounds = tuple(map(int, shared_attempt["bounds"]))
            x1, y1, x2, y2 = bounds
            title_data = shared_attempt["title"]
            title_y = int(title_data["y"])
            cv_grid = detect_tracker_mode_button_grid_cv(image, bounds, title_data)
            if cv_grid.get("ok"):
                tx, ty = map(int, cv_grid["trackMotionCenter"])
                sx, sy = map(int, cv_grid["stabilizeMotionCenter"])
                tbx, tby, tbw, tbh = map(int, cv_grid["lowerRow"][0])
                sbx, sby, sbw, sbh = map(int, cv_grid["lowerRow"][1])
                motion = SemanticPointerTarget(
                    x=tx, y=ty, confidence=.99, target="Track Motion button",
                    reason="lower-left button in verified Tracker 2x2 native mode grid",
                    bbox_pixels=(tbx, tby, tbx + tbw, tby + tbh),
                )
                stabilize = SemanticPointerTarget(
                    x=sx, y=sy, confidence=.99, target="Stabilize Motion button",
                    reason="lower-right button in verified Tracker 2x2 native mode grid",
                    bbox_pixels=(sbx, sby, sbx + sbw, sby + sbh),
                )
                title_dy = min(ty, sy) - title_y
                pair_dx = sx - tx
                pair_dy = abs(sy - ty)
                title_geometry_ok = 8 <= title_dy <= 145
                pair_geometry_ok = 24 <= pair_dx <= 160 and pair_dy <= 14
                geometry_ok = title_geometry_ok and pair_geometry_ok
                return geometry_ok, {
                    "title": title_data,
                    "trackMotion": motion.__dict__,
                    "trackMotionSemantic": {"type": "cv_geometry", "route": cv_grid["route"]},
                    "stabilizeMotion": stabilize.__dict__,
                    "stabilizeMotionSemantic": {"type": "cv_geometry", "route": cv_grid["route"]},
                    "titleDy": title_dy,
                    "pairDx": pair_dx,
                    "pairDy": pair_dy,
                    "titleGeometryOk": title_geometry_ok,
                    "pairGeometryOk": pair_geometry_ok,
                    "geometryOk": geometry_ok,
                    "bounds": list(bounds),
                    "cvButtonGrid": cv_grid,
                    "route": "STABILIZATION_SHARED_PANEL_CV_BUTTON_GRID",
                    "sharedAttemptOk": True,
                    "sharedAttempt": shared_attempt,
                }
            top_y1 = max(y1, int(title_data.get("bbox_pixels", [x1, y1, x2, y1])[1]))
            top_y2 = min(y2, max(title_y + 145, top_y1 + 90))
            top_band = image[top_y1:top_y2, x1:x2]
            if top_band.size == 0:
                raise RuntimeError("verified Tracker top-band crop was empty")
            motion_local, motion_obs = choose_pointer_target(
                top_band,
                instruction=(
                    "This image is ONLY the TOP BAND of the verified Adobe After Effects Tracker panel. "
                    "Point to the CENTER of the distinct rectangular Track Motion text button. "
                    "A separate Stabilize Motion button must be immediately to its RIGHT on the SAME ROW. "
                    "Do not point to Motion Source, Current Track, Analyze, Apply, Preview controls, or the Tracker title."
                ),
                client=qwen,
                min_confidence=.65,
            )
            stabilize_local, stabilize_obs = choose_pointer_target(
                top_band,
                instruction=(
                    "This image is ONLY the TOP BAND of the verified Adobe After Effects Tracker panel. "
                    "Point to the CENTER of the distinct rectangular Stabilize Motion text button immediately to the RIGHT of Track Motion on the SAME ROW. "
                    "Do not point to Track Motion itself, Warp Stabilizer, Analyze, Apply, Preview controls, or the Tracker title."
                ),
                client=qwen,
                min_confidence=.65,
            )
            motion = offset_pointer_target(motion_local, x1, top_y1)
            stabilize = offset_pointer_target(stabilize_local, x1, top_y1)
            pair_dx = int(stabilize.x) - int(motion.x)
            pair_dy = abs(int(stabilize.y) - int(motion.y))
            title_dy = min(int(motion.y), int(stabilize.y)) - title_y
            pair_geometry_ok = 24 <= pair_dx <= 220 and pair_dy <= 28
            title_geometry_ok = 8 <= title_dy <= 145
            geometry_ok = pair_geometry_ok and title_geometry_ok
            local_attempt = {
                "title": title_data,
                "trackMotion": motion.__dict__,
                "trackMotionSemantic": motion_obs.as_dict(),
                "stabilizeMotion": stabilize.__dict__,
                "stabilizeMotionSemantic": stabilize_obs.as_dict(),
                "titleDy": title_dy,
                "pairDx": pair_dx,
                "pairDy": pair_dy,
                "titleGeometryOk": title_geometry_ok,
                "pairGeometryOk": pair_geometry_ok,
                "geometryOk": geometry_ok,
                "bounds": list(bounds),
                "topBandBounds": [x1, top_y1, x2, top_y2],
                "route": "STABILIZATION_SHARED_PANEL_LOCAL_TOP_BAND_PAIR",
                "sharedAttemptOk": True,
                "sharedAttempt": shared_attempt,
            }
            if geometry_ok:
                return True, local_attempt
            return False, local_attempt
        except Exception as exc:
            return False, {
                "reason": f"{type(exc).__name__}: {exc}",
                "route": "STABILIZATION_SHARED_PANEL_LOCAL_TOP_BAND_PAIR",
                "sharedAttemptOk": True,
                "sharedAttempt": shared_attempt,
            }
    try:
        title, title_obs = choose_pointer_target(
            image,
            instruction=(
                "Point to the literal Tracker panel title text in Adobe After Effects. "
                "Do not point to a layer name containing TRACK or to Track Motion."
            ),
            client=qwen,
            min_confidence=.65,
        )
        motion, motion_obs = choose_pointer_target(
            image,
            instruction=(
                "Point to the rectangular Track Motion button near the TOP of the Tracker panel. "
                "A separate rectangular Stabilize Motion button must be visibly present immediately to its RIGHT on the SAME ROW. "
                "It should be below the Tracker title, not overlapping the title and not near the bottom of the panel. "
                "Do not point to Motion Source, Current Track, Analyze, Apply, a timeline control, or any lower icon."
            ),
            client=qwen,
            min_confidence=.65,
        )
        stabilize, stabilize_obs = choose_pointer_target(
            image,
            instruction=(
                "Point to the rectangular Stabilize Motion button near the TOP of the Tracker panel. "
                "It must be immediately to the RIGHT of a separate Track Motion button on the SAME ROW. "
                "Do not point to Warp Stabilizer, Track Motion itself, Analyze, Apply, Motion Source, or any lower control."
            ),
            client=qwen,
            min_confidence=.65,
        )
        if title.bbox_pixels is None or motion.bbox_pixels is None or stabilize.bbox_pixels is None:
            return False, {"reason": "stabilization Tracker anchors require bounding boxes", "sharedAttempt": shared_attempt}
        title_dy = min(int(motion.y), int(stabilize.y)) - int(title.y)
        title_dx = abs(int(round((motion.x + stabilize.x) / 2)) - int(title.x))
        pair_dx = int(stabilize.x) - int(motion.x)
        pair_dy = abs(int(stabilize.y) - int(motion.y))
        title_geometry_ok = 4 <= title_dy <= 180 and title_dx <= 360
        pair_geometry_ok = 24 <= pair_dx <= 220 and pair_dy <= 28
        geometry_ok = title_geometry_ok and pair_geometry_ok
        reground = None
        if not geometry_ok and shared_ok:
            shared_motion = shared_attempt.get("trackMotion") or {}
            retry, retry_obs = choose_pointer_target(
                image,
                instruction=(
                    "Point to the CENTER of the distinct rectangular Stabilize Motion text button in the Adobe After Effects Tracker panel. "
                    "It must be the separate button immediately to the RIGHT of Track Motion on the SAME ROW, with clear horizontal separation. "
                    "Do not point to Track Motion itself, a context menu, a layer/timeline control, Warp Stabilizer, Analyze, Apply, or a panel title."
                ),
                client=qwen,
                min_confidence=.70,
            )
            if retry.bbox_pixels is not None and shared_motion:
                retry_dx = int(retry.x) - int(shared_motion.get("x", -10_000))
                retry_dy = abs(int(retry.y) - int(shared_motion.get("y", -10_000)))
                retry_ok = 24 <= retry_dx <= 220 and retry_dy <= 28
                reground = {
                    "target": retry.__dict__,
                    "semantic": retry_obs.as_dict(),
                    "dxFromSharedTrackMotion": retry_dx,
                    "dyFromSharedTrackMotion": retry_dy,
                    "ok": retry_ok,
                }
                if retry_ok:
                    motion = SemanticPointerTarget(**{k: shared_motion[k] for k in ("x", "y", "confidence", "target", "reason", "bbox_pixels")})
                    stabilize = retry
                    stabilize_obs = retry_obs
                    pair_dx = retry_dx
                    pair_dy = retry_dy
                    pair_geometry_ok = True
                    geometry_ok = True
        h, w = image.shape[:2]
        tx1, ty1, tx2, ty2 = title.bbox_pixels
        mx1, my1, mx2, my2 = motion.bbox_pixels
        sx1, sy1, sx2, sy2 = stabilize.bbox_pixels
        bounds = (
            max(0, min(tx1, mx1, sx1) - 28),
            max(0, min(ty1, my1, sy1) - 18),
            min(w - 1, max(tx2, mx2, sx2) + 240),
            min(h - 1, max(my2, sy2) + 250, ty2 + 280),
        )
        if reground and reground.get("ok") and shared_ok and shared_attempt.get("bounds"):
            bounds = tuple(shared_attempt["bounds"])
        return geometry_ok, {
            "title": title.__dict__,
            "titleSemantic": title_obs.as_dict(),
            "trackMotion": motion.__dict__,
            "trackMotionSemantic": shared_attempt.get("trackMotionSemantic") if reground and reground.get("ok") else motion_obs.as_dict(),
            "stabilizeMotion": stabilize.__dict__,
            "stabilizeMotionSemantic": stabilize_obs.as_dict(),
            "titleDy": title_dy,
            "titleDx": title_dx,
            "pairDx": pair_dx,
            "pairDy": pair_dy,
            "titleGeometryOk": title_geometry_ok,
            "pairGeometryOk": pair_geometry_ok,
            "sharedPanelStabilizeReground": reground,
            "geometryOk": geometry_ok,
            "bounds": list(bounds),
            "route": "STABILIZATION_SHARED_PANEL_REGROUNDED_PAIR" if reground and reground.get("ok") else "STABILIZATION_THREE_ANCHOR_TOP_ROW_SIGNATURE",
            "sharedAttemptOk": shared_ok,
            "sharedAttempt": shared_attempt,
        }
    except Exception as exc:
        return False, {"reason": f"{type(exc).__name__}: {exc}", "sharedAttempt": shared_attempt}


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
    panel_ok, panel = locate_stabilization_tracker_panel(qwen, image, "m4_stabilize_panel_initial")
    proof["panelInitial"] = panel
    if not panel_ok:
        proof["windowMenu"] = await guarded_click_target(
            eyes, hands, qwen, output,
            "Point to the Window menu label in the top Adobe After Effects menu bar. Do not choose a dropdown item.",
            "stabilize_window_menu",
        )
        _meta, menu = await capture(eyes, hands, output, "stabilize_window_menu_open", focus=False)
        visible, menu_evidence = verify_visible(qwen, menu, "The Window menu dropdown is open and visibly contains a Tracker item.", "m4_stabilize_window_menu")
        proof["windowMenuVerified"] = menu_evidence
        if not visible:
            raise RuntimeError("Window menu did not expose Tracker")
        # After Effects documents Window > Panel as the canonical open-or-bring-to-front action,
        # including when the panel is already open beneath another panel. Avoid two fragile
        # checkmark-classification calls and prove the frontmost Tracker content after selection.
        tools_anchor, tools_observation = choose_pointer_target(
            menu,
            instruction="Point to the Tools item in the currently open Adobe After Effects Window menu. Do not point to Tracker or another menu item.",
            client=qwen,
            min_confidence=0.60,
        )
        proof["trackerMenuToolsAnchor"] = {
            "target": tools_anchor.__dict__,
            "semantic": tools_observation.as_dict(),
        }
        proof["trackerMenuItem"] = await guarded_click_target(
            eyes, hands, qwen, output,
            "Point to the Tracker menu item in the currently open Adobe After Effects Window menu. "
            "It is the bottom visible item, immediately below Tools. Selecting Tracker is the canonical "
            "open-or-bring-to-front action. Do not point to Tools, Preview, Progress, Properties, or the Tracker panel itself.",
            "stabilize_tracker_menu_item",
            target_validator=lambda target: validate_menu_item_below(tools_anchor, target),
            preserve_transient=True,
        )
        proof["trackerMenuAction"] = "WINDOW_MENU_SELECT_TRACKER_OPEN_OR_FRONT"
        _meta, image = await capture(eyes, hands, output, "stabilize_tracker_panel_open")
        panel_ok, panel = locate_stabilization_tracker_panel(
            qwen, image, "m4_stabilize_panel_after_window_selection",
        )
        proof["panelAfterWindowSelection"] = panel
        if not panel_ok:
            raise RuntimeError("Window > Tracker did not expose verified frontmost Tracker content")
    if not panel_ok:
        raise RuntimeError("Tracker panel geometry was not visually verified")
    proof["panelReady"] = panel
    return image, panel


async def ensure_bound_layer_view_active(eyes, hands, qwen, output: Path, image, panel: dict, request: dict, proof: dict):
    layer_name = json.dumps(request["expectedLayerName"], ensure_ascii=False)
    active, evidence = verify_visible(
        qwen, image,
        f"The active viewer is the Layer viewer for {layer_name}; its Layer tab is selected/active and the Composition tab is not the active viewer.",
        "m4_stabilize_layer_view_pre",
    )
    proof["layerViewPre"] = evidence
    if active:
        rebound, rebound_evidence = verify_binding(
            qwen, image, request, "m4_stabilize_binding_layer_view_already_active",
        )
        proof["bindingLayerViewActive"] = rebound_evidence
        if not rebound:
            raise RuntimeError("typed stabilization binding is not preserved by the already-active bound Layer viewer")
        panel_ok, post_panel = locate_stabilization_tracker_panel(
            qwen, image, "m4_stabilize_panel_layer_view_already_active",
        )
        proof["panelAfterLayerViewActivate"] = post_panel
        if not panel_ok:
            raise RuntimeError("Tracker panel geometry is unavailable with the already-active bound Layer viewer")
        proof["layerViewPath"] = "ALREADY_ACTIVE_BOUND_LAYER_VIEWER_VERIFIED"
        return image, post_panel
    h, _w = image.shape[:2]
    max_tab_y = max(120, int(round(h * .20)))
    def validate_layer_tab(target):
        if target.bbox_pixels is None:
            return "bound Layer viewer tab requires a freshness bounding box"
        if int(target.y) > max_tab_y:
            return f"bound Layer viewer tab escaped the viewer-tab band (y={int(target.y)}, max={max_tab_y})"
        return None
    proof["layerViewActivate"] = await guarded_click_target(
        eyes, hands, qwen, output,
        f"Point to the viewer tab labeled Layer {request['expectedLayerName']}. Point to the viewer tab itself next to the Composition tab, not the Timeline layer, Motion Source field, or any Tracker control.",
        "stabilize_bound_layer_view_tab",
        target_validator=validate_layer_tab,
    )
    await asyncio.sleep(.30)
    _meta, post = await capture(eyes, hands, output, "stabilize_bound_layer_view_active")
    active, post_evidence = verify_visible(
        qwen, post,
        f"The active viewer is now the Layer viewer for {layer_name}; its Layer tab is selected/active and the Composition tab is not the active viewer.",
        "m4_stabilize_layer_view_post",
    )
    proof["layerViewPost"] = post_evidence
    if not active:
        raise RuntimeError("bound Layer viewer did not become active before native tracking")
    rebound, rebound_evidence = verify_binding(qwen, post, request, "m4_stabilize_binding_layer_view_active")
    proof["bindingLayerViewActive"] = rebound_evidence
    if not rebound:
        raise RuntimeError("typed stabilization binding changed while activating the bound Layer viewer")
    panel_ok, post_panel = locate_stabilization_tracker_panel(qwen, post, "m4_stabilize_panel_layer_view_active")
    proof["panelAfterLayerViewActivate"] = post_panel
    if not panel_ok:
        raise RuntimeError("Tracker panel geometry disappeared while activating the bound Layer viewer")
    proof["layerViewPath"] = "ACTIVATED_BOUND_LAYER_VIEWER"
    return post, post_panel


async def switch_existing_tracker_to_stabilize(eyes, hands, qwen, output: Path, image, panel: dict, proof: dict):
    track_ready, track_evidence = verify_visible(
        qwen, image,
        "The Tracker panel visibly has a selected Current Track whose value is not None. A real tracker must already exist before changing Track Type.",
        "m4_stabilize_fallback_track_ready",
    )
    proof["modeFallbackTrackReady"] = track_evidence
    if not track_ready:
        raise RuntimeError("Stabilize Motion did not create a current tracker and Track Type fallback is unsafe")
    bounds = tuple(panel["bounds"])
    x1, y1, x2, y2 = map(int, bounds)
    panel_width = max(1, x2 - x1)
    panel_height = max(1, y2 - y1)
    label_search_y1 = min(y2 - 1, y1 + max(24, int(round(panel_height * 0.18))))
    label_crop = image[label_search_y1:y2, x1:x2]
    if label_crop.size == 0:
        raise RuntimeError("Track Type semantic search crop was empty")
    track_type_label_local, track_type_observation = choose_pointer_target(
        label_crop,
        instruction="Point to the literal Track Type label text in the Adobe After Effects Tracker panel. It must be BELOW Current Track and above the Position/Rotation/Scale controls. Point to the label text itself, not a button, selected value, dropdown arrow, Current Track, or Motion Source.",
        client=qwen,
        min_confidence=0.60,
    )
    track_type_label = offset_pointer_target(track_type_label_local, x1, label_search_y1)
    if track_type_label.bbox_pixels is None:
        raise RuntimeError("Track Type label requires a bounded visual target")
    if not (x1 <= track_type_label.x <= x2 and label_search_y1 <= track_type_label.y <= y2):
        raise RuntimeError("Track Type label escaped constrained Tracker panel body")
    label_right = int(track_type_label.bbox_pixels[2])
    row_half_height = max(14, int(round(panel_height * 0.055)))
    field_ground_bounds = (
        max(x1, label_right + 2),
        max(y1, int(track_type_label.y) - row_half_height),
        x2,
        min(y2, int(track_type_label.y) + row_half_height + 1),
    )
    if field_ground_bounds[2] <= field_ground_bounds[0] or field_ground_bounds[3] <= field_ground_bounds[1]:
        raise RuntimeError("Track Type field grounding crop was empty")
    min_field_dx = max(12, int(round(panel_width * 0.03)))
    max_field_dy = row_half_height
    def validate_track_type_field(target):
        if target.bbox_pixels is None:
            return "Track Type dropdown field requires a bounded visual target"
        dx = int(target.x) - int(track_type_label.x)
        dy = abs(int(target.y) - int(track_type_label.y))
        if dx < min_field_dx:
            return f"Track Type dropdown field is not to the right of the Track Type label (dx={dx}, required>={min_field_dx})"
        if dy > max_field_dy:
            return f"Track Type dropdown field is not on the Track Type row (dy={dy}, allowed<={max_field_dy})"
        return None
    proof["trackTypeLabel"] = {
        "target": track_type_label.__dict__,
        "semantic": track_type_observation.as_dict(),
        "searchBounds": [x1, label_search_y1, x2, y2],
    }
    proof["trackTypeDropdown"] = await guarded_click_target(
        eyes, hands, qwen, output,
        "Point to the Track Type dropdown FIELD on this same row. Its selected value may be Transform or another tracking type. Point to the field/value area immediately to the right of the Track Type label; do not infer a value from another row. Do not point to the upper Track Motion button, Current Track, Motion Source, Stabilize Motion, Analyze, or Apply.",
        "stabilize_track_type_dropdown", bounds, validate_track_type_field,
        ground_bounds=field_ground_bounds,
    )
    field_target = proof["trackTypeDropdown"]["target"]
    proof["trackTypeFieldRelation"] = {
        "label": {"x": track_type_label.x, "y": track_type_label.y},
        "field": {"x": field_target["x"], "y": field_target["y"]},
        "dx": int(field_target["x"]) - int(track_type_label.x),
        "dy": abs(int(field_target["y"]) - int(track_type_label.y)),
        "minDx": min_field_dx,
        "maxDy": max_field_dy,
        "groundBounds": list(field_ground_bounds),
    }
    await asyncio.sleep(0.25)
    _meta, menu = await capture(eyes, hands, output, "stabilize_track_type_menu", focus=False)
    visible, menu_evidence = verify_visible(
        qwen, menu,
        "The Track Type dropdown menu is open in the Tracker panel and visibly contains an option named Stabilize.",
        "m4_stabilize_track_type_menu",
    )
    proof["trackTypeMenu"] = menu_evidence
    if not visible:
        raise RuntimeError("Track Type dropdown did not expose Stabilize")
    proof["trackTypeStabilizeItem"] = await guarded_click_target(
        eyes, hands, qwen, output,
        "Point to the Stabilize option in the currently open Track Type dropdown menu. Do not point to Transform, Raw, Perspective Corner Pin, or any control outside the open dropdown.",
        "stabilize_track_type_item",
        preserve_transient=True,
    )
    await asyncio.sleep(0.35)
    _meta, post = await capture(eyes, hands, output, "stabilize_track_type_selected")
    panel_ok, post_panel = locate_stabilization_tracker_panel(qwen, post, "m4_stabilize_panel_after_track_type")
    if not panel_ok:
        raise RuntimeError("Tracker panel disappeared after Track Type stabilization selection")
    ready, evidence = verify_visible(
        qwen, post,
        "The Tracker panel is in native Stabilize Motion mode: Current Track is not None, Track Type is Stabilize, and Position stabilization is enabled.",
        "m4_stabilize_mode_after_track_type",
    )
    proof["modeReadyAfterTrackType"] = evidence
    if not ready:
        raise RuntimeError("Track Type fallback did not enter verified Stabilize mode")
    proof["modeEntryPath"] = "TRACKER_CREATED_THEN_TRACK_TYPE_STABILIZE"
    return post, post_panel


async def create_current_tracker_via_verified_track_motion(eyes, hands, qwen, output: Path, image, panel: dict, proof: dict):
    baseline_track = panel.get("trackMotion") or {}
    baseline_stabilize = panel.get("stabilizeMotion") or {}
    if not isinstance(baseline_track.get("bbox_pixels"), (list, tuple)) or len(baseline_track.get("bbox_pixels")) != 4:
        raise RuntimeError("verified Track Motion anchor has no freshness bounding box")
    _ground_meta, ground = await capture(eyes, hands, output, "track_motion_create_ground")
    panel_ok, fresh_panel = locate_stabilization_tracker_panel(qwen, ground, "m4_stabilize_track_motion_create_panel")
    proof["trackMotionCreatePanel"] = fresh_panel
    if not panel_ok:
        raise RuntimeError("Tracker panel was not verified before Track Motion tracker creation")
    fresh_track = fresh_panel.get("trackMotion") or {}
    fresh_stabilize = fresh_panel.get("stabilizeMotion") or {}
    tx, ty = int(fresh_track.get("x", -1)), int(fresh_track.get("y", -1))
    sx, sy = int(fresh_stabilize.get("x", -1)), int(fresh_stabilize.get("y", -1))
    tbbox = fresh_track.get("bbox_pixels")
    if tx < 0 or ty < 0 or sx < 0 or sy < 0 or not isinstance(tbbox, (list, tuple)) or len(tbbox) != 4:
        raise RuntimeError("fresh verified Track Motion/Stabilize Motion pair is incomplete")
    bounds = tuple(fresh_panel["bounds"])
    panel_width = max(1, int(bounds[2] - bounds[0]))
    panel_height = max(1, int(bounds[3] - bounds[1]))
    min_dx = max(24, int(round(panel_width * 0.06)))
    max_dy = max(18, int(round(panel_height * 0.08)))
    pair_dx = sx - tx
    pair_dy = abs(sy - ty)
    if pair_dx < min_dx or pair_dy > max_dy:
        raise RuntimeError(f"fresh Track Motion/Stabilize Motion pair geometry is invalid (dx={pair_dx}, dy={pair_dy})")
    baseline_dx = abs(tx - int(baseline_track.get("x", tx)))
    baseline_dy = abs(ty - int(baseline_track.get("y", ty)))
    drift_limit = max(18, int(round(panel_width * 0.05)))
    if baseline_dx > drift_limit or baseline_dy > drift_limit:
        raise RuntimeError(f"Track Motion anchor drifted before tracker creation (dx={baseline_dx}, dy={baseline_dy}, allowed<={drift_limit})")
    changed = target_patch_change(image, ground, tuple(map(int, tbbox)))
    if changed > .12:
        raise RuntimeError(f"verified Track Motion anchor changed before tracker-creation action ({changed:.3f})")
    status = structured(await hands.call_tool("hands_status", {}))
    transform = CoordinateTransform.from_status(_ground_meta, status)
    screen_x, screen_y = transform.encoded_to_screen(tx, ty)
    clicked = await hands.call_tool("hands_click", {"x": screen_x, "y": screen_y, "button": "left", "count": 1})
    if clicked.is_error:
        raise RuntimeError("Hands click failed for verified Track Motion tracker creation")
    proof["trackMotionCreateClick"] = {
        "target": fresh_track,
        "siblingStabilizeMotion": fresh_stabilize,
        "screen": {"x": screen_x, "y": screen_y},
        "target_patch_changed_fraction": changed,
        "pairDx": pair_dx,
        "pairDy": pair_dy,
        "route": "VERIFIED_TRACK_MOTION_SIBLING_PAIR_CREATE_TRACKER",
    }
    await asyncio.sleep(0.65)
    _post_meta, post = await capture(eyes, hands, output, "track_motion_create_post")
    post_ok, post_panel = locate_stabilization_tracker_panel(qwen, post, "m4_stabilize_track_motion_create_post_panel")
    proof["trackMotionCreatePostPanel"] = post_panel
    if not post_ok:
        raise RuntimeError("Tracker panel disappeared after Track Motion tracker-creation action")
    relation_ok = verify_selected_current_track_relation(qwen, post, post_panel, proof)
    proof["currentTrackRelationAfterTrackMotionCreate"] = proof.get("currentTrackRelation")
    if not relation_ok:
        raise RuntimeError("Track Motion fallback did not create a geometrically verified non-None Current Track")
    proof["trackerCreationPath"] = "VERIFIED_TRACK_MOTION_BUTTON_CURRENT_TRACK_RELATION"
    return post, post_panel


async def ensure_stabilize_mode(eyes, hands, qwen, output: Path, image, panel: dict, proof: dict):
    ready, evidence = verify_visible(
        qwen, image,
        "The Tracker panel is already in native Stabilize Motion mode: Current Track is not None, Track Type is Stabilize, and Position stabilization is enabled.",
        "m4_stabilize_mode_pre",
    )
    proof["modePre"] = evidence
    if not ready:
        bounds = tuple(panel["bounds"])
        track_motion = panel.get("trackMotion") or {}
        stabilize_motion = panel.get("stabilizeMotion") or {}
        track_x = int(track_motion.get("x", -1))
        track_y = int(track_motion.get("y", -1))
        stabilize_x = int(stabilize_motion.get("x", -1))
        stabilize_y = int(stabilize_motion.get("y", -1))
        panel_width = max(1, int(bounds[2] - bounds[0]))
        panel_height = max(1, int(bounds[3] - bounds[1]))
        min_dx = max(24, int(round(panel_width * 0.06)))
        max_dy = max(18, int(round(panel_height * 0.08)))
        if track_x < 0 or track_y < 0 or stabilize_x < 0 or stabilize_y < 0:
            raise RuntimeError("verified Track Motion/Stabilize Motion pair is unavailable")
        pair_dx = stabilize_x - track_x
        pair_dy = abs(stabilize_y - track_y)
        if pair_dx < min_dx:
            raise RuntimeError(f"verified Stabilize Motion anchor is not to the right of Track Motion (dx={pair_dx}, required>={min_dx})")
        if pair_dy > max_dy:
            raise RuntimeError(f"verified Stabilize Motion anchor is not on the Track Motion row (dy={pair_dy}, allowed<={max_dy})")
        bbox = stabilize_motion.get("bbox_pixels")
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            raise RuntimeError("verified Stabilize Motion anchor has no freshness bounding box")
        action_meta, fresh = await capture(eyes, hands, output, "stabilize_motion_pair_fresh")
        changed = target_patch_change(image, fresh, tuple(map(int, bbox)))
        if changed > .12:
            raise RuntimeError(f"verified Stabilize Motion anchor changed before action ({changed:.3f})")
        status = structured(await hands.call_tool("hands_status", {}))
        transform = CoordinateTransform.from_status(action_meta, status)
        screen_x, screen_y = transform.encoded_to_screen(stabilize_x, stabilize_y)
        clicked = await hands.call_tool("hands_click", {"x": screen_x, "y": screen_y, "button": "left", "count": 1})
        if clicked.is_error:
            raise RuntimeError("Hands click failed for verified Stabilize Motion pair")
        proof["stabilizeMotionClick"] = {
            "target": stabilize_motion,
            "screen": {"x": screen_x, "y": screen_y},
            "target_patch_changed_fraction": changed,
            "route": "VERIFIED_THREE_ANCHOR_PANEL_PAIR",
        }
        stabilize_target = proof["stabilizeMotionClick"]["target"]
        proof["stabilizeMotionRelation"] = {
            "trackMotion": {"x": track_x, "y": track_y},
            "stabilizeMotion": {"x": stabilize_target["x"], "y": stabilize_target["y"]},
            "dx": int(stabilize_target["x"]) - track_x,
            "dy": abs(int(stabilize_target["y"]) - track_y),
            "minDx": min_dx,
            "maxDy": max_dy,
        }
        await asyncio.sleep(0.55)
        _meta, image = await capture(eyes, hands, output, "stabilize_mode_selected")
        ready, evidence = verify_visible(
            qwen, image,
            "The Tracker panel is in native Stabilize Motion mode: Current Track is not None, Track Type is Stabilize, and Position stabilization is enabled.",
            "m4_stabilize_mode_ready",
        )
        proof["modeReady"] = evidence
        proof["modeReadyBroadSemanticAdvisory"] = ready
        proof["postModePanelBounds"] = list(panel["bounds"])
        relation_ok = verify_selected_current_track_relation(qwen, image, panel, proof)
        proof["currentTrackRelationAfterStabilizeClick"] = proof.get("currentTrackRelation")
        if not relation_ok:
            image, panel = await create_current_tracker_via_verified_track_motion(
                eyes, hands, qwen, output, image, panel, proof,
            )
        if not ready:
            proof["modeDirectSemanticReady"] = False
            image, panel = await switch_existing_tracker_to_stabilize(
                eyes, hands, qwen, output, image, panel, proof,
            )
        else:
            proof["modeDirectSemanticReady"] = True
            proof["modeEntryPath"] = "DIRECT_STABILIZE_MOTION_CURRENT_TRACK_RELATIONAL_PROTOCOL_2_3_VERIFY"
    else:
        proof["modeEntryPath"] = "ALREADY_STABILIZE_MODE"
    return image, panel


def verify_selected_current_track_relation(qwen, image, panel: dict, proof: dict) -> bool:
    bounds = tuple(panel["bounds"])
    x1, y1, x2, y2 = map(int, bounds)
    panel_crop = image[y1:y2, x1:x2]
    if panel_crop.size == 0:
        proof["currentTrackRelation"] = {
            "panelCropUsed": True,
            "panelBounds": list(bounds),
            "ok": False,
            "reason": "verified Tracker panel crop was empty",
        }
        return False
    try:
        label_local, label_obs = choose_pointer_target(
            panel_crop,
            instruction=(
                "This image is ONLY the verified Adobe After Effects Tracker panel. "
                "Point to the literal Current Track label text. "
                "Do not point to the selected track value, Motion Source, Motion Target, or any button."
            ),
            client=qwen,
            min_confidence=.65,
        )
        value_local, value_obs = choose_pointer_target(
            panel_crop,
            instruction=(
                "This image is ONLY the verified Adobe After Effects Tracker panel. "
                "Point to the currently selected NON-NONE Current Track value on the same horizontal row immediately to the RIGHT of the literal Current Track label. "
                "The visible value is typically Tracker 1. Do not point to the Current Track label itself, None, Motion Source, Motion Target, or a button."
            ),
            client=qwen,
            min_confidence=.65,
        )
        label = offset_pointer_target(label_local, x1, y1)
        value = offset_pointer_target(value_local, x1, y1)
    except Exception as exc:
        proof["currentTrackRelation"] = {
            "panelCropUsed": True,
            "panelBounds": list(bounds),
            "ok": False,
            "route": "SEMANTIC_RELATION_REFUSED",
            "reason": exception_detail(exc),
        }
        return False
    inside = (
        x1 <= label.x <= x2 and y1 <= label.y <= y2
        and x1 <= value.x <= x2 and y1 <= value.y <= y2
    )
    dx = int(value.x) - int(label.x)
    dy = abs(int(value.y) - int(label.y))
    min_dx = max(18, int(round((x2 - x1) * .045)))
    max_dy = max(14, int(round((y2 - y1) * .06)))
    non_none = "none" not in str(value.target).lower()
    relation_ok = inside and dx >= min_dx and dy <= max_dy and non_none
    proof["currentTrackRelation"] = {
        "panelCropUsed": True,
        "panelBounds": list(bounds),
        "label": {"target": label.__dict__, "semantic": label_obs.as_dict()},
        "value": {"target": value.__dict__, "semantic": value_obs.as_dict()},
        "insideVerifiedPanel": inside,
        "dx": dx,
        "dy": dy,
        "minDx": min_dx,
        "maxDy": max_dy,
        "nonNone": non_none,
        "ok": relation_ok,
    }
    return relation_ok


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


def ground_forward_analyze_near_label(qwen, image, proof: dict) -> dict:
    anchor, anchor_obs = choose_pointer_target(
        image,
        instruction=(
            "Point to the literal Analyze label text inside the Adobe After Effects Tracker panel. "
            "Do not point to Preview playback controls, a triangle button, Current Track, or Motion Target."
        ),
        client=qwen,
        min_confidence=.70,
    )
    if anchor.bbox_pixels is None:
        raise RuntimeError("Analyze label did not provide a bounded visual anchor")
    h, w = image.shape[:2]
    x1 = max(0, int(anchor.x) - 100)
    y1 = max(0, int(anchor.y) - 60)
    x2 = min(w, int(anchor.x) + 260)
    y2 = min(h, int(anchor.y) + 25)
    crop = image[y1:y2, x1:x2]
    detected = detect_analyze_row_cv(crop)
    boxes, centers = detected["bboxes"], detected["centers"]
    row_y = float(detected["rowY"]) + y1
    first_x = float(centers[0][0]) + x1
    if not (anchor.x < first_x and abs(float(anchor.y) - row_y) <= 18):
        raise RuntimeError("Analyze label anchor disagreed with the local four-control row geometry")
    pb, nb = boxes[2], boxes[3]
    pc, nc = centers[2], centers[3]
    primary = SemanticPointerTarget(
        x=int(round(pc[0])), y=int(round(pc[1])), confidence=min(.99, float(anchor.confidence)),
        target="continuous Analyze Forward", reason="third group in Analyze-label-local 2-1-1-2 row signature", bbox_pixels=pb,
    )
    neighbor = SemanticPointerTarget(
        x=int(round(nc[0])), y=int(round(nc[1])), confidence=min(.99, float(anchor.confidence)),
        target="one-frame forward", reason="fourth group in Analyze-label-local 2-1-1-2 row signature", bbox_pixels=nb,
    )
    row_ok, row_evidence = verify_visible(
        qwen, crop,
        "The Analyze row contains four adjacent directional controls: one-frame backward, Analyze Backward, Analyze Forward, and one-frame forward.",
        "m4_stabilize_analyze_row_local",
    )
    proof["analyzeLabelAnchor"] = {"target": anchor.__dict__, "semantic": anchor_obs.as_dict(), "rowAdvisory": row_evidence, "rowAdvisoryMatch": row_ok}
    return {
        "primary": offset_pointer_target(primary, x1, y1),
        "neighbor": offset_pointer_target(neighbor, x1, y1),
        "cv_signature": detected,
        "panel_bounds": [x1, y1, x2, y2],
        "image": image,
        "control_index": 2,
        "direction": "FORWARD",
    }


async def maximize_tracker_panel_for_analysis(eyes, hands, qwen, output: Path, image, request: dict, proof: dict):
    meta, fresh = await capture(eyes, hands, output, "stabilize_tracker_pre_maximize")
    ok, panel = locate_stabilization_tracker_panel(qwen, fresh, "m4_stabilize_panel_pre_maximize")
    if not ok:
        raise RuntimeError("Tracker panel geometry was unavailable before maximize")
    bounds = tuple(panel["bounds"])
    panel_hover, panel_hover_obs = choose_pointer_target(
        fresh,
        instruction=(
            "Point to an empty safe background area well INSIDE the visible Adobe After Effects Tracker panel body. "
            "Do not point to the Tracker tab/title strip, any button, dropdown, checkbox, text field, label, timeline, "
            "layer panel, scrollbar thumb, or another panel. This point is only for placing the mouse over Tracker "
            "before the Grave/Tilde maximize shortcut."
        ),
        client=qwen,
        min_confidence=0.0,
    )
    x1, y1, x2, y2 = bounds
    px, py = int(panel_hover.x), int(panel_hover.y)
    inside_safe_body = (
        panel_hover.confidence >= 0.85
        and x1 + 12 <= px <= x2 - 12
        and y1 + 24 <= py <= y2 - 18
    )
    proof["trackerPanelBodyHover"] = {
        "target": panel_hover.__dict__,
        "semantic": panel_hover_obs.as_dict(),
        "bounds": list(bounds),
        "insideSafeBody": inside_safe_body,
    }
    if not inside_safe_body:
        raise RuntimeError(
            f"Tracker panel body could not be safely grounded before maximize: "
            f"target={panel_hover.target!r} x={px} y={py} confidence={panel_hover.confidence:.3f}"
        )
    status = structured(await hands.call_tool("hands_status", {}))
    transform = CoordinateTransform.from_status(meta, status)
    sx, sy = transform.encoded_to_screen(px, py)
    moved = await hands.call_tool("hands_move", {"x": sx, "y": sy})
    if moved.is_error:
        raise RuntimeError("Hands could not move inside the verified Tracker panel before maximize")
    proof["trackerPanelMaximizeHover"] = {"encoded": {"x": px, "y": py}, "screen": {"x": sx, "y": sy}}
    await asyncio.sleep(.05)
    toggled = await hands.call_tool("hands_keypress", {"keys": ["GRAVE"]})
    if toggled.is_error:
        raise RuntimeError("Hands could not maximize the verified Tracker panel")
    await asyncio.sleep(.45)
    max_meta, maximized = await capture(eyes, hands, output, "stabilize_tracker_maximized")
    if meta.get("geometry") != max_meta.get("geometry"):
        raise RuntimeError("Eyes geometry changed while maximizing Tracker panel")
    h, w = fresh.shape[:2]
    changed_fraction = target_patch_change(fresh, maximized, (0, 0, w, h))
    proof["trackerPanelMaximizeVisualChange"] = {
        "changedFraction": changed_fraction,
        "minimumRequired": .03,
    }
    if changed_fraction < .03:
        raise RuntimeError("Grave toggle produced too little whole-frame change to establish a panel-layout transition")
    return maximized, True


async def click_forward_analyze(eyes, hands, qwen, output: Path, grounded: dict, proof: dict):
    _meta, fresh = await capture(eyes, hands, output, "stabilize_analyze_action_fresh")
    ok, panel = locate_stabilization_tracker_panel(qwen, fresh, "m4_stabilize_panel_before_analyze")
    if not ok:
        raise RuntimeError("Tracker panel geometry changed before Analyze")
    # Semantic panel verification can take several seconds. Re-focus and recapture
    # after it so a foreground switch cannot open a reasoning-to-action race.
    action_meta, action_fresh = await capture(
        eyes, hands, output, "stabilize_analyze_action_verified",
    )
    primary, neighbor = grounded["primary"], grounded["neighbor"]
    primary_change = target_patch_change(grounded["image"], action_fresh, primary.bbox_pixels)
    neighbor_change = target_patch_change(grounded["image"], action_fresh, neighbor.bbox_pixels)
    status = structured(await hands.call_tool("hands_status", {}))
    proof["analyzeActionGate"] = {
        "primaryPatchChangedFraction": primary_change,
        "neighborPatchChangedFraction": neighbor_change,
        "actionAllowed": bool(status.get("action_allowed", False)),
        "foreground": status.get("foreground"),
        "actionFrameId": action_meta.get("frame_id"),
    }
    if primary_change > .12 or neighbor_change > .12:
        raise RuntimeError("Analyze row changed before action")
    if not status.get("action_allowed", False):
        raise RuntimeError("After Effects was not foreground at the verified Analyze action checkpoint")
    transform = CoordinateTransform.from_status(action_meta, status)
    sx, sy = transform.encoded_to_screen(primary.x, primary.y)
    clicked = await hands.call_tool("hands_click", {"x": sx, "y": sy, "button": "left", "count": 1})
    if clicked.is_error:
        detail = tool_result_detail(clicked)
        proof["analyzeClickFailure"] = {"x": sx, "y": sy, "detail": detail}
        raise RuntimeError(f"Analyze Forward click failed: {detail}")
    proof["analyzeClick"] = {"x": sx, "y": sy, "panel": panel}


async def apply_stabilization(eyes, hands, qwen, output: Path, proof: dict):
    meta, image = await capture(eyes, hands, output, "stabilize_before_apply")
    ok, panel = locate_stabilization_tracker_panel(qwen, image, "m4_stabilize_panel_apply")
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
    gok, gpanel = locate_stabilization_tracker_panel(qwen, gimg, "m4_stabilize_apply_cv")
    if not gok: raise RuntimeError("Tracker panel geometry missing for Apply")
    x1, y1, x2, y2 = map(int, gpanel["bounds"]); top = y1 + int((y2-y1)*.50)
    roi = cv2.cvtColor(gimg[top:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    mask = cv2.inRange(roi, 55, 135); mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT,(5,3)))
    contours,_ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cands=[]
    panel_width = x2 - x1
    min_button_width = int(panel_width * .20)
    max_button_width = int(panel_width * .55)
    for c in contours:
        x,y,w,h=cv2.boundingRect(c)
        if min_button_width<=w<=max_button_width and 14<=h<=36 and w*h>=500:
            cands.append({"x":x1+x+w//2,"y":top+y+h//2,"bbox":(x1+x,top+y,x1+x+w,top+y+h)})
    proof["applyButtonGeometry"] = {
        "minimumWidthRatio": .20,
        "maximumWidthRatio": .55,
        "minimumWidthPixels": min_button_width,
        "maximumWidthPixels": max_button_width,
        "candidates": cands,
    }
    if len(cands)<2: raise RuntimeError("Tracker button geometry missing")
    by=max(v["y"] for v in cands); row=[v for v in cands if abs(v["y"]-by)<=8]
    if len(row)<2: raise RuntimeError("Reset/Apply row missing")
    reset_target=min(row,key=lambda v:v["x"])
    target=max(row,key=lambda v:v["x"])
    pair_dx = target["x"] - reset_target["x"]
    pair_dy = abs(target["y"] - reset_target["y"])
    minimum_pair_dx = max(40, int(panel_width * .18))
    bottom_minimum_y = y1 + int((y2-y1)*.68)
    proof["applyButtonRelation"] = {
        "resetTarget": reset_target,
        "applyTarget": target,
        "pairDx": pair_dx,
        "pairDy": pair_dy,
        "minimumPairDx": minimum_pair_dx,
        "bottomMinimumY": bottom_minimum_y,
    }
    if pair_dx < minimum_pair_dx or pair_dy > 8 or target["y"] <= bottom_minimum_y:
        raise RuntimeError("CV Apply target escaped expected bottom-right Tracker geometry")
    ameta,aimg=await capture(eyes,hands,output,"stabilize_apply_cv_action")
    if gmeta.get("geometry") != ameta.get("geometry"):
        raise RuntimeError("Eyes geometry changed before Apply")
    changed=target_patch_change(gimg,aimg,target["bbox"])
    if changed > .12:
        raise RuntimeError(f"Apply target changed before action ({changed:.3f})")
    status=structured(await hands.call_tool("hands_status",{}))
    proof["applyActionGate"] = {
        "actionAllowed": bool(status.get("action_allowed", False)),
        "foreground": status.get("foreground"),
        "actionFrameId": ameta.get("frame_id"),
        "targetPatchChangedFraction": changed,
    }
    if not status.get("action_allowed", False):
        raise RuntimeError("After Effects was not foreground at the verified Apply action checkpoint")
    transform=CoordinateTransform.from_status(ameta,status)
    sx,sy=transform.encoded_to_screen(target["x"],target["y"]); clicked=await hands.call_tool("hands_click",{"x":sx,"y":sy,"button":"left","count":1})
    if clicked.is_error:
        detail = tool_result_detail(clicked)
        proof["applyClickFailure"] = {"target": target, "screen": {"x": sx, "y": sy}, "detail": detail}
        raise RuntimeError(f"Apply click failed: {detail}")
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
    global LAST_PROOF
    request = validate_request(request)
    qwen = LocalQwenVLClient()
    health = qwen.health()
    proof = {
        "driverId": "editgpt.eyes-hands.stabilization.v1",
        "targetBinding": target_binding(request),
        "semanticHealth": health,
    }
    LAST_PROOF = proof
    if not health.get("ok"):
        raise RuntimeError("local EditGPT semantic model is not ready")
    async with Client(EYES_URL) as eyes, Client(HANDS_URL) as hands:
        armed = await hands.call_tool("hands_arm", {})
        if armed.is_error:
            raise RuntimeError("EditGPT Hands could not arm")
        started_here = False
        maximized_here = False
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
            image = await ensure_timeline_layer_selected(
                eyes, hands, qwen, output, image, request["expectedLayerName"], proof, "stabilize",
                require_visible_selection=False,
            )
            panel_ok, selected_panel = locate_stabilization_tracker_panel(
                qwen, image, "m4_stabilize_panel_after_timeline_selection",
            )
            proof["panelAfterTimelineLayerSelection"] = selected_panel
            if not panel_ok:
                raise RuntimeError("Tracker panel changed while selecting the exact tracking target Timeline layer")
            panel = selected_panel
            image, panel = await ensure_bound_layer_view_active(eyes, hands, qwen, output, image, panel, request, proof)
            image, panel = await ensure_stabilize_mode(eyes, hands, qwen, output, image, panel, proof)
            try:
                grounded = ground_forward_analyze(image, panel)
                proof["analyzeGroundPath"] = "DIRECT_TRACKER_PANEL_CV"
            except RuntimeError as exc:
                proof["analyzeGroundInitialFailure"] = f"{type(exc).__name__}: {exc}"
                proof["analyzeGroundEscalation"] = "BOUNDED_TRACKER_PANEL_REVEAL"
                image, revealed_bounds = await reveal_analyze_row(
                    eyes, hands, qwen, output, image, request, proof,
                )
                grounded = ground_forward_analyze(
                    image, {"bounds": list(revealed_bounds), "route": "TRACKER_REVEALED_ANALYZE_ROW"},
                )
                proof["analyzeGroundPath"] = "BOUNDED_TRACKER_PANEL_REVEAL_CV"
            proof["analyzeGround"] = {
                "primary": grounded["primary"].__dict__,
                "neighbor": grounded["neighbor"].__dict__,
                "cv": grounded["cv_signature"],
                "panelBounds": grounded["panel_bounds"],
            }
            await click_forward_analyze(
                eyes, hands, qwen, output, grounded, proof,
            )
            proof["analysisCompletion"] = await wait_for_analysis_completion(
                eyes, hands, output, grounded,
                analysis_window_s=max(1.0, float(analysis_window_s)), timeout_s=35,
            )
            await apply_stabilization(eyes, hands, qwen, output, proof)
            evidence = str((output / "stabilize_after_apply.jpg").resolve())
            return {"status": "COMPLETED", "visualEvidenceId": evidence, "detail": "Completed guarded native Stabilize Motion Analyze Forward + X/Y Apply; protocol 2.3 host readback remains authoritative.", "guardedVisualTargetVerified": True, "targetBinding": target_binding(request), "proof": proof}
        finally:
            if maximized_here:
                await hands.call_tool("hands_keypress", {"keys": ["GRAVE"]})
                await asyncio.sleep(.25)
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
        result = {
            "status": "REFUSED",
            "detail": exception_detail(exc),
            "guardedVisualTargetVerified": False,
            "proof": LAST_PROOF,
        }
    output.mkdir(parents=True, exist_ok=True)
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "COMPLETED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
