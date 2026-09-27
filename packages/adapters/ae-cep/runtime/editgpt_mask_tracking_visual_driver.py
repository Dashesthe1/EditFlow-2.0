from __future__ import annotations

import argparse
import asyncio
import ctypes
import json
import os
from pathlib import Path

from mcp import Client
from editgpt.controller.coordinates import CoordinateTransform
from editgpt.controller.semantic_pointer import choose_pointer_target
from editgpt.eyes.semantic import LocalQwenVLClient

from editgpt_tracker_visual_driver import (
    EYES_URL,
    HANDS_URL,
    activate_tracker_panel_tab,
    capture,
    detect_analyze_row_cv,
    exception_detail,
    guarded_click_target,
    literal_label,
    locate_tracker_panel_signature,
    structured,
    validate_menu_item_below,
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
def maximize_after_effects_main_window() -> dict:
    if os.name != "nt":
        return {"attempted": False, "reason": "non-windows"}
    user32 = ctypes.windll.user32
    matches: list[tuple[int, str]] = []
    callback_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def visit(hwnd, _lparam):
        length = int(user32.GetWindowTextLengthW(hwnd))
        if length <= 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, len(buffer))
        title = buffer.value
        if title.startswith("Adobe After Effects"):
            matches.append((int(hwnd), title))
        return True

    callback = callback_type(visit)
    user32.EnumWindows(callback, 0)
    if not matches:
        raise RuntimeError("After Effects main window was not found for maximize")
    hwnd, title = matches[0]
    shown = bool(user32.ShowWindow(ctypes.c_void_p(hwnd), 3))
    return {"attempted": True, "title": title, "showWindowPreviousVisible": shown}


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
            f"The Tracker panel is in mask tracking mode: its Masks field shows the selected mask beginning with {mask}. "
            "A Method selector may be below the visible panel area, so do not require Method to be visible. "
            "Reject point Track Motion mode, Preview-only content, or a different comp/mask."
        ),
        source,
    )


async def dismiss_known_ui_obstructions(eyes, hands, qwen, output: Path, proof: dict) -> None:
    # AE can surface a first-run Properties Panel teaching card over the Timeline.
    # It is non-modal, but it can occlude the selected-layer evidence required by
    # the typed mask-binding verifier. Dismiss only that explicitly verified card.
    _meta, image = await capture(eyes, hands, output, "ui_obstruction_probe", focus=False)
    visible, evidence = verify_visible(
        qwen,
        image,
        (
            "A floating Adobe After Effects informational teaching card titled Properties Panel is visible. "
            "The card explains the new Properties panel and contains a single OK button. "
            "Reject normal panels, render dialogs, error dialogs, save dialogs, and any other popup."
        ),
        "m4_mask_properties_panel_tip",
    )
    proof["uiObstructionProbe"] = evidence
    if not visible:
        proof["uiObstructionDismissed"] = False
        return

    h, w = image.shape[:2]
    def validate_ok(target):
        if target.bbox_pixels is None:
            return "Properties Panel tip OK target requires a bounding box"
        # The Properties Panel teaching card is not pinned to one quadrant across
        # AE workspace/layout variants. The card itself has already been positively
        # verified above, and guarded_click_target separately verifies the exact OK
        # button. Keep a broad geometry sanity check without assuming lower-right.
        x0, y0, x1, y1 = [int(value) for value in target.bbox_pixels]
        button_w = max(1, x1 - x0)
        button_h = max(1, y1 - y0)
        if int(target.x) < int(w * 0.20) or int(target.y) < int(h * 0.20):
            return "Properties Panel tip OK target escaped the verified teaching-card area"
        if button_w > int(w * 0.25) or button_h > int(h * 0.15):
            return "Properties Panel tip OK target is not a compact button"
        return None

    click = await guarded_click_target(
        eyes,
        hands,
        qwen,
        output,
        (
            "Point to the OK button inside the floating Properties Panel informational teaching card in Adobe After Effects. "
            "Do not point to any timeline, Tracker control, menu, panel tab, or other button."
        ),
        "dismiss_properties_panel_tip",
        target_validator=validate_ok,
        preserve_transient=True,
        refocus_before_freshness=False,
        min_confidence=0.65,
    )
    proof["uiObstructionDismissed"] = True
    proof["uiObstructionDismissClick"] = click
    await asyncio.sleep(0.35)
    _meta, cleared = await capture(eyes, hands, output, "ui_obstruction_cleared", focus=False)
    still_visible, still_evidence = verify_visible(
        qwen,
        cleared,
        "The floating Adobe After Effects teaching card titled Properties Panel is still visible.",
        "m4_mask_properties_panel_tip_after",
    )
    proof["uiObstructionAfter"] = still_evidence
    if still_visible:
        raise RuntimeError("Properties Panel teaching card remained visible after guarded dismissal")


