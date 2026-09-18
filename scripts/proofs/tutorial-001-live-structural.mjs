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
import {
  TUTORIAL_001_VISUAL_ANCHOR_MS,
  TUTORIAL_001_VISUAL_RULES,
  framesFromSparseCaptureV1,
} from "./tutorial-001-visual-profile.mjs";
import { evaluateMotionLandmarkProofV1 } from "./motion-landmark-evaluator.mjs";
import {
  TUTORIAL_001_MOTION_MARKERS,
  TUTORIAL_001_MOTION_RULES,
  TUTORIAL_001_MOTION_SEGMENTS,
  TUTORIAL_001_MOTION_TIMES_MS,
  framesFromMotionCaptureV1,
} from "./tutorial-001-motion-profile.mjs";

const BASE = process.env.EDITFLOW_SHADOW_CONTROL ?? "http://127.0.0.1:32146";
const FIXTURE = "tests/fixtures/tutorials/smooth-zoom-reverse-v1.json";
const VISUAL_MODE = process.env.EDITFLOW_T001_VISUAL === "1";
const MOTION_MODE = process.env.EDITFLOW_T001_MOTION === "1";
const EVIDENCE = MOTION_MODE
  ? "proofs/diagnostics/m5-tutorial-001-live-adaptive-short-motion.json"
  : VISUAL_MODE
    ? "proofs/diagnostics/m5-tutorial-001-live-adaptive-visual.json"
    : "proofs/diagnostics/m5-tutorial-001-live-adaptive-structural.json";
const VISUAL_SCRIPT = resolve("scripts/windows/tutorial-001-sparse-visual.jsx");
const VISUAL_ARTIFACT_ROOT = "proofs/artifacts/tutorial-001-sparse-visual";
const MOTION_SCRIPT = resolve("scripts/windows/tutorial-001-short-motion.jsx");
const MOTION_ARTIFACT_ROOT = "proofs/artifacts/tutorial-001-short-motion";
const COMP = "EF2_T001_LIVE_TRANSITION";
const SOURCE_OUT = "EF2_T001_LIVE_SOURCE_OUT";
const SOURCE_IN = "EF2_T001_LIVE_SOURCE_IN";
const LAYER_OUT = "EF2_T001_LIVE_LAYER_OUT";
const LAYER_IN = "EF2_T001_LIVE_LAYER_IN";
const WIDTH = 1080, HEIGHT = 1920, DURATION = 5, FPS = 60;

