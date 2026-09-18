import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileTutorialDeepLessonV1 } from "../../.tmp/runtime/packages/tutorial-learning/src/index.js";
import {
  compileEditingIrRecipeToVirtualAeV1,
  lowerCompiledRecipeToNativeAePlanV1,
  recipeParameterKeyV1,
} from "../../.tmp/runtime/packages/recipe-compiler/src/index.js";
import { simulateVirtualAeV1 } from "../../.tmp/runtime/packages/virtual-ae/src/index.js";
import { AE_ADAPTER_ROUTE_ID_V11 } from "../../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";

const BASE = process.env.EDITFLOW_SHADOW_CONTROL ?? "http://127.0.0.1:32146";
const FIXTURE = "tests/fixtures/tutorials/head-tracking-stabilization-v1.json";
const EVIDENCE = "proofs/diagnostics/m5-tutorial-002-live-stabilization.json";
const ARTIFACT_ROOT = "proofs/artifacts/tutorial-002-live";
const PREPARE_SCRIPT = resolve("scripts/windows/tutorial-002-live-prepare.jsx");
const READBACK_SCRIPT = resolve("scripts/windows/tutorial-002-live-readback.jsx");
const RESTORE_SCRIPT = resolve("scripts/windows/tutorial-002-live-restore.jsx");
const SOURCE = "M5_MOCHA_SOURCE";
const COMP = "T002_STAB_COMP";
const LAYER = "T002_STAB_LAYER";
const WIDTH = 1080, HEIGHT = 1080, DURATION = 6, FPS = 60;

const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const PNG_IEND = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const waitForCompletePng = async (filePath) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const bytes = await readFile(filePath);
      if (bytes.length > 24 && bytes.subarray(-PNG_IEND.length).equals(PNG_IEND)) {
        return { bytes, info: await stat(filePath) };
      }
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`T002_VISUAL_FRAME_COMPLETION_TIMEOUT ${filePath}`);
};
const jsonRequest = async (requestPath, init = {}, allowError = false) => {
  const response = await fetch(BASE + requestPath, init);
  const text = await response.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok && !allowError) throw new Error(`${requestPath} failed ${response.status}: ${JSON.stringify(body)}`);
  return { status: response.status, body };
};
const getState = async () => (await jsonRequest("/state")).body;
const runTransaction = async (plan, allowError = false) => jsonRequest("/run-transaction", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }),
}, allowError);
const runProofScript = async (scriptPath) => jsonRequest("/proof-script", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scriptPath }),
});
const op = (id, capabilityId, command, payload, dependsOn = [], riskClass = "R2_STRUCTURAL") => ({
  operationId: id, capabilityId, routeId: AE_ADAPTER_ROUTE_ID_V11, dependsOn,
  idempotency: "CHECK_THEN_APPLY", riskClass,
  input: { command, payload, readbackProfile: "TUTORIAL_002_LIVE" },
  rollbackBoundaryId: "ROLLBACK_T002_FIXTURE",
});
const envelope = (planId, observed, requiredCapabilities, operations) => ({
  planId, planRevision: 1, projectRevision: observed.projectRevision,
  projectFingerprint: observed.projectFingerprint, environmentFingerprint: observed.environmentFingerprint,
  creativeObjective: "Bounded Tutorial 002 real-footage reconstruction proof.",
  requiredCapabilities, bindings: [], operations, checkpoints: [],
  invariants: { structural: [], visual: [] },
  rollbackBoundaries: [{ id: "ROLLBACK_T002_FIXTURE", strategy: "RESTORE_SNAPSHOT" }],
});
const setupPlan = (observed) => envelope("tutorial-002-live-setup", observed,
  ["ae.comp.create", "ae.layer.create"], [
    op("T002_SETUP_001", "ae.comp.create", "comp.create", {
      stableId: COMP, name: "EF2_T002_STABILIZE_RECON", width: WIDTH, height: HEIGHT,
      pixelAspect: 1, duration: DURATION, frameRate: FPS,
    }),
    op("T002_SETUP_002", "ae.layer.create", "layer.add_media", {
      stableId: LAYER, comp: { stableId: COMP }, item: { stableId: SOURCE }, duration: DURATION,
    }, ["T002_SETUP_001"]),
  ]);
const cleanupPlan = (observed) => envelope("tutorial-002-live-cleanup", observed,
  ["ae.comp.remove"], [
    op("T002_CLEAN_001", "ae.comp.remove", "comp.remove", { comp: { stableId: COMP } }, [], "R3_DESTRUCTIVE"),
  ]);
const stableIds = (state) => (state.state.project.items ?? [])
  .map((item) => item.stableId).filter(Boolean).sort();