def validate_mask_tracker_menu_item(anchor, target) -> str | None:
    if anchor.bbox_pixels is None or target.bbox_pixels is None:
        return "menu-neighbor validation requires bounded anchor and target"
    dx = abs(int(target.x) - int(anchor.x))
    dy = int(target.y) - int(anchor.y)
    vertical_gap = int(target.bbox_pixels[1]) - int(anchor.bbox_pixels[3])
    if dx > 120:
        return f"menu target is too far horizontally from its anchor (dx={dx})"
    if not 10 <= dy <= 50:
        return f"menu target is not immediately below its anchor (dy={dy})"
    if not -16 <= vertical_gap <= 20:
        return f"menu target bounding box is not adjacent below its anchor (gap={vertical_gap})"
    return None


def locate_mask_tracker_panel_signature(qwen, image, source: str) -> tuple[bool, dict]:
    """Locate the mask-tracking Tracker panel without relying on point-tracker controls.

    AE can dock Preview above Tracker. The generic Tracker locator deliberately requires
    Track Motion / Current Track controls, which do not exist while Tracker is in mask
    tracking mode. Ground the literal Tracker title and Analyze label first, crop from
    that title downward, then require mask-tracking content inside that crop.
    """
    try:
        title, title_obs = choose_pointer_target(
            image,
            instruction=(
                "Point to the literal Tracker panel title text in Adobe After Effects. "
                "Choose the Tracker panel whose content immediately below includes an Analyze row; "
                "do not point to Preview, a layer name, or a menu item."
            ),
            client=qwen,
            min_confidence=0.60,
        )
        analyze, analyze_obs = choose_pointer_target(
            image,
            instruction=(
                "Point to the literal Analyze label inside the visible Adobe After Effects Tracker panel. "
                "Do not point to Preview playback controls, a triangle button, or timeline controls."
            ),
            client=qwen,
            min_confidence=0.60,
        )
        if title.bbox_pixels is None or analyze.bbox_pixels is None:
            return False, {"reason": "mask Tracker panel anchors require bounding boxes"}
        dy = int(analyze.y) - int(title.y)
        dx = abs(int(analyze.x) - int(title.x))
        h, w = image.shape[:2]
        geometry_ok = 12 <= dy <= max(110, int(round(h * 0.18))) and dx <= max(220, int(round(w * 0.20)))
        tx1, ty1, tx2, ty2 = title.bbox_pixels
        ax1, ay1, ax2, ay2 = analyze.bbox_pixels
        bounds = (
            max(0, min(tx1, ax1) - 24),
            max(0, min(ty1, ay1) - 16),
            min(w - 1, max(tx2, ax2) + 320),
            min(h - 1, max(ay2 + 260, ty2 + 300)),
        )
        x1, y1, x2, y2 = bounds
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            return False, {"reason": "mask Tracker panel bounds produced an empty crop"}

        # Semantic panel/title grounding is advisory only. Practice must also see
        # the deterministic four-button Analyze-row visual signature before it may
        # conclude that the native mask Tracker panel is actually frontmost.
        cv_signature = None
        cv_bounds = None
        cv_error = None
        for left, top, right, bottom in (
            (-74, -54, 164, 26),
            (-80, -60, 170, 30),
            (-68, -58, 168, 28),
        ):
            rx1 = max(0, int(analyze.x) + left)
            ry1 = max(0, int(analyze.y) + top)
            rx2 = min(w, int(analyze.x) + right)
            ry2 = min(h, int(analyze.y) + bottom)
            row_crop = image[ry1:ry2, rx1:rx2]
            if row_crop.size == 0:
                continue
            try:
                cv_signature = detect_analyze_row_cv(row_crop)
                cv_bounds = [rx1, ry1, rx2, ry2]
                break
            except RuntimeError as exc:
                cv_error = str(exc)
        if cv_signature is None:
            return False, {
                "reason": "mask Tracker panel lacks deterministic Analyze-row signature",
                "title": title.__dict__,
                "titleSemantic": title_obs.as_dict(),
                "analyze": analyze.__dict__,
                "analyzeSemantic": analyze_obs.as_dict(),
                "dx": dx,
                "dy": dy,
                "geometryOk": geometry_ok,
                "bounds": list(bounds),
                "cvError": cv_error,
            }

        content_ok, content_evidence = verify_visible(
            qwen,
            crop,
            (
                "This crop is the Adobe After Effects Tracker panel in mask tracking mode. "
                "It visibly contains the Tracker title and an Analyze row, and it contains a Masks field "
                "for the selected mask. Reject Preview-only content or a point Track Motion panel."
            ),
            source + "_mask_content",
        )
        verified = geometry_ok and content_ok
        return verified, {
            "title": title.__dict__,
            "titleSemantic": title_obs.as_dict(),
            "analyze": analyze.__dict__,
            "analyzeSemantic": analyze_obs.as_dict(),
            "dx": dx,
            "dy": dy,
            "geometryOk": geometry_ok,
            "content": content_evidence,
            "bounds": list(bounds),
            "cvSignature": cv_signature,
            "cvBounds": cv_bounds,
        }
    except Exception as exc:
        return False, {"reason": f"{type(exc).__name__}: {exc}"}


