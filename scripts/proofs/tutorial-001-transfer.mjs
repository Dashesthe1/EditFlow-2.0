import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileTutorialDeepLessonV1 } from "../../.tmp/runtime/packages/tutorial-learning/src/index.js";
import {
  compileEditingIrRecipeToVirtualAeV1,
  lowerCompiledRecipeToNativeAePlanV1,
  recipeParameterKeyV1,
} from "../../.tmp/runtime/packages/recipe-compiler/src/index.js";
import { AE_ADAPTER_ROUTE_ID_V11 } from "../../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { evaluateSparseVisualProofV1 } from "./sparse-visual-evaluator.mjs";
import { evaluateMotionLandmarkProofV1 } from "./motion-landmark-evaluator.mjs";
import {
  TUTORIAL_001_TRANSFER_PROFILE as P,
  transferFramesFromCaptureV1,
} from "./tutorial-001-transfer-profile.mjs";

const BASE = process.env.EDITFLOW_SHADOW_CONTROL ?? "http://127.0.0.1:32146";
const FIXTURE = "tests/fixtures/tutorials/smooth-zoom-reverse-v1.json";
const EVIDENCE = "proofs/diagnostics/m5-tutorial-001-transfer.json";
const SCRIPT = resolve("scripts/windows/tutorial-001-transfer.jsx");
const ARTIFACT_ROOT = "proofs/artifacts/tutorial-001-transfer";
const TARGET = "EF2_T001_TRANSFER_TARGET";
const SOURCE_OUT = "EF2_T001_TRANSFER_SOURCE_OUT";
const SOURCE_IN = "EF2_T001_TRANSFER_SOURCE_IN";
const LAYER_OUT = "EF2_T001_TRANSFER_LAYER_OUT";
const LAYER_IN = "EF2_T001_TRANSFER_LAYER_IN";
const REAL_OUT = "EF2_T001_TRANSFER_REAL_OUT_LAYER";
const REAL_IN = "EF2_T001_TRANSFER_REAL_IN_LAYER";

const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};const jsonRequest = async (path, init = {}) => {
  const response = await fetch(BASE + path, init);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    throw new Error(path + " failed " + response.status + ": " + JSON.stringify(body));
  }
  return body;
};
const getState = async () => jsonRequest("/state");
const getStatus = async () => jsonRequest("/status");
const runTransaction = async (plan) => jsonRequest("/run-transaction", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ plan }),
});
const runCapture = async () => {
  const result = await jsonRequest("/proof-script", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scriptPath: SCRIPT }),
  });
  requireThat(result.ok === true, "Tutorial 001 transfer capture script failed.");
  return result;
};
const waitForFiles = async (capture) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    let complete = true;
    for (const file of capture.files ?? []) {
      try {
        const info = await stat(file);
        if (info.size < 1) complete = false;
      } catch {
        complete = false;
      }
    }
    if (complete) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("T001_TRANSFER_FRAME_COMPLETION_TIMEOUT");
};const planOperation = (
  id, capabilityId, command, payload, dependsOn = [], riskClass = "R2_STRUCTURAL",
) => ({
  operationId: id,
  capabilityId,
  routeId: AE_ADAPTER_ROUTE_ID_V11,
  dependsOn,
  idempotency: "CHECK_THEN_APPLY",
  riskClass,
  input: { command, payload, readbackProfile: "TUTORIAL_001_TRANSFER" },
  rollbackBoundaryId: "ROLLBACK_T001_TRANSFER",
});
const planEnvelope = (planId, observed, requiredCapabilities, operations) => ({
  planId,
  planRevision: 1,
  projectRevision: observed.projectRevision,
  projectFingerprint: observed.projectFingerprint,
  environmentFingerprint: observed.environmentFingerprint,
  creativeObjective: "Tutorial 001 materially-different real-media transfer proof.",
  requiredCapabilities,
  bindings: [],
  operations,
  checkpoints: [],
  invariants: { structural: [], visual: [] },
  rollbackBoundaries: [{ id: "ROLLBACK_T001_TRANSFER", strategy: "RESTORE_SNAPSHOT" }],
});