const hasStableId = (state, stableId) => stableIds(state).includes(stableId);
const virtualProject = () => ({
  schema: "editflow.virtual-ae.project.v1", activeCompId: COMP,
  compositions: [{ compId: COMP, name: "Tutorial 002 Stabilization", width: WIDTH, height: HEIGHT,
    durationMs: DURATION * 1000, frameRate: FPS,
    layers: [{ layerId: LAYER, name: "Hero footage", kind: "FOOTAGE", sourceRef: SOURCE,
      inMs: 0, outMs: DURATION * 1000, properties: [], effects: [], masks: [] }],
  }],
});
const compileLivePlan = async (observed) => {
  const packet = JSON.parse(await readFile(FIXTURE, "utf8"));
  const recipe = compileTutorialDeepLessonV1(packet).skills[0].editingIr;
  const parameters = {
    [recipeParameterKeyV1("stabilize-hero-head", "minimumTrackConfidence")]: 0.75,
    [recipeParameterKeyV1("fill-stabilization-edges", "outputWidth")]: 121,
    [recipeParameterKeyV1("fill-stabilization-edges", "outputHeight")]: 117,
    [recipeParameterKeyV1("reframe-locked-subject", "position")]: [WIDTH / 2, HEIGHT * 0.48],
    [recipeParameterKeyV1("reframe-locked-subject", "scale")]: [112, 112],
    [recipeParameterKeyV1("smooth-residual-locked-motion", "motionBlurEnabled")]: true,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "frameBlendingType")]: "FRAME_MIX",
    [recipeParameterKeyV1("smooth-residual-locked-motion", "compMotionBlurEnabled")]: true,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "compFrameBlendingEnabled")]: true,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "shutterAngle")]: 180,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "shutterPhase")]: -90,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "samplesPerFrame")]: 16,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "adaptiveSampleLimit")]: 128,
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(recipe, virtualProject(), {
    compId: COMP, eventTimesMs: {}, roleBindings: [{ role: "hero_shot", layerIds: [LAYER] }],
    parameterValues: parameters,
  });
  const simulation = simulateVirtualAeV1(virtualProject(), compiled.operations);
  requireThat(simulation.valid, "Tutorial 002 Virtual AE simulation failed.");
  return lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "tutorial-002-live-native-plan", observedState: observed,
    creativeObjective: "Reconstruct subject-locked stabilization from Tutorial 002 on real footage.",
    recipeRefs: ["skill.subject-locked-stabilization"],
  });
};
const main = async () => {
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  let before = await getState();
  requireThat(hasStableId(before, SOURCE), `Required real source ${SOURCE} is unavailable.`);
  let preflightRecovery = null;
  if (hasStableId(before, COMP)) {
    const dirtyFingerprint = before.state.observed.projectFingerprint;
    const recovery = await runTransaction(cleanupPlan(before.state.observed), true);
    requireThat(recovery.status === 200 && recovery.body?.result?.state === "COMMITTED",
      `Tutorial 002 owned-fixture preflight cleanup failed: ${JSON.stringify(recovery.body)}`);
    await runProofScript(RESTORE_SCRIPT);
    const restored = JSON.parse(await readFile(`${ARTIFACT_ROOT}/restore.json`, "utf8"));
    requireThat(restored.ok === true,
      `Tutorial 002 retained active-item restore failed during preflight recovery: ${restored.failure ?? "unknown"}`);
    before = await getState();
    requireThat(!hasStableId(before, COMP),
      `Tutorial 002 owned fixture ${COMP} survived preflight recovery.`);
    requireThat(hasStableId(before, SOURCE), `Required real source ${SOURCE} disappeared during preflight recovery.`);
    preflightRecovery = {
      performed: true,
      dirtyFingerprint,
      cleanupHttpStatus: recovery.status,
      cleanupState: recovery.body?.result?.state ?? null,
      recoveredFingerprint: before.state.observed.projectFingerprint,
      restoredActiveItemHostId: restored.activeItemHostId ?? null,
    };
  }
  const baselineIds = stableIds(before);
  await writeFile(`${ARTIFACT_ROOT}/original.json`, JSON.stringify({
    activeItemHostId: before.state.project.activeItemHostId ?? null,
    activeItemStableId: before.state.project.items.find((item) => item.hostId === before.state.project.activeItemHostId)?.stableId ?? null,
  }, null, 2) + "\n", "utf8");
  const evidence = {
    proof: "M5_TUTORIAL_002_LIVE_STABILIZATION_V1",
    sourceCommit: process.env.EDITFLOW_SOURCE_COMMIT ?? null,
    startedAt: new Date().toISOString(),
    before: { hostRevision: before.state.hostRevision, projectFingerprint: before.state.observed.projectFingerprint,
      itemCount: before.state.project.itemCount, stableIds: baselineIds },
    preflightRecovery,
  };
  let setupCommitted = false, proofError = null, livePlan = null;
  try {
    const setup = await runTransaction(setupPlan(before.state.observed));
    requireThat(setup.body.result?.state === "COMMITTED", "Tutorial 002 fixture setup did not commit.");
    setupCommitted = true;
    await runProofScript(PREPARE_SCRIPT);
    const prepared = JSON.parse(await readFile(`${ARTIFACT_ROOT}/prepare.json`, "utf8"));
    requireThat(prepared.ok === true, `Tutorial 002 visual preparation failed: ${prepared.failure ?? "unknown"}`);
    const afterSetup = await getState();
    livePlan = await compileLivePlan(afterSetup.state.observed);
    requireThat(livePlan.operations.length === 9, `Expected 9 recipe operations, got ${livePlan.operations.length}.`);
    requireThat(livePlan.operations[0]?.input?.command === "stabilization.position.guarded_visual",
      "Guarded stabilization is not the first Tutorial 002 native operation.");
    const execution = await runTransaction(livePlan, true);
    evidence.execution = {
      httpStatus: execution.status, state: execution.body?.result?.state ?? null,
      appliedOperations: execution.body?.result?.appliedOperations ?? null,
      committedGroups: execution.body?.result?.committedGroups ?? null,
      error: execution.body?.result?.error ?? execution.body?.error ?? null,
      responseBody: execution.body,
      requiredCapabilities: livePlan.requiredCapabilities,
    };
    requireThat(execution.status === 200 && execution.body?.result?.state === "COMMITTED",
      `Tutorial 002 live transaction failed: ${JSON.stringify(evidence.execution)}`);
    await runProofScript(READBACK_SCRIPT);
    const readback = JSON.parse(await readFile(`${ARTIFACT_ROOT}/readback.json`, "utf8"));
    evidence.readback = readback;
    requireThat(readback.ok === true, `Tutorial 002 protocol-2.3/tail readback failed: ${readback.failure ?? "structural assertion"}`);
    const completedFrame = await waitForCompletePng(readback.finalFrame);
    const frameWidth = completedFrame.bytes.readUInt32BE(16);
    const frameHeight = completedFrame.bytes.readUInt32BE(20);
    requireThat(frameWidth === WIDTH && frameHeight === HEIGHT,
      `Tutorial 002 final frame geometry mismatch: ${frameWidth}x${frameHeight}.`);
    evidence.finalFrame = {
      path: readback.finalFrame, bytes: completedFrame.info.size,
      width: frameWidth, height: frameHeight,
    };
  } catch (error) {
    proofError = error;
    evidence.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  } finally {
    if (setupCommitted) {
      const current = await getState();
      if (hasStableId(current, COMP)) {
        const cleanup = await runTransaction(cleanupPlan(current.state.observed), true);
        evidence.cleanupTransaction = { httpStatus: cleanup.status, state: cleanup.body?.result?.state ?? null,
          error: cleanup.body?.result?.error ?? null };
      }
    }
    await runProofScript(RESTORE_SCRIPT).catch(() => null);
    const final = await getState();
    evidence.finishedAt = new Date().toISOString();
    evidence.cleanup = {
      hostRevision: final.state.hostRevision, projectFingerprint: final.state.observed.projectFingerprint,
      itemCount: final.state.project.itemCount, stableIds: stableIds(final),
      baselineFingerprintRestored: final.state.observed.projectFingerprint === before.state.observed.projectFingerprint,
      baselineItemCountRestored: final.state.project.itemCount === before.state.project.itemCount,
      baselineStableIdsRestored: JSON.stringify(stableIds(final)) === JSON.stringify(baselineIds),
      tempCompRemoved: !hasStableId(final, COMP),
    };
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n", "utf8");
    requireThat(evidence.cleanup.baselineFingerprintRestored, "Tutorial 002 cleanup fingerprint mismatch.");
    requireThat(evidence.cleanup.baselineItemCountRestored, "Tutorial 002 cleanup item-count mismatch.");
    requireThat(evidence.cleanup.baselineStableIdsRestored, "Tutorial 002 cleanup stable-ID mismatch.");
    requireThat(evidence.cleanup.tempCompRemoved, "Tutorial 002 temporary comp survived cleanup.");
  }
  if (proofError) throw proofError;
  console.log(JSON.stringify({ ok: true, evidence: EVIDENCE, execution: evidence.execution,
    readback: evidence.readback?.structural ?? null, cleanup: evidence.cleanup }));
};
await main();