async def ensure_mask_panel(eyes, hands, qwen, output: Path, request: dict, proof: dict):
    _meta, image = await capture(eyes, hands, output, "pre_action_target", focus=False)
    pre_ok, pre_evidence = verify_mask_binding(qwen, image, request, "m4_mask_binding_pre")
    proof["maskBindingPre"] = pre_evidence
    proof["maskBindingPreAdvisory"] = pre_ok
    pre_panel_ok, pre_panel_evidence = locate_mask_tracker_panel_signature(
        qwen, image, "m4_mask_panel_pre",
    )
    proof["maskTrackerPanelPre"] = pre_panel_evidence
    if pre_ok and pre_panel_ok:
        proof["trackerMenuAction"] = "PRESERVE_VERIFIED_MASK_TRACKER_BINDING"
        return _meta, image

    # In compact AE workspaces Tracker can already be enabled but collapsed to a one-line
    # header in the right panel stack. Open that visible header before touching Window menu
    # state; clicking a checked Window > Tracker item would close the panel instead.
    try:
        h, w = image.shape[:2]
        proof["trackerPanelHeader"] = await guarded_click_target(
            eyes, hands, qwen, output,
            "Point to the collapsed Tracker PANEL HEADER labeled Tracker at the bottom of the right-side "
            "Adobe After Effects panel stack, below the Effects & Presets area. Point to the Tracker header "
            "row itself. Do not point to a Window menu item, timeline layer, Track Motion control, or Preview.",
            "mask_tracker_panel_header",
            preserve_transient=True,
            ground_bounds=(int(w * 0.70), int(h * 0.55), w, h),
            refocus_before_freshness=False,
        )
        await asyncio.sleep(0.45)
        meta, image = await capture(eyes, hands, output, "mask_tracker_panel_header_open", focus=False)
        header_ok, header_evidence = verify_mask_binding(
            qwen, image, request, "m4_mask_binding_after_header",
        )
        proof["maskBindingAfterHeader"] = header_evidence
        if header_ok:
            proof["trackerMenuAction"] = "RIGHT_PANEL_HEADER_OPEN"
            return meta, image
    except Exception as exc:
        proof["trackerPanelHeaderRecoveryError"] = f"{type(exc).__name__}: {exc}"

    # Fallback for layouts where no collapsed Tracker header is available.
    proof["windowMenu"] = await guarded_click_target(
        eyes, hands, qwen, output,
        "Point to the Window menu label in the top Adobe After Effects menu bar. Do not choose a dropdown item.",
        "mask_window_menu",
        preserve_transient=True,
        refocus_before_freshness=False,
    )
    _menu_meta, menu_image = await capture(
        eyes, hands, output, "mask_window_menu_open", focus=False,
    )
    menu_ok, menu_evidence = verify_visible(
        qwen, menu_image, "The Window menu dropdown is open and visibly contains a Tracker item.",
        "m4_mask_window_menu",
    )
    proof["windowMenuVerified"] = menu_evidence
    proof["windowMenuVerifiedAdvisory"] = menu_ok

    tools_anchor, tools_observation = choose_pointer_target(
        menu_image,
        instruction="Point to the Tools item in the currently open Adobe After Effects Window menu. Do not point to Tracker or another menu item.",
        client=qwen,
        min_confidence=0.60,
    )
    proof["trackerMenuToolsAnchor"] = {
        "target": tools_anchor.__dict__,
        "semantic": tools_observation.as_dict(),
    }
    if tools_anchor.bbox_pixels is None:
        raise RuntimeError("Tools menu anchor requires a bounded target")

    # Window > Tracker is a visibility toggle, so first inspect whether the
    # literal Tracker row is already checked. Dynamic Window-menu entries make
    # fixed keyboard step counts unsafe; ground the visible Tracker row directly
    # against its stable neighbor, Tools.
    already_open_ok, already_open_evidence = verify_visible(
        qwen,
        menu_image,
        (
            "In the open Adobe After Effects Window menu, the Tracker row directly below Tools "
            "has a visible checkmark at its left. Reject if Tracker is unchecked or absent."
        ),
        "m4_mask_tracker_already_open",
    )
    proof["trackerAlreadyOpen"] = already_open_evidence
    proof["trackerAlreadyOpenVerified"] = already_open_ok

    if already_open_ok:
        dismissed = await hands.call_tool("hands_keypress", {"keys": ["ESC"]})
        if dismissed.is_error:
            raise RuntimeError("Hands could not dismiss the checked Tracker Window menu item")
        proof["trackerMenuItem"] = {
            "path": "WINDOW_MENU_DIRECT_GROUNDED",
            "alreadyOpen": True,
            "action": "ESC_PRESERVE_ENABLED",
        }
        proof["trackerMenuAction"] = "WINDOW_MENU_DISMISS_PRESERVE_TRACKER"
    else:
        h, w = menu_image.shape[:2]

        def validate_tracker_row(target):
            return validate_mask_tracker_menu_item(tools_anchor, target)

        tracker_click = await guarded_click_target(
            eyes,
            hands,
            qwen,
            output,
            (
                "Point to the Tracker item in the currently open Adobe After Effects Window menu. "
                "It is directly below Tools and directly above Wiggler. Point to the Tracker menu row itself. "
                "Do not point to a timeline item, Footage row, panel tab, or the word Track Motion."
            ),
            "mask_tracker_menu_item",
            target_validator=validate_tracker_row,
            preserve_transient=True,
            ground_bounds=(int(w * 0.20), 0, int(w * 0.85), int(h * 0.45)),
            refocus_before_freshness=False,
            min_confidence=0.70,
        )
        proof["trackerMenuItem"] = {
            "path": "WINDOW_MENU_DIRECT_GROUNDED",
            "alreadyOpen": False,
            "action": "GUARDED_CLICK_TRACKER",
            "click": tracker_click,
        }
        proof["trackerMenuAction"] = "WINDOW_MENU_SELECT_TRACKER_OPEN"
    await asyncio.sleep(0.55)

    meta, image = await capture(eyes, hands, output, "mask_tracker_panel_open", focus=False)
    panel_ok, panel_evidence = locate_mask_tracker_panel_signature(qwen, image, "m4_mask_tracker_panel_after_window")
    proof["maskTrackerPanelAfterWindow"] = panel_evidence
    if not panel_ok:
        # Window > Tracker can leave a grouped panel visible with Preview still frontmost.
        # In that case, explicitly click the verified Tracker panel tab before any Analyze action.
        image, tab_click = await activate_tracker_panel_tab(
            eyes, hands, qwen, output, "mask_tracker_recovery",
        )
        proof["maskTrackerPanelRecoveryTab"] = tab_click
        panel_ok, panel_evidence = locate_mask_tracker_panel_signature(qwen, image, "m4_mask_tracker_panel_after_tab")
        proof["maskTrackerPanelAfterRecoveryTab"] = panel_evidence
        if not panel_ok:
            raise RuntimeError("Tracker panel remained non-frontmost after verified Tracker-tab activation")
        meta, image = await capture(eyes, hands, output, "mask_tracker_panel_recovered", focus=False)
    ok, evidence = verify_mask_binding(qwen, image, request, "m4_mask_binding_ready")
    proof["maskBindingReady"] = evidence
    if not ok:
        raise RuntimeError("bound mask tracking panel was not visually verified")
    return meta, image