const setupPlan = (observed) => {
  const c = P.comp;
  const createComp = (id, stableId, name, dependsOn) => planOperation(
    id, "ae.comp.create", "comp.create",
    {
      stableId, name, width: c.width, height: c.height, pixelAspect: 1,
      duration: c.durationSeconds, frameRate: c.frameRate,
    },
    dependsOn,
  );  const operations = [
    createComp("T001X_SETUP_001", SOURCE_OUT, "EF2 Tutorial 001 Transfer Source Out", []),
    createComp("T001X_SETUP_002", SOURCE_IN, "EF2 Tutorial 001 Transfer Source In", ["T001X_SETUP_001"]),
    createComp("T001X_SETUP_003", TARGET, "EF2 Tutorial 001 Transfer Target", ["T001X_SETUP_002"]),
  ];
  const addMedia = (id, layerId, compId, itemId, dependsOn) => planOperation(
    id, "ae.layer.create", "layer.add_media",
    {
      stableId: layerId,
      comp: { stableId: compId },
      item: { stableId: itemId },
      duration: c.durationSeconds,
    },
    dependsOn,
  );
  const setTransform = (id, layerId, compId, dependsOn) => planOperation(
    id, "ae.layer.transform.set", "layer.set_transform",
    {
      comp: { stableId: compId },
      layer: { stableId: layerId },
      values: {
        position: [...P.sourceTransform.position],
        scale: [...P.sourceTransform.scale],
        rotation: 0,
        opacity: 100,
      },
    },
    dependsOn,
  );
  const setTiming = (id, layerId, compId, timing, dependsOn) => planOperation(
    id, "ae.layer.timing.set", "layer.set_timing",
    { comp: { stableId: compId }, layer: { stableId: layerId }, timing },
    dependsOn,
  );  operations.push(addMedia(
    "T001X_SETUP_004", REAL_OUT, SOURCE_OUT, P.realSourceStableId, ["T001X_SETUP_003"],
  ));
  operations.push(setTransform("T001X_SETUP_005", REAL_OUT, SOURCE_OUT, ["T001X_SETUP_004"]));
  operations.push(setTiming(
    "T001X_SETUP_006", REAL_OUT, SOURCE_OUT,
    {
      startTime: P.sourceWindows.outgoing.layerStartTimeSeconds,
      inPoint: 0,
      outPoint: c.durationSeconds,
      stretch: 100,
    },
    ["T001X_SETUP_005"],
  ));
  operations.push(addMedia(
    "T001X_SETUP_007", REAL_IN, SOURCE_IN, P.realSourceStableId, ["T001X_SETUP_006"],
  ));
  operations.push(setTransform("T001X_SETUP_008", REAL_IN, SOURCE_IN, ["T001X_SETUP_007"]));
  operations.push(setTiming(
    "T001X_SETUP_009", REAL_IN, SOURCE_IN,
    {
      startTime: P.sourceWindows.incoming.layerStartTimeSeconds,
      inPoint: 0,
      outPoint: c.durationSeconds,
      stretch: 100,
    },
    ["T001X_SETUP_008"],
  ));  operations.push(addMedia("T001X_SETUP_010", LAYER_OUT, TARGET, SOURCE_OUT, ["T001X_SETUP_009"]));
  operations.push(setTiming(
    "T001X_SETUP_011", LAYER_OUT, TARGET,
    {
      startTime: 0,
      inPoint: P.targetTiming.outgoingInSeconds,
      outPoint: P.targetTiming.outgoingOutSeconds,
      stretch: 100,
    },
    ["T001X_SETUP_010"],
  ));
  operations.push(addMedia("T001X_SETUP_012", LAYER_IN, TARGET, SOURCE_IN, ["T001X_SETUP_011"]));
  operations.push(setTiming(
    "T001X_SETUP_013", LAYER_IN, TARGET,
    {
      startTime: 0,
      inPoint: P.targetTiming.incomingInSeconds,
      outPoint: P.targetTiming.incomingOutSeconds,
      stretch: 100,
    },
    ["T001X_SETUP_012"],
  ));
  return planEnvelope(
    "tutorial-001-transfer-setup",
    observed,
    ["ae.comp.create", "ae.layer.create", "ae.layer.transform.set", "ae.layer.timing.set"],
    operations,
  );
};

