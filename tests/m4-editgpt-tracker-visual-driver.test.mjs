import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EditGptTrackerVisualDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-tracker-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_tracker_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  evidenceDirectory: "C:\\EditFlow\\proofs\\tracker",
  timeoutMs: 90000,
};

const request = {
  direction: "FORWARD",
  trackerIndex: 1,
  pointIndex: 1,
  requiredPointIndices: [1, 2],
  compHostId: 101,
  layerHostId: 202,
  expectedCompName: "Bound Comp",
  expectedLayerName: "Bound Layer",
  expectedTrackerName: "Tracker 1",
  expectedControl: "TRACKER_ANALYZE_FORWARD",
};

const processResult = (stdout, extra = {}) => ({
  exitCode: 0,
  signal: null,
  stdout,
  stderr: "",
  timedOut: false,
  ...extra,
});
test("EditGPT visual driver launches only the fixed sidecar command with request JSON as data", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED",
      visualEvidenceId: "EVIDENCE_1",
      guardedVisualTargetVerified: true,
      targetBinding: {
        direction: request.direction,
        expectedControl: request.expectedControl,
        compHostId: request.compHostId,
        layerHostId: request.layerHostId,
        expectedCompName: request.expectedCompName,
        expectedLayerName: request.expectedLayerName,
        expectedTrackerName: request.expectedTrackerName,
      },
    }));
  } };
  const result = await new EditGptTrackerVisualDriverV1(config, runner).analyze(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.visualEvidenceId, "EVIDENCE_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executablePath, config.executablePath);
  assert.deepEqual(calls[0].args.slice(0, 2), [config.scriptPath, "--request-json"]);
  assert.equal(calls[0].args[3], "--evidence-dir");
  assert.equal(calls[0].args[4], config.evidenceDirectory);
  assert.equal(calls[0].args[5], "--analysis-window-seconds");
  assert.equal(calls[0].args[6], "5");
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.tracker.visual.v1");
  assert.equal(payload.expectedCompName, "Bound Comp");
  assert.equal(payload.expectedLayerName, "Bound Layer");
  assert.deepEqual(payload.requiredPointIndices, [1, 2]);
});
test("EditGPT visual driver fails closed on malformed or mismatched sidecar output", async () => {
  const malformed = new EditGptTrackerVisualDriverV1(config, {
    async run() { return processResult("not-json"); },
  });
  assert.equal((await malformed.analyze(request)).status, "REFUSED");

  const mismatched = new EditGptTrackerVisualDriverV1(config, {
    async run() { return processResult(JSON.stringify({
      status: "COMPLETED",
      visualEvidenceId: "EVIDENCE_2",
      guardedVisualTargetVerified: true,
      targetBinding: {
        direction: "FORWARD",
        expectedControl: "TRACKER_ANALYZE_FORWARD",
        compHostId: 999,
        layerHostId: request.layerHostId,
        expectedCompName: request.expectedCompName,
        expectedLayerName: request.expectedLayerName,
        expectedTrackerName: request.expectedTrackerName,
      },
    })); },
  });
  const mismatch = await mismatched.analyze(request);
  assert.equal(mismatch.status, "REFUSED");
  assert.match(mismatch.detail, /correlation mismatch/);
});

test("EditGPT visual driver supports Backward only with the exact correlated control", async () => {
  let calls = 0;
  const backward = { ...request, direction: "BACKWARD", expectedControl: "TRACKER_ANALYZE_BACKWARD" };
  const runner = { async run(invocation) {
    calls += 1;
    const payload = JSON.parse(invocation.args[2]);
    assert.equal(payload.direction, "BACKWARD");
    assert.equal(payload.expectedControl, "TRACKER_ANALYZE_BACKWARD");
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "EVIDENCE_BACKWARD", guardedVisualTargetVerified: true,
      targetBinding: {
        direction: backward.direction, expectedControl: backward.expectedControl,
        compHostId: backward.compHostId, layerHostId: backward.layerHostId,
        expectedCompName: backward.expectedCompName, expectedLayerName: backward.expectedLayerName,
        expectedTrackerName: backward.expectedTrackerName,
      },
    }));
  } };
  const driver = new EditGptTrackerVisualDriverV1(config, runner);
  assert.equal((await driver.analyze(backward)).status, "COMPLETED");
  assert.equal(calls, 1);
  const mismatch = await driver.analyze({ ...backward, expectedControl: "TRACKER_ANALYZE_FORWARD" });
  assert.equal(mismatch.status, "REFUSED");
  assert.equal(calls, 1);
});
test("EditGPT visual driver refuses sidecar failure and timeout", async () => {
  const failed = new EditGptTrackerVisualDriverV1(config, {
    async run() { return processResult("", { exitCode: 2, stderr: "sidecar refused" }); },
  });
  assert.match((await failed.analyze(request)).detail, /sidecar refused/);

  const timed = new EditGptTrackerVisualDriverV1(config, {
    async run() { return processResult("", { exitCode: null, timedOut: true }); },
  });
  assert.match((await timed.analyze(request)).detail, /timed out/);
});

