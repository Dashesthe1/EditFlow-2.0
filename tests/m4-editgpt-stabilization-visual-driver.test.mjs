import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EditGptStabilizationVisualDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-stabilization-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_stabilization_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  evidenceDirectory: "C:\\EditFlow\\proofs\\stabilization",
  timeoutMs: 90000,
  analysisWindowSeconds: 4,
};

const request = {
  direction: "FORWARD",
  compHostId: 101,
  layerHostId: 202,
  expectedCompName: "Stabilize Comp",
  expectedLayerName: "Stabilize Layer",
  expectedControl: "STABILIZE_ANALYZE_APPLY_FORWARD",
};

const processResult = (stdout, extra = {}) => ({
  exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, ...extra,
});
test("stabilization visual driver launches fixed sidecar with correlated request data", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED",
      visualEvidenceId: "STAB_EVIDENCE",
      guardedVisualTargetVerified: true,
      targetBinding: {
        direction: request.direction,
        expectedControl: request.expectedControl,
        compHostId: request.compHostId,
        layerHostId: request.layerHostId,
        expectedCompName: request.expectedCompName,
        expectedLayerName: request.expectedLayerName,
      },
    }));
  } };
  const result = await new EditGptStabilizationVisualDriverV1(config, runner).stabilize(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.visualEvidenceId, "STAB_EVIDENCE");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), [config.scriptPath, "--request-json"]);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.stabilization.visual.v1");
  assert.equal(payload.expectedControl, "STABILIZE_ANALYZE_APPLY_FORWARD");
  assert.equal(calls[0].args.at(-1), "4");
});
test("stabilization visual driver fails closed on malformed, mismatched, and backward requests", async () => {
  const malformed = new EditGptStabilizationVisualDriverV1(config, {
    async run() { return processResult("not-json"); },
  });
  assert.equal((await malformed.stabilize(request)).status, "REFUSED");

  const mismatched = new EditGptStabilizationVisualDriverV1(config, {
    async run() { return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: true,
      targetBinding: { ...request, compHostId: 999 },
    })); },
  });
  const mismatch = await mismatched.stabilize(request);
  assert.equal(mismatch.status, "REFUSED");
  assert.match(mismatch.detail, /correlation mismatch/);

  const backward = await malformed.stabilize({ ...request, direction: "BACKWARD" });
  assert.equal(backward.status, "REFUSED");
});