def ground_mask_analyze(qwen, image, direction: str) -> dict:
    anchor, anchor_obs = choose_pointer_target(
        image,
        instruction=(
            "Point to the literal Analyze label in the MASK TRACKING controls of Adobe After Effects, "
            "near the Masks field for the selected mask. Do not point to Preview playback controls, "
            "a triangle button, or timeline controls."
        ),
        client=qwen,
        min_confidence=0.60,
    )
    if anchor.bbox_pixels is None:
        raise RuntimeError("mask Analyze label requires a bounded visual target")
    h, w = image.shape[:2]
    detected = None
    last_error = None
    # This crop is centered on the literal Analyze label, while the shared
    # CV signature detector expects the control row in the lower-middle band
    # (54%-84% of crop height). Bias the crop upward so the verified Analyze
    # row lands near 67% instead of ~46%-50%, without widening the click area.
    for left, top, right, bottom in (
        (-74, -54, 164, 26),
        (-80, -60, 170, 30),
        (-68, -58, 168, 28),
    ):
        x1 = max(0, int(anchor.x) + left)
        y1 = max(0, int(anchor.y) + top)
        x2 = min(w, int(anchor.x) + right)
        y2 = min(h, int(anchor.y) + bottom)
        crop = image[y1:y2, x1:x2]
        try:
            detected = detect_analyze_row_cv(crop)
            break
        except RuntimeError as exc:
            last_error = exc
    if detected is None:
        action = "Analyze Forward" if direction == "FORWARD" else "Analyze Backward"
        slot_word = "third" if direction == "FORWARD" else "second"
        target, target_obs = choose_pointer_target(
            image,
            instruction=(
                f"Point to the {action} continuous-analysis button in the MASK TRACKING Analyze row "
                f"of Adobe After Effects. It is the {slot_word} of the four adjacent directional "
                "controls immediately to the right of the literal Analyze label and below the selected "
                "Masks field. Reject Preview playback controls, one-frame controls, timeline controls, "
                "and any control outside the verified Tracker panel."
            ),
            client=qwen,
            min_confidence=0.72,
        )
        if target.bbox_pixels is None:
            raise RuntimeError(
                f"mask Analyze row CV signature unavailable and semantic fallback was unbounded: {last_error}"
            )
        dx = int(target.x) - int(anchor.x)
        dy = abs(int(target.y) - int(anchor.y))
        tx0, ty0, tx1, ty1 = [int(value) for value in target.bbox_pixels]
        compact = (tx1 - tx0) <= 72 and (ty1 - ty0) <= 56
        if not (12 <= dx <= 210 and dy <= 38 and compact):
            raise RuntimeError(
                "mask Analyze semantic fallback failed guarded geometry: "
                f"dx={dx};dy={dy};compact={compact};cv={last_error}"
            )
        rx1 = max(0, min(int(anchor.bbox_pixels[0]), tx0) - 24)
        ry1 = max(0, min(int(anchor.bbox_pixels[1]), ty0) - 24)
        rx2 = min(w, max(int(anchor.bbox_pixels[2]), tx1) + 150)
        ry2 = min(h, max(int(anchor.bbox_pixels[3]), ty1) + 32)
        row_crop = image[ry1:ry2, rx1:rx2]
        row_ok, row_evidence = verify_visible(
            qwen,
            row_crop,
            "The Adobe After Effects MASK TRACKING Analyze row is visible with the literal Analyze "
            "label and four adjacent directional controls. Reject Preview playback controls or any "
            "other panel.",
            "m4_mask_analyze_row_semantic_fallback",
        )
        if not row_ok:
            raise RuntimeError(
                f"mask Analyze row CV signature unavailable and semantic fallback row was not verified: {last_error}"
            )
        return {
            "encoded": {"x": int(target.x), "y": int(target.y)},
            "anchor": anchor.__dict__,
            "anchorSemantic": anchor_obs.as_dict(),
            "cvSignature": None,
            "semanticFallback": target.__dict__,
            "semanticFallbackObservation": target_obs.as_dict(),
            "selectedBox": list(target.bbox_pixels),
            "panelBounds": [rx1, ry1, rx2, ry2],
            "rowEvidence": row_evidence,
            "rowVerificationAdvisory": True,
        }
    slot = 2 if direction == "FORWARD" else 1
    box = detected["bboxes"][slot]
    center = detected["centers"][slot]
    anchor_x = anchor.x - x1
    anchor_y = anchor.y - y1
    anchor_left = anchor_x < detected["centers"][0][0]
    anchor_vertical = abs(anchor_y - detected["rowY"]) <= 30
    if not (anchor_left and anchor_vertical):
        raise RuntimeError(
            f"Analyze label anchor disagreed with verified mask row signature: "
            f"left={anchor_left}; vertical={anchor_vertical}"
        )
    row_ok, row_evidence = verify_visible(
        qwen,
        crop,
        "The mask Tracker Analyze row shows four adjacent directional controls: one-frame backward, Analyze Backward, Analyze Forward, and one-frame forward. Reject Preview playback controls.",
        "m4_mask_analyze_row_crop",
    )
    return {
        "encoded": {"x": int(round(x1 + center[0])), "y": int(round(y1 + center[1]))},
        "anchor": anchor.__dict__,
        "anchorSemantic": anchor_obs.as_dict(),
        "cvSignature": detected,
        "selectedBox": list(box),
        "panelBounds": [x1, y1, x2, y2],
        "rowEvidence": row_evidence,
        "rowVerificationAdvisory": row_ok,
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
            # The Eyes service reports running before its first frame is guaranteed to
            # be buffered. Give the live stream one short frame-warmup interval.
            await asyncio.sleep(0.25)
            # After Effects is already running for Practice. Focus that existing allowlisted
            # process directly; do not spend a semantic-model round trip locating a taskbar
            # icon. The first guarded physical Tracker-panel click below establishes the
            # child-panel focus before any actionable Analyze control is touched.
            focused = await hands.call_tool("hands_focus_after_effects", {})
            if focused.is_error:
                raise RuntimeError("After Effects could not be focused before mask tracking")
            proof["taskbarAeFocus"] = {"mode": "FOCUS_EXISTING_AFTER_EFFECTS_PROCESS"}
            proof["mainWindowMaximize"] = maximize_after_effects_main_window()
            await asyncio.sleep(0.45)
            await hands.call_tool("hands_keypress", {"keys": ["ESC"]})
            await asyncio.sleep(0.20)
            await dismiss_known_ui_obstructions(eyes, hands, qwen, output, proof)
            meta, image = await ensure_mask_panel(eyes, hands, qwen, output, request, proof)
            # A floating CEP panel can remain the active child window even after the
            # After Effects process is focused. In that state the first click into the
            # docked Tracker panel only activates the panel and never reaches Analyze.
            # The Tracker title row is collapsible, and the Analyze row contains live
            # controls, so focus on the static non-action `Method:` label instead.
            # If semantic grounding still changes/collapses the visible Tracker state,
            # reopen the panel through ensure_mask_panel and require the same typed
            # mask binding before any actionable Analyze click.
            proof["trackerPanelFocus"] = await guarded_click_target(
                eyes,
                hands,
                qwen,
                output,
                (
                    "Point to the literal Method: LABEL TEXT at the left edge of the Method row inside the "
                    "expanded right-side Adobe After Effects Tracker panel. Point only to the word/colon label, "
                    "not to the Method dropdown. Do not point to the Tracker title/header, Analyze controls, "
                    "Masks field, panel menu, Preview, timeline controls, or the floating EditFlow panel."
                ),
                "mask_tracker_panel_focus",
                preserve_transient=True,
                refocus_before_freshness=False,
                min_confidence=0.70,
            )
            await asyncio.sleep(0.25)
            meta, image = await capture(eyes, hands, output, "tracker_panel_focused", focus=False)
            focused_ok, focused_evidence = verify_mask_binding(
                qwen, image, request, "m4_mask_binding_after_tracker_focus",
            )
            proof["maskBindingAfterTrackerFocus"] = focused_evidence
            if not focused_ok:
                proof["trackerPanelFocusRecovery"] = "REOPEN_VERIFIED_TRACKER_PANEL"
                meta, image = await ensure_mask_panel(
                    eyes, hands, qwen, output, request, proof
                )
                rebound_ok, rebound_evidence = verify_mask_binding(
                    qwen, image, request, "m4_mask_binding_after_tracker_focus_recovery",
                )
                proof["maskBindingAfterTrackerFocusRecovery"] = rebound_evidence
                if not rebound_ok:
                    raise RuntimeError(
                        "typed mask binding changed while focusing the native Tracker panel and recovery failed"
                    )
            grounded = ground_mask_analyze(qwen, image, request["direction"])
            proof["analyzeSelection"] = grounded
            screen = await click_screen(hands, meta, grounded["encoded"])
            proof["analyzeClickScreen"] = screen
            # analysis_window_s is the footage span that must be covered, not a wall-clock
            # deadline for AE's native tracker. 4K mask tracking can take several real seconds
            # to advance through a sub-second footage window, so give it a separate processing
            # budget. Before clicking the same Analyze control again, verify that it is still
            # presenting the square Stop state; otherwise tracking has already completed and
            # clicking would accidentally restart analysis.
            processing_budget_s = max(6.0, min(30.0, float(analysis_window_s) * 6.0))
            proof["analysisFootageWindowSeconds"] = float(analysis_window_s)
            proof["trackingProcessingBudgetSeconds"] = processing_budget_s
            await asyncio.sleep(processing_budget_s)
            _probe_meta, probe_image = await capture(
                eyes, hands, output, "analysis_completion_probe", focus=False
            )
            stop_visible, stop_evidence = verify_visible(
                qwen,
                probe_image,
                "The mask Tracker Analyze row currently shows a square Stop button for an active continuous mask analysis.",
                "m4_mask_analysis_completion_probe",
            )
            proof["analysisStopStateProbe"] = stop_evidence
            if stop_visible:
                stopped = await hands.call_tool(
                    "hands_click", {"x": screen["x"], "y": screen["y"], "button": "left", "count": 1}
                )
                if stopped.is_error:
                    raise RuntimeError("bounded mask Tracker Stop click failed")
                proof["boundedStopClicked"] = True
                proof["analysisCompletedBeforeBound"] = False
                await asyncio.sleep(0.65)
            else:
                proof["boundedStopClicked"] = False
                proof["analysisCompletedBeforeBound"] = True
                await asyncio.sleep(0.20)
            _final_meta, final_image = await capture(eyes, hands, output, "after_analysis", focus=False)
            bound, binding_evidence = verify_mask_binding(qwen, final_image, request, "m4_mask_binding_after")
            proof["maskBindingAfter"] = binding_evidence
            if not bound:
                # Native tracking can leave another panel frontmost even though the
                # tracked mask and active comp/layer are unchanged. Recover only by
                # re-opening the verified Tracker panel, then require the same typed
                # mask binding again before accepting any visual evidence.
                _recovery_meta, recovery_image = await ensure_mask_panel(
                    eyes, hands, qwen, output, request, proof
                )
                rebound, rebound_evidence = verify_mask_binding(
                    qwen, recovery_image, request, "m4_mask_binding_after_recovery"
                )
                proof["maskBindingAfterRecovery"] = rebound_evidence
                if not rebound:
                    raise RuntimeError("typed mask visual binding changed after analysis and verified Tracker recovery")
                final_image = recovery_image
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