const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};
const jsonRequest = async (path, init = {}) => {
  const response = await fetch(BASE + path, init);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${JSON.stringify(body)}`);
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
const runVisualCapture = async () => {
  const result = await jsonRequest("/proof-script", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scriptPath: VISUAL_SCRIPT }),
  });
  requireThat(result.ok === true, "Tutorial 001 sparse visual proof script failed.");
  return result;
};
const runMotionCapture = async () => {
  const result = await jsonRequest("/proof-script", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scriptPath: MOTION_SCRIPT }),
  });
  requireThat(result.ok === true, "Tutorial 001 short-motion proof script failed.");
  return result;
};
const waitForVisualFiles = async (visual) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let complete = true;
    for (const file of visual.files ?? []) {
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
  throw new Error("T001_VISUAL_FRAME_COMPLETION_TIMEOUT");
};

const planOperation = (id, capabilityId, command, payload, dependsOn = [], riskClass = "R2_STRUCTURAL") => ({
  operationId: id,
  capabilityId,
  routeId: AE_ADAPTER_ROUTE_ID_V11,
  dependsOn,
  idempotency: "CHECK_THEN_APPLY",
  riskClass,
  input: { command, payload, readbackProfile: "TUTORIAL_001_LIVE_STRUCTURAL" },
  rollbackBoundaryId: "ROLLBACK_T001_LIVE",
});
const planEnvelope = (planId, observed, requiredCapabilities, operations) => ({
  planId,
  planRevision: 1,
  projectRevision: observed.projectRevision,
  projectFingerprint: observed.projectFingerprint,
  environmentFingerprint: observed.environmentFingerprint,
  creativeObjective: "Bounded Tutorial 001 live structural proof.",
  requiredCapabilities,
  bindings: [],
  operations,
  checkpoints: [],
  invariants: { structural: [], visual: [] },
  rollbackBoundaries: [{ id: "ROLLBACK_T001_LIVE", strategy: "RESTORE_SNAPSHOT" }],
});

const setupPlan = (observed) => {
  const create = (id, stableId, name, dependsOn) => planOperation(
    id, "ae.comp.create", "comp.create",
    { stableId, name, width: WIDTH, height: HEIGHT, pixelAspect: 1, duration: DURATION, frameRate: FPS },
    dependsOn,
  );
  const operations = [
    create("T001_SETUP_001", SOURCE_OUT, "EF2 Tutorial 001 Source Out", []),
    create("T001_SETUP_002", SOURCE_IN, "EF2 Tutorial 001 Source In", ["T001_SETUP_001"]),
    create("T001_SETUP_003", COMP, "EF2 Tutorial 001 Live Transition", ["T001_SETUP_002"]),
  ];
  operations.push(planOperation(
    "T001_SETUP_004", "ae.layer.create", "layer.add_media",
    { stableId: LAYER_OUT, comp: { stableId: COMP }, item: { stableId: SOURCE_OUT }, duration: DURATION },
    ["T001_SETUP_003"],
  ));
  operations.push(planOperation(
    "T001_SETUP_005", "ae.layer.create", "layer.add_media",
    { stableId: LAYER_IN, comp: { stableId: COMP }, item: { stableId: SOURCE_IN }, duration: DURATION },
    ["T001_SETUP_004"],
  ));
  return planEnvelope(
    "tutorial-001-live-setup",
    observed,
    ["ae.comp.create", "ae.layer.create"],
    operations,
  );
};

const virtualProject = () => ({
  schema: "editflow.virtual-ae.project.v1",
  activeCompId: COMP,
  compositions: [{
    compId: COMP,
    name: "Tutorial 001 Live Transition",
    width: WIDTH,
    height: HEIGHT,
    durationMs: DURATION * 1000,
    frameRate: FPS,
    layers: [{
      layerId: LAYER_OUT, name: "Outgoing", kind: "FOOTAGE",
      sourceRef: SOURCE_OUT, inMs: 0, outMs: 3000, properties: [], effects: [], masks: [],
    }, {
      layerId: LAYER_IN, name: "Incoming", kind: "FOOTAGE",
      sourceRef: SOURCE_IN, inMs: 1000, outMs: 4000, properties: [], effects: [], masks: [],
    }],
  }],
});
const recipeContext = () => ({
  compId: COMP,
  eventTimesMs: { "transition-anchor": 2000 },
  roleBindings: [
    { role: "transition.outgoing_shot", layerIds: [LAYER_OUT] },
    { role: "transition.incoming_shot", layerIds: [LAYER_IN] },
  ],
  parameterValues: {
    [recipeParameterKeyV1("shape-temporal-velocity-pulse", "velocityPulseDuration")]: 0.3,
    [recipeParameterKeyV1("shape-temporal-velocity-pulse", "velocityContrast")]: 0.4,
    [recipeParameterKeyV1("shape-temporal-velocity-pulse", "temporalPeakPhase")]: 0.5,
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomPulseDuration")]: 0.25,
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomIntensity")]: 0.3,
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomCenter")]: [0.62, 0.44],
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomTemporalPhase")]: 0.5,
  },
});

const compileLivePlan = async (observed) => {
  const packet = JSON.parse(await readFile(FIXTURE, "utf8"));
  const recipe = compileTutorialDeepLessonV1(packet).skills[0].editingIr;
  const compiled = compileEditingIrRecipeToVirtualAeV1(recipe, virtualProject(), recipeContext());
  return lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "tutorial-001-live-native-plan",
    observedState: observed,
    curveBindingMode: "LIVE_ADAPTIVE",
    creativeObjective: "Reconstruct Tutorial 001 through live-adapted native AE primitives.",
    recipeRefs: ["skill.velocity-zoom-transition"],
  });
};

const cleanupPlan = (observed, ids) => {
  const operations = ids.map((stableId, index) => planOperation(
    `T001_CLEANUP_${String(index + 1).padStart(3, "0")}`,
    "ae.comp.remove",
    "comp.remove",
    { comp: { stableId } },
    index === 0 ? [] : [`T001_CLEANUP_${String(index).padStart(3, "0")}`],
    "R3_DESTRUCTIVE",
  ));
  return planEnvelope("tutorial-001-live-cleanup", observed, ["ae.comp.remove"], operations);
};

const stableItemIds = (state) => new Set(
  (state.state.project.items ?? []).map((item) => item.stableId).filter(Boolean),
);
const findComp = (state, stableId) =>
  (state.state.project.items ?? []).find((item) => item.stableId === stableId)?.composition ?? null;

const main = async () => {
  requireThat(!(VISUAL_MODE && MOTION_MODE),
    "Tutorial 001 visual and motion proof modes must run independently.");
  const status = await getStatus();
  requireThat(status.panel?.protocolVersion === "2.7.0", "Tutorial 001 live proof requires warm protocol 2.7.0.");

  const before = await getState();
  const baselineIds = [...stableItemIds(before)].sort();
  const evidence = {
    proof: MOTION_MODE
      ? "M5_TUTORIAL_001_LIVE_ADAPTIVE_SHORT_MOTION_V1"
      : VISUAL_MODE
        ? "M5_TUTORIAL_001_LIVE_ADAPTIVE_VISUAL_V1"
        : "M5_TUTORIAL_001_LIVE_ADAPTIVE_STRUCTURAL_V1",
    sourceCommit: process.env.EDITFLOW_SOURCE_COMMIT ?? null,
    startedAt: new Date().toISOString(),
    panel: status.panel,
    before: {
      hostRevision: before.state.hostRevision,
      projectFingerprint: before.state.observed.projectFingerprint,
      itemCount: before.state.project.itemCount,
      stableItemIds: baselineIds,
    },
  };
  let livePlan = null;
  let result = null;
  let proofError = null;
  try {
    const setup = await runTransaction(setupPlan(before.state.observed));
    requireThat(setup.result?.state === "COMMITTED", "Tutorial 001 live setup did not commit.");

    if (VISUAL_MODE) {
      await runVisualCapture();
      const baselineVisual = JSON.parse(
        await readFile(`${VISUAL_ARTIFACT_ROOT}/baseline.json`, "utf8"),
      );
      requireThat(baselineVisual.phase === "baseline", "Tutorial 001 baseline visual phase mismatch.");
      await waitForVisualFiles(baselineVisual);
      evidence.visual = { baseline: baselineVisual };
    }
    if (MOTION_MODE) {
      await runMotionCapture();
      const preparedMotion = JSON.parse(
        await readFile(`${MOTION_ARTIFACT_ROOT}/prepared.json`, "utf8"),
      );
      requireThat(preparedMotion.phase === "prepared", "Tutorial 001 motion fixture preparation mismatch.");
      evidence.motion = { prepared: preparedMotion };
    }

    const afterSetup = await getState();
    livePlan = await compileLivePlan(afterSetup.state.observed);
    requireThat(livePlan.operations.length === 48, "Tutorial 001 live plan must contain 48 operations.");

    const precomposeOps = livePlan.operations.filter((operation) =>
      operation.input.command === "layers.precompose");
    requireThat(precomposeOps.length === 2, "Tutorial 001 live plan must precompose both shot layers.");

    result = await runTransaction(livePlan);
    requireThat(result.result?.state === "COMMITTED", "Tutorial 001 native transaction did not commit.");

    const after = await getState();
    const target = findComp(after, COMP);
    requireThat(target !== null, "Tutorial 001 target comp disappeared after commit.");
    const replacementIds = precomposeOps.map((operation) => operation.input.payload.replacementStableId);
    const targetLayerIds = (target.layers ?? []).map((layer) => layer.stableId);
    requireThat(replacementIds.every((id) => targetLayerIds.includes(id)), "Precompose replacement layers are missing.");
    requireThat(!targetLayerIds.includes(LAYER_OUT) && !targetLayerIds.includes(LAYER_IN),
      "Original shot-layer identities survived precompose unexpectedly.");

    if (VISUAL_MODE) {
      await runVisualCapture();
      const editedVisual = JSON.parse(
        await readFile(`${VISUAL_ARTIFACT_ROOT}/edited.json`, "utf8"),
      );
      requireThat(editedVisual.phase === "edited", "Tutorial 001 edited visual phase mismatch.");
      await waitForVisualFiles(editedVisual);
      evidence.visual.edited = editedVisual;
      evidence.visual.assessment = await evaluateSparseVisualProofV1({
        baselineFrames: framesFromSparseCaptureV1(evidence.visual.baseline),
        editedFrames: framesFromSparseCaptureV1(editedVisual),
        anchorMs: TUTORIAL_001_VISUAL_ANCHOR_MS,
        rules: TUTORIAL_001_VISUAL_RULES,
      });
      requireThat(
        evidence.visual.assessment.passed,
        "Tutorial 001 sparse visual assessment failed: "
          + evidence.visual.assessment.issues.join(", "),
      );
    }
    if (MOTION_MODE) {
      await runMotionCapture();
      const motionCapture = JSON.parse(
        await readFile(`${MOTION_ARTIFACT_ROOT}/motion.json`, "utf8"),
      );
      requireThat(motionCapture.phase === "edited", "Tutorial 001 motion capture phase mismatch.");
      requireThat(
        JSON.stringify(motionCapture.timesMs) === JSON.stringify(TUTORIAL_001_MOTION_TIMES_MS),
        "Tutorial 001 motion capture times do not match the declared profile.",
      );
      await waitForVisualFiles(motionCapture);
      evidence.motion.capture = motionCapture;
      evidence.motion.assessment = await evaluateMotionLandmarkProofV1({
        frames: framesFromMotionCaptureV1(motionCapture),
        referenceMarkers: TUTORIAL_001_MOTION_MARKERS.references,
        movingMarker: TUTORIAL_001_MOTION_MARKERS.moving,
        segments: TUTORIAL_001_MOTION_SEGMENTS,
        sourceDurationSeconds: DURATION,
        rules: TUTORIAL_001_MOTION_RULES,
      });
      requireThat(
        evidence.motion.assessment.passed,
        "Tutorial 001 short-motion assessment failed: "
          + evidence.motion.assessment.issues.join(", "),
      );
    }

    evidence.execution = {
      planOperations: livePlan.operations.length,
      requiredCapabilities: livePlan.requiredCapabilities,
      replacementLayerIds: replacementIds,
      resultState: result.result.state,
      appliedOperations: result.result.appliedOperations,
      hostRevisionAfter: after.state.hostRevision,
      targetLayerIds,
    };
  } catch (error) {
    proofError = error;
    evidence.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  } finally {
    const current = await getState();
    const currentIds = stableItemIds(current);
    const generatedPrecomps = livePlan === null ? [] : livePlan.operations
      .filter((operation) => operation.input.command === "layers.precompose")
      .map((operation) => operation.input.payload.stableId);
    const cleanupOrder = [COMP, ...generatedPrecomps, SOURCE_OUT, SOURCE_IN]
      .filter((id, index, all) => all.indexOf(id) === index && currentIds.has(id));
    if (cleanupOrder.length > 0) {
      const cleanup = await runTransaction(cleanupPlan(current.state.observed, cleanupOrder));
      requireThat(cleanup.result?.state === "COMMITTED", "Tutorial 001 cleanup did not commit.");
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
    requireThat(evidence.cleanup.baselineItemCountRestored, "Cleanup did not restore baseline item count.");
    requireThat(evidence.cleanup.baselineStableIdsRestored, "Cleanup did not restore baseline stable-item identities.");
    requireThat(evidence.cleanup.baselineFingerprintRestored, "Cleanup did not restore the baseline project fingerprint.");
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  }

  if (proofError !== null) throw proofError;
  console.log(JSON.stringify({ ok: true, evidence: EVIDENCE, execution: evidence.execution, cleanup: evidence.cleanup }));
};

await main();