test("production visual route is shell-free, target-bound, and contains no workstation path", async () => {
  const ts = await readFile("packages/adapters/ae-cep/src/m4-editgpt-tracker-visual-driver.ts", "utf8");
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_tracker_visual_driver.py", "utf8");
  assert.match(ts, /shell:\s*false/);
  assert.doesNotMatch(ts, /exec\(|execFile\(|Invoke-Expression|cmd\.exe/);
  assert.match(py, /visible AE state does not match the typed tracker target/);
  assert.match(py, /detect_analyze_row_cv/);
  assert.match(py, /2-1-1-2 Tracker Analyze row signature/);
  assert.match(py, /x_start = int\(width \* 0\.30\)/);
  assert.match(py, /starting at 38% clips that control/);
  assert.match(py, /target_patch_change/);
  assert.match(py, /one-frame forward/);
  assert.match(py, /one-frame backward/);
  assert.match(py, /reveal_analyze_row/);
  assert.match(py, /classify_tracker_panel_content/);
  assert.match(py, /TRACKER_CONTENT_VERIFIED/);
  assert.match(py, /Track Camera, Warp Stabilizer, Track Motion, Stabilize Motion/);
  assert.match(py, /state == "TRACKER"/);
  assert.match(py, /len\(tracker_hits\) >= 2/);
  assert.match(py, /Selecting Tracker is the canonical[\s\S]{0,80}open-or-bring-to-front action/);
  assert.match(py, /WINDOW_MENU_SELECT_TRACKER_OPEN_OR_FRONT/);
  assert.match(py, /frontmost panel content is not verified Tracker content/);
  assert.match(py, /async def ensure_timeline_layer_selected/);
  assert.match(py, /require_visible_selection: bool = True/);
  assert.match(py, /verify_grounded_row_selected/);
  assert.match(py, /UNOBSERVED_AFTER_GROUNDED_CLICK/);
  assert.match(py, /TimelineSourceNameHeader/);
  assert.match(py, /literal Source Name COLUMN HEADER/);
  assert.match(py, /Timeline layer row is above the verified Timeline Source Name header/);
  assert.match(py, /ground_bounds=timeline_ground_bounds/);
  assert.match(py, /TimelineLayerGroundPre/);
  assert.match(py, /ALREADY_SELECTED_GROUNDED_ROW/);
  assert.match(py, /GUARDED_TIMELINE_ROW_CLICK/);
  assert.match(py, /visible label may be truncated by After Effects/);
  assert.match(py, /do not require the full layer name to be readable/);
  assert.match(py, /exact tracking target Timeline layer did not become visibly selected/);
  assert.match(py, /Do not point to the Layer viewer tab, Project panel item, Tracker Motion Source/);
  assert.match(py, /focus: bool = True/);
  assert.match(py, /hands_move", \{"x": 2, "y": 2\}/);
  assert.match(py, /re-focused for guarded freshness verification/);
  assert.match(py, /freshness_changed\.jpg/);
  assert.match(py, /ground_frame=.*action_frame=/);
  assert.match(py, /while changed > 0\.12 and not preserve_transient and len\(focus_recoveries\) < 2/);
  assert.match(py, /could not be re-focused after visual target occlusion/);
  assert.match(py, /focus_recovery_\{attempt\}_before\.jpg/);
  assert.match(py, /"focus_recoveries": focus_recoveries/);
  assert.match(py, /focus_recovery_attempts=\{len\(focus_recoveries\)\}/);
  assert.match(py, /window_menu_open", focus=False/);
  assert.match(py, /current_track_dropdown_open", focus=False/);
  assert.match(py, /preserve_transient=True/);
  assert.match(py, /validate_menu_item_below/);
  assert.match(py, /menu target is not immediately below its anchor/);
  assert.match(py, /tracker_menu_tools_anchor/);
  assert.match(py, /hands_scroll/);
  assert.match(py, /max_dy = max\(150, int\(round\(h \* 0\.45\)\)\)/);
  assert.match(py, /max_dx = max\(220, int\(round\(w \* 0\.20\)\)\)/);
  assert.match(py, /"maxDy": max_dy/);
  assert.match(py, /"maxDx": max_dx/);
  assert.match(py, /empty safe background area inside the visible Tracker panel body/);
  assert.match(py, /semantic Tracker scroll target escaped verified panel bounds/);
  assert.match(py, /scrollChangedFraction/);
  assert.match(py, /oppositeScrollChangedFraction/);
  assert.match(py, /wheel scrolling produced no visible movement/);
  assert.match(py, /typed target binding changed during bounded Tracker-panel scroll/);
  assert.match(py, /verified_pre_scroll_tracker_bounds/);
  assert.match(py, /controlFillRatio/);
  assert.match(py, /active Stop state/);
  assert.match(py, /fillRatios/);
  assert.match(py, /STOP_CLICKED/);
  assert.match(py, /result\.json/);
  assert.match(py, /Tracker Motion Target/);
  assert.match(py, /Motion Source field to equal the layer name/);
  assert.match(py, /targetBinding/);
  assert.doesNotMatch(py, /C:\\\\Users\\\\Shadow|pyautogui|SetCursorPos/);
});


test("EditGPT visual driver refuses an invalid required point set before sidecar launch", async () => {
  let calls = 0;
  const driver = new EditGptTrackerVisualDriverV1(config, { async run() { calls += 1; return processResult(""); } });
  const result = await driver.analyze({ ...request, requiredPointIndices: [2] });
  assert.equal(result.status, "REFUSED");
  assert.match(result.detail, /invalid required-point set/);
  assert.equal(calls, 0);
});

test("two-point live proof scripts are reversible and never save or close the user project", async () => {
  const setup = await readFile("scripts/windows/m4-two-point-analysis-fixture-setup.jsx", "utf8");
  const cleanup = await readFile("scripts/windows/m4-two-point-analysis-cleanup.jsx", "utf8");
  const readback = await readFile("scripts/windows/m4-two-point-analysis-readback.jsx", "utf8");
  const liveDriver = await readFile("scripts/m4-two-point-analysis-driver-live.mjs", "utf8");
  const joined = [setup, cleanup, readback, liveDriver].join("\n");
  assert.doesNotMatch(joined, /app\.project\.save|app\.project\.close|app\.quit|saveAs\s*\(/);
  assert.match(cleanup, /EF2_M4_TP_ANALYSIS_OWNED/);
  assert.match(cleanup, /fixture\.parentFolder\.id !== folder\.id/);
  assert.match(cleanup, /sourceComp\.parentFolder\.id !== folder\.id/);
  assert.match(cleanup, /black\.parentFolder\.id !== folder\.id/);
  assert.match(cleanup, /feature\.parentFolder\.id !== folder\.id/);
  assert.match(cleanup, /folder\.numItems !== 0/);
  assert.match(cleanup, /original\.openInViewer\(\)/);
});


test("backward repair/resume retained proof is portable, bounded, and reversible", async () => {
  const driver = await readFile("scripts/m4-tracker-repair-resume-backward-driver-live.mjs", "utf8");
  const acceptance = await readFile("scripts/m4-tracker-repair-resume-backward-acceptance.mjs", "utf8");
  const fixture = await readFile("scripts/windows/m4-tracker-repair-resume-backward-fixture.jsx", "utf8");
  const readback = await readFile("scripts/windows/m4-tracker-repair-resume-backward-readback.jsx", "utf8");
  const cleanup = await readFile("scripts/windows/m4-tracker-repair-resume-backward-cleanup.jsx", "utf8");
  const joined = [driver, acceptance, fixture, readback, cleanup].join("\n");
  assert.doesNotMatch(joined, /C:\\\\Users\\\\Shadow/);
  assert.match(driver, /EDITGPT_PYTHON/);
  assert.match(driver, /USERPROFILE/);
  assert.match(acceptance, /path\.relative\(root, value\)/);
  assert.doesNotMatch(joined, /app\.project\.save|app\.project\.close|app\.quit|saveAs\s*\(/);
  assert.match(cleanup, /baselineItems/);
});