const virtualProject = () => ({
  schema: "editflow.virtual-ae.project.v1",
  activeCompId: TARGET,
  compositions: [{
    compId: TARGET,
    name: "Tutorial 001 Transfer Target",
    width: P.comp.width,
    height: P.comp.height,
    durationMs: P.comp.durationSeconds * 1000,
    frameRate: P.comp.frameRate,
    layers: [      {
        layerId: LAYER_OUT,
        name: "Outgoing transfer shot",
        kind: "FOOTAGE",
        sourceRef: SOURCE_OUT,
        inMs: P.targetTiming.outgoingInSeconds * 1000,
        outMs: P.targetTiming.outgoingOutSeconds * 1000,
        properties: [], effects: [], masks: [],
      },
      {
        layerId: LAYER_IN,
        name: "Incoming transfer shot",
        kind: "FOOTAGE",
        sourceRef: SOURCE_IN,
        inMs: P.targetTiming.incomingInSeconds * 1000,
        outMs: P.targetTiming.incomingOutSeconds * 1000,
        properties: [], effects: [], masks: [],
      },
    ],
  }],
});
const recipeContext = () => ({
  compId: TARGET,
  eventTimesMs: { "transition-anchor": P.anchor.timeMs },
  roleBindings: [
    { role: "transition.outgoing_shot", layerIds: [LAYER_OUT] },
    { role: "transition.incoming_shot", layerIds: [LAYER_IN] },
  ],
  parameterValues: {
    [recipeParameterKeyV1("shape-temporal-velocity-pulse", "velocityPulseDuration")]:
      P.recipe.velocityPulseDuration,
    [recipeParameterKeyV1("shape-temporal-velocity-pulse", "velocityContrast")]:
      P.recipe.velocityContrast,
    [recipeParameterKeyV1("shape-temporal-velocity-pulse", "temporalPeakPhase")]:
      P.recipe.temporalPeakPhase,    [recipeParameterKeyV1("couple-zoom-pulse", "zoomPulseDuration")]:
      P.recipe.zoomPulseDuration,
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomIntensity")]:
      P.recipe.zoomIntensity,
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomCenter")]:
      [...P.recipe.zoomCenter],
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomTemporalPhase")]:
      P.recipe.zoomTemporalPhase,
  },
});
const compileLivePlan = async (observed) => {
  const packet = JSON.parse(await readFile(FIXTURE, "utf8"));
  const recipe = compileTutorialDeepLessonV1(packet).skills[0].editingIr;
  const compiled = compileEditingIrRecipeToVirtualAeV1(recipe, virtualProject(), recipeContext());
  return lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "tutorial-001-transfer-native-plan",
    observedState: observed,
    curveBindingMode: "LIVE_ADAPTIVE",
    creativeObjective: "Transfer velocity-plus-zoom semantics to materially different real media.",
    recipeRefs: ["skill.velocity-zoom-transition"],
  });
};
const cleanupPlan = (observed, ids) => {
  const operations = ids.map((stableId, index) => planOperation(
    "T001X_CLEANUP_" + String(index + 1).padStart(3, "0"),
    "ae.comp.remove",
    "comp.remove",
    { comp: { stableId } },
    index === 0 ? [] : ["T001X_CLEANUP_" + String(index).padStart(3, "0")],
    "R3_DESTRUCTIVE",
  ));  return planEnvelope(
    "tutorial-001-transfer-cleanup",
    observed,
    ["ae.comp.remove"],
    operations,
  );
};
const stableItemIds = (state) => new Set(
  (state.state.project.items ?? []).map((item) => item.stableId).filter(Boolean),
);
const findItem = (state, stableId) =>
  (state.state.project.items ?? []).find((item) => item.stableId === stableId) ?? null;
const findComp = (state, stableId) => findItem(state, stableId)?.composition ?? null;