test("Stabilize Motion grounding is relation-guarded and refusals retain partial proof", async () => {
  const stabilization = await readFile("packages/adapters/ae-cep/runtime/editgpt_stabilization_visual_driver.py", "utf8");
  const tracker = await readFile("packages/adapters/ae-cep/runtime/editgpt_tracker_visual_driver.py", "utf8");
  assert.match(stabilization, /SAME ROW/);
  assert.match(stabilization, /immediately to (?:its |the )?RIGHT/i);
  assert.match(stabilization, /not to the right of Track Motion/);
  assert.match(stabilization, /not on the Track Motion row/);
  assert.match(stabilization, /stabilizeMotionRelation/);
  assert.match(stabilization, /Track Type label text in the Adobe After Effects Tracker panel/);
  assert.match(stabilization, /It must be BELOW Current Track/);
  assert.match(stabilization, /Track Type dropdown FIELD on this same row/);
  assert.match(stabilization, /selected value may be Transform or another tracking type/);
  assert.match(stabilization, /trackTypeFieldRelation/);
  assert.match(stabilization, /Track Type dropdown field is not on the Track Type row/);
  assert.match(stabilization, /ground_bounds=field_ground_bounds/);
  assert.match(stabilization, /"searchBounds": \[x1, label_search_y1, x2, y2\]/);
  assert.match(stabilization, /modeReadyBroadSemanticAdvisory/);
  assert.match(stabilization, /postModePanelBounds/);
  assert.match(stabilization, /reveal_analyze_row/);
  assert.match(stabilization, /BOUNDED_TRACKER_PANEL_REVEAL/);
  assert.match(stabilization, /BOUNDED_TRACKER_PANEL_REVEAL_CV/);
  assert.match(stabilization, /TRACKER_REVEALED_ANALYZE_ROW/);
  assert.match(stabilization, /trackerPanelBodyHover/);
  assert.match(stabilization, /empty safe background area well INSIDE/);
  assert.match(stabilization, /insideSafeBody/);
  assert.match(stabilization, /trackerPanelMaximizeVisualChange/);
  assert.match(stabilization, /whole-frame change to establish a panel-layout transition/);
  assert.match(stabilization, /verify_selected_current_track_relation/);
  assert.match(stabilization, /currentTrackRelation/);
  assert.match(stabilization, /SEMANTIC_RELATION_REFUSED/);
  assert.match(stabilization, /"reason": exception_detail\(exc\)/);
  assert.match(stabilization, /create_current_tracker_via_verified_track_motion/);
  assert.match(stabilization, /VERIFIED_TRACK_MOTION_SIBLING_PAIR_CREATE_TRACKER/);
  assert.match(stabilization, /VERIFIED_TRACK_MOTION_BUTTON_CURRENT_TRACK_RELATION/);
  assert.match(stabilization, /currentTrackRelationAfterStabilizeClick/);
  assert.match(stabilization, /currentTrackRelationAfterTrackMotionCreate/);
  assert.match(stabilization, /Track Motion fallback did not create a geometrically verified non-None Current Track/);
  assert.match(stabilization, /proof\["modeDirectSemanticReady"\] = False[\s\S]{0,240}switch_existing_tracker_to_stabilize/);
  assert.match(stabilization, /panel_crop = image\[y1:y2, x1:x2\]/);
  assert.match(stabilization, /panelCropUsed/);
  assert.match(stabilization, /offset_pointer_target\(value_local, x1, y1\)/);
  assert.match(stabilization, /STABILIZATION_THREE_ANCHOR_TOP_ROW_SIGNATURE/);
  assert.match(stabilization, /pairDx/);
  assert.match(stabilization, /pairDy/);
  assert.match(stabilization, /titleGeometryOk/);
  assert.match(stabilization, /pairGeometryOk/);
  assert.match(stabilization, /sharedPanelStabilizeReground/);
  assert.match(stabilization, /STABILIZATION_SHARED_PANEL_REGROUNDED_PAIR/);
  assert.match(stabilization, /STABILIZATION_SHARED_PANEL_LOCAL_TOP_BAND_PAIR/);
  assert.match(stabilization, /STABILIZATION_SHARED_PANEL_CV_BUTTON_GRID/);
  assert.match(stabilization, /TRACKER_MODE_2X2_CV_GRID/);
  assert.match(stabilization, /detect_tracker_mode_button_grid_cv/);
  assert.match(stabilization, /lower-right button in verified Tracker 2x2 native mode grid/);
  assert.match(stabilization, /This image is ONLY the TOP BAND of the verified Adobe After Effects Tracker panel/);
  assert.match(stabilization, /topBandBounds/);
  assert.match(stabilization, /dxFromSharedTrackMotion/);
  assert.match(stabilization, /sharedAttemptOk/);
  assert.match(stabilization, /VERIFIED_THREE_ANCHOR_PANEL_PAIR/);
  assert.match(stabilization, /panelAfterWindowSelection/);
  assert.match(stabilization, /WINDOW_MENU_SELECT_TRACKER_OPEN_OR_FRONT/);
  assert.match(stabilization, /canonical open-or-bring-to-front action/);
  assert.match(stabilization, /Window > Tracker did not expose verified frontmost Tracker content/);
  assert.doesNotMatch(stabilization, /m4_stabilize_window_tracker_checked/);
  assert.doesNotMatch(stabilization, /m4_stabilize_window_tracker_unchecked/);
  assert.match(stabilization, /bottom visible item, immediately below Tools/);
  assert.match(stabilization, /stabilize_window_menu_open", focus=False/);
  assert.match(stabilization, /stabilize_track_type_menu", focus=False/);
  assert.match(stabilization, /preserve_transient=True/);
  assert.match(stabilization, /trackerMenuToolsAnchor/);
  assert.match(stabilization, /validate_menu_item_below/);
  assert.match(stabilization, /ensure_timeline_layer_selected/);
  assert.match(stabilization, /require_visible_selection=False/);
  assert.match(stabilization, /ALREADY_ACTIVE_BOUND_LAYER_VIEWER_VERIFIED/);
  assert.match(stabilization, /m4_stabilize_binding_layer_view_already_active/);
  assert.match(stabilization, /panelAfterTimelineLayerSelection/);
  assert.match(stabilization, /Tracker panel changed while selecting the exact tracking target Timeline layer/);
  assert.match(stabilization, /ensure_timeline_layer_selected[\s\S]{0,900}ensure_bound_layer_view_active/);
  assert.match(stabilization, /ensure_bound_layer_view_active/);
  assert.match(stabilization, /ACTIVATED_BOUND_LAYER_VIEWER/);
  assert.match(stabilization, /bound Layer viewer did not become active before native tracking/);
  assert.match(stabilization, /stabilize_bound_layer_view_tab/);
  assert.match(stabilization, /typed stabilization binding changed while activating the bound Layer viewer/);
  assert.match(tracker, /classify_tracker_panel_content/);
  assert.match(tracker, /TRACKER_CONTENT_VERIFIED/);
  assert.match(stabilization, /hands_keypress", \{"keys": \["GRAVE"\]\}/);
  assert.match(stabilization, /click_forward_analyze/);
  assert.match(stabilization, /stabilize_analyze_action_verified/);
  assert.match(stabilization, /reasoning-to-action race/);
  assert.match(stabilization, /analyzeActionGate/);
  assert.match(stabilization, /After Effects was not foreground at the verified Analyze action checkpoint/);
  assert.match(stabilization, /tool_result_detail\(clicked\)/);
  assert.match(stabilization, /analyzeClickFailure/);
  assert.match(stabilization, /DIRECT_STABILIZE_MOTION_CURRENT_TRACK_RELATIONAL_PROTOCOL_2_3_VERIFY/);
  assert.match(stabilization, /protocol 2\.3 host readback remains authoritative/);
  assert.match(stabilization, /LAST_PROOF/);
  assert.match(stabilization, /"proof": LAST_PROOF/);
  assert.match(tracker, /target_validator/);
  assert.match(tracker, /ground_bounds/);
  assert.match(tracker, /semantic_image = ground_image/);
  assert.match(tracker, /offset_pointer_target\(target, semantic_offset_x, semantic_offset_y\)/);
  assert.match(tracker, /validation_error = target_validator\(target\)/);
  assert.match(tracker, /min\(ty1, my1\)/);
  assert.match(tracker, /bottom visible item, immediately below Tools/);
  assert.match(tracker, /Do not point to Tools, Preview, Progress, Properties/);
});

test("runtime Apply path requires the real dialog and uses bottom-row CV geometry", async () => {
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_stabilization_visual_driver.py", "utf8");
  assert.match(py, /cv2\.findContours/);
  assert.match(py, /Motion Tracker Apply Options did not open after Apply/);
  assert.match(py, /Reset\/Apply row missing|Reset\/Apply/);
  assert.match(py, /CV Apply target escaped expected bottom-right Tracker geometry/);
  assert.match(py, /minimumWidthRatio": \.20/);
  assert.match(py, /min_button_width = int\(panel_width \* \.20\)/);
  assert.match(py, /applyButtonGeometry/);
  assert.match(py, /applyButtonRelation/);
  assert.match(py, /reset_target=min\(row,key=lambda v:v\["x"\]\)/);
  assert.match(py, /minimum_pair_dx = max\(40, int\(panel_width \* \.18\)\)/);
  assert.match(py, /pair_dx < minimum_pair_dx or pair_dy > 8/);
  assert.match(py, /Eyes geometry changed before Apply/);
  assert.match(py, /Apply target changed before action/);
  assert.match(py, /applyActionGate/);
  assert.match(py, /After Effects was not foreground at the verified Apply action checkpoint/);
  assert.match(py, /applyClickFailure/);
  assert.match(py, /target_patch_change/);
});