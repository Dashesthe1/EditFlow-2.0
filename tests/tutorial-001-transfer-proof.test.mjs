import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deriveTutorialSkillStateV0 } from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import {
  TUTORIAL_001_TRANSFER_PROFILE as P,
} from "../scripts/proofs/tutorial-001-transfer-profile.mjs";

const runnerPath = "scripts/proofs/tutorial-001-transfer.mjs";
const fixturePath = "scripts/windows/tutorial-001-transfer.jsx";

test("Tutorial 001 transfer profile materially changes every declared transfer dimension", () => {
  assert.equal(P.comp.width, 1920);
  assert.equal(P.comp.height, 1080);
  assert.equal(P.comp.frameRate, 30);
  assert.equal(P.comp.durationSeconds, 6.4);
  assert.equal(P.anchor.timeMs, 3200);
  assert.equal(P.anchor.basis, "MOTION_DRIVEN");

  assert.notDeepEqual([P.comp.width, P.comp.height], [1080, 1920]);
  assert.notEqual(P.comp.frameRate, 60);
  assert.notEqual(P.anchor.timeMs, 2000);
  assert.ok(P.sourceWindows.outgoing.sourceEndSeconds
    < P.sourceWindows.incoming.sourceStartSeconds);
  assert.ok(P.compileHandleTiming.outgoingOutSeconds
    > P.targetTiming.outgoingOutSeconds);
  assert.ok(P.compileHandleTiming.incomingInSeconds
    < P.targetTiming.incomingInSeconds);
  assert.ok(P.recipe.zoomCenter[0] < 0.5);
  assert.ok(P.recipe.zoomCenter[1] > 0.5);
  assert.ok(P.sourceTransform.scale[0] > 100);
});test("Tutorial 001 transfer profile reverses outgoing motion and changes motion scale", () => {
  const [outgoing, incoming] = P.motion.segments;
  assert.ok(outgoing.sourceStartX > outgoing.sourceEndX);
  assert.ok(incoming.sourceStartX < incoming.sourceEndX);
  assert.equal(outgoing.expectedTrend, "ACCELERATE");
  assert.equal(incoming.expectedTrend, "DECELERATE");
  assert.equal(P.motion.timesMs.length, 10);
  assert.equal(P.motion.referenceMarkers[0].sourceX, 288);
  assert.equal(P.motion.referenceMarkers[1].sourceX, 1632);
});

test("Tutorial 001 transfer profile covers the lesson-declared Level-6 axes", () => {
  assert.deepEqual(P.transferAxes, [
    "different frame rate",
    "different shot duration and source-handle length",
    "different subject scale and off-center subject position",
    "different source motion speed and direction",
    "portrait versus landscape aspect ratio",
    "beat-driven versus motion-driven transition anchor",
  ]);
});

test("Tutorial 001 transfer runner reuses the normal semantic compiler and warm transaction path", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /compileTutorialDeepLessonV1/);
  assert.match(source, /compileEditingIrRecipeToVirtualAeV1/);
  assert.match(source, /lowerCompiledRecipeToNativeAePlanV1/);
  assert.match(source, /curveBindingMode: "LIVE_ADAPTIVE"/);
  assert.match(source, /livePlan\.operations\.length === 48/);
  assert.ok(source.indexOf("compileTransferRecipe()") < source.indexOf("getStatus()"),
    "Level-0 semantic compilation must happen before live AE setup.");
  assert.match(source, /M5_MOCHA_SOURCE|realSourceStableId/);
  assert.match(source, /kind: "TRANSFER"/);
  assert.match(source, /learningState = "TRANSFER_VERIFIED"/);
  assert.match(source, /baselineFingerprintRestored/);
});test("Tutorial 001 transfer fixture overlays diagnostics on real media without constructing the effect", async () => {
  const source = await readFile(fixturePath, "utf8");
  assert.match(source, /REAL_MEDIA_LAYERS_REQUIRED/);
  assert.match(source, /EF2_T001_TRANSFER_REAL_OUT_LAYER/);
  assert.match(source, /EF2_T001_TRANSFER_REAL_IN_LAYER/);
  assert.match(source, /REF_LEFT/);
  assert.match(source, /REF_RIGHT/);
  assert.match(source, /MOTION/);
  assert.match(source, /saveFrameToPng/);
  assert.doesNotMatch(source, /Time Remap|ADBE Time Remapping|setTemporalEase/);
  assert.doesNotMatch(source, /ADBE Scale.*setValueAtTime/);
});

test("Tutorial 001 transfer proof keeps visual and motion gates bounded", () => {
  assert.deepEqual(P.visual.timesMs, [2400, 3100, 3200, 3300, 4000]);
  assert.deepEqual(P.visual.rules.tailTimesMs, [2400, 4000]);
  assert.equal(P.visual.rules.anchorToleranceMs, 150);
  assert.ok(P.visual.rules.minAnchorToTailRatio > 1);
  assert.ok(P.visual.rules.maxBorderTransparentRatio <= 0.001);
  assert.ok(P.motion.rules.minTrendRatio > 1);
  assert.ok(P.motion.rules.maxPlaybackRate <= 2.5);
});

test("Tutorial 001 retained proof manifest promotes through the canonical learning-state contract", async () => {
  const manifest = JSON.parse(await readFile(
    "proofs/diagnostics/m5-tutorial-001-skill-proofs.json",
    "utf8",
  ));
  assert.equal(manifest.tutorialId, "tutorial.smooth-zoom-reverse.001");
  assert.equal(manifest.skillId, "skill.velocity-zoom-transition");
  assert.equal(
    deriveTutorialSkillStateV0(manifest.skillId, manifest.proofs),
    "TRANSFER_VERIFIED",
  );
  assert.equal(manifest.state, "TRANSFER_VERIFIED");
  assert.deepEqual(manifest.proofs.map((proof) => proof.kind), [
    "RECONSTRUCTION",
    "TRANSFER",
  ]);
  assert.ok(manifest.proofs.every((proof) => proof.passed));
  assert.ok(manifest.proofs[1].evidenceRefs.includes(
    "proofs/diagnostics/m5-tutorial-001-transfer.json",
  ));
});