const main = async () => {
  const status = await getStatus();
  requireThat(status.panel?.protocolVersion === "2.7.0",
    "Tutorial 001 transfer requires warm protocol 2.7.0.");
  const before = await getState();
  const realSource = findItem(before, P.realSourceStableId);
  requireThat(realSource?.kind === "FOOTAGE",
    "Tutorial 001 transfer requires retained real source footage " + P.realSourceStableId + ".");

  const baselineIds = [...stableItemIds(before)].sort();
  const evidence = {
    proof: "M5_TUTORIAL_001_TRANSFER_V1",
    skillId: "skill.velocity-zoom-transition",
    sourceCommit: process.env.EDITFLOW_SOURCE_COMMIT ?? null,
    startedAt: new Date().toISOString(),
    panel: status.panel,
    transferProfile: P,
    realMedia: {
      sourceStableId: P.realSourceStableId,
      sourceName: realSource.name,
      sourceWindows: P.sourceWindows,
    },
    before: {
      hostRevision: before.state.hostRevision,
      projectFingerprint: before.state.observed.projectFingerprint,
      itemCount: before.state.project.itemCount,
      stableItemIds: baselineIds,
    },
  };  let livePlan = null;
  let proofError = null;
  try {
    const setup = await runTransaction(setupPlan(before.state.observed));
    requireThat(setup.result?.state === "COMMITTED", "Tutorial 001 transfer setup did not commit.");

    await runCapture();
    const baselineVisual = JSON.parse(await readFile(ARTIFACT_ROOT + "/baseline.json", "utf8"));
    const prepared = JSON.parse(await readFile(ARTIFACT_ROOT + "/prepared.json", "utf8"));
    requireThat(baselineVisual.phase === "baseline", "Transfer baseline phase mismatch.");
    requireThat(prepared.phase === "prepared", "Transfer fixture preparation mismatch.");
    await waitForFiles(baselineVisual);
    evidence.visual = { baseline: baselineVisual };
    evidence.fixture = prepared;

    const afterSetup = await getState();
    livePlan = await compileLivePlan(afterSetup.state.observed);
    requireThat(livePlan.operations.length === 48,
      "Tutorial 001 transfer native plan must contain 48 operations.");
    const precomposeOps = livePlan.operations.filter((operation) =>
      operation.input.command === "layers.precompose");
    requireThat(precomposeOps.length === 2, "Transfer plan must precompose both shot layers.");

    const result = await runTransaction(livePlan);
    requireThat(result.result?.state === "COMMITTED", "Tutorial 001 transfer transaction did not commit.");

    const after = await getState();
    const target = findComp(after, TARGET);
    requireThat(target !== null, "Tutorial 001 transfer target disappeared after commit.");
    requireThat(target.width === P.comp.width && target.height === P.comp.height,
      "Transfer target dimensions changed unexpectedly.");
    requireThat(Math.abs(target.frameRate - P.comp.frameRate) < 0.01,
      "Transfer target frame rate changed unexpectedly.");    const replacementIds = precomposeOps.map((operation) =>
      operation.input.payload.replacementStableId);
    const targetLayerIds = (target.layers ?? []).map((layer) => layer.stableId);
    requireThat(replacementIds.every((id) => targetLayerIds.includes(id)),
      "Transfer precompose replacement layers are missing.");
    requireThat(!targetLayerIds.includes(LAYER_OUT) && !targetLayerIds.includes(LAYER_IN),
      "Original transfer shot identities survived precompose unexpectedly.");

    await runCapture();
    const editedVisual = JSON.parse(await readFile(ARTIFACT_ROOT + "/edited.json", "utf8"));
    const motionCapture = JSON.parse(await readFile(ARTIFACT_ROOT + "/motion.json", "utf8"));
    requireThat(editedVisual.phase === "edited", "Transfer edited visual phase mismatch.");
    requireThat(motionCapture.phase === "edited", "Transfer motion phase mismatch.");
    requireThat(JSON.stringify(motionCapture.timesMs) === JSON.stringify(P.motion.timesMs),
      "Transfer motion capture times do not match the declared profile.");
    await waitForFiles(editedVisual);
    await waitForFiles(motionCapture);

    evidence.visual.edited = editedVisual;
    evidence.visual.assessment = await evaluateSparseVisualProofV1({
      baselineFrames: transferFramesFromCaptureV1(baselineVisual),
      editedFrames: transferFramesFromCaptureV1(editedVisual),
      anchorMs: P.anchor.timeMs,
      rules: P.visual.rules,
    });
    requireThat(evidence.visual.assessment.passed,
      "Transfer sparse visual assessment failed: "
        + evidence.visual.assessment.issues.join(", "));

    evidence.motion = {
      capture: motionCapture,
      assessment: await evaluateMotionLandmarkProofV1({
        frames: transferFramesFromCaptureV1(motionCapture),
        referenceMarkers: P.motion.referenceMarkers,
        movingMarker: P.motion.movingMarker,
        segments: P.motion.segments,
        sourceDurationSeconds: P.comp.durationSeconds,
        rules: P.motion.rules,
      }),
    };    requireThat(evidence.motion.assessment.passed,
      "Transfer motion assessment failed: " + evidence.motion.assessment.issues.join(", "));

    evidence.execution = {
      planOperations: livePlan.operations.length,
      requiredCapabilities: livePlan.requiredCapabilities,
      replacementLayerIds: replacementIds,
      resultState: result.result.state,
      appliedOperations: result.result.appliedOperations,
      hostRevisionAfter: after.state.hostRevision,
      targetLayerIds,
    };
    evidence.transferAxes = {
      declared: [...P.transferAxes],
      coverage: {
        "different frame rate": { reconstructionFps: 60, transferFps: P.comp.frameRate },
        "different shot duration and source-handle length": P.sourceWindows,
        "different subject scale and off-center subject position": {
          sourceScale: P.sourceTransform.scale,
          attentionCenter: P.recipe.zoomCenter,
        },
        "different source motion speed and direction": {
          outgoingPath: [1248, 96],
          incomingPath: [96, 1248],
          sourceDurationSeconds: P.comp.durationSeconds,
        },
        "portrait versus landscape aspect ratio": {
          reconstruction: [1080, 1920],
          transfer: [P.comp.width, P.comp.height],
        },
        "beat-driven versus motion-driven transition anchor": P.anchor,
      },
    };
    evidence.proofRecord = {
      skillId: "skill.velocity-zoom-transition",
      kind: "TRANSFER",
      passed: true,
      evidenceRefs: [EVIDENCE],
    };
    evidence.learningState = "TRANSFER_VERIFIED";
  } catch (error) {
    proofError = error;
    evidence.error = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };
  } finally {    const current = await getState();
    const currentIds = stableItemIds(current);
    const generatedPrecomps = livePlan === null ? [] : livePlan.operations
      .filter((operation) => operation.input.command === "layers.precompose")
      .map((operation) => operation.input.payload.stableId);
    const cleanupOrder = [TARGET, ...generatedPrecomps, SOURCE_OUT, SOURCE_IN]
      .filter((id, index, all) => all.indexOf(id) === index && currentIds.has(id));
    if (cleanupOrder.length > 0) {
      const cleanup = await runTransaction(cleanupPlan(current.state.observed, cleanupOrder));
      requireThat(cleanup.result?.state === "COMMITTED",
        "Tutorial 001 transfer cleanup did not commit.");
    }
    const final = await getState();
    evidence.finishedAt = new Date().toISOString();
    evidence.cleanup = {
      hostRevision: final.state.hostRevision,
      projectFingerprint: final.state.observed.projectFingerprint,
      itemCount: final.state.project.itemCount,
      stableItemIds: [...stableItemIds(final)].sort(),
      baselineFingerprintRestored:
        final.state.observed.projectFingerprint === before.state.observed.projectFingerprint,
      baselineItemCountRestored: final.state.project.itemCount === before.state.project.itemCount,
      baselineStableIdsRestored:
        JSON.stringify([...stableItemIds(final)].sort()) === JSON.stringify(baselineIds),
    };
    requireThat(evidence.cleanup.baselineFingerprintRestored,
      "Transfer cleanup did not restore the baseline project fingerprint.");
    requireThat(evidence.cleanup.baselineItemCountRestored,
      "Transfer cleanup did not restore baseline item count.");
    requireThat(evidence.cleanup.baselineStableIdsRestored,
      "Transfer cleanup did not restore baseline stable-item identities.");
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  }

  if (proofError !== null) throw proofError;
  console.log(JSON.stringify({
    ok: true,
    evidence: EVIDENCE,
    learningState: evidence.learningState,
    execution: evidence.execution,
    cleanup: evidence.cleanup,
  }));
};

await main();
