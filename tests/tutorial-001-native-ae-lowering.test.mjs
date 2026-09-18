import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  compileTutorialDeepLessonV1,
} from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import {
  NativeAeRecipeLoweringError,
  compileEditingIrRecipeToVirtualAeV1,
  lowerCompiledRecipeToNativeAePlanV1,
  recipeParameterKeyV1,
} from "../.tmp/runtime/packages/recipe-compiler/src/index.js";
import { CapabilityRegistry } from "../.tmp/runtime/packages/capability-registry/src/index.js";
import { validateAndFreezeExecutionPlan } from "../.tmp/runtime/packages/planner/src/index.js";
import { AE_CEP_PUBLIC_CAPABILITIES_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { applyM2AcceptedProofEvidence } from "../.tmp/runtime/packages/adapters/ae-cep/src/m2-proof-maturity.js";
import { M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import { M3_TEMPORAL_EASE_CAPABILITIES_V18 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-temporal-ease.js";
import { M5_TIME_REMAP_CAPABILITIES_V27 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-time-remap.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  AE_ADAPTER_ROUTE_ID_V11,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_7.js";
import { AE_TEMPORAL_EASE_ROUTE_ID_V18 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_8.js";
import { AE_TIME_REMAP_ROUTE_ID_V27 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_7.js";
import {
  AeCepCurrentTransactionalHostV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/current-transactional-host.js";
import {
  CurrentAeTransactionRuntimeV1,
} from "../.tmp/runtime/apps/desktop-host/src/current-ae-transaction-runtime.js";

const fixturePath = "tests/fixtures/tutorials/smooth-zoom-reverse-v1.json";

const loadRecipe = async () => {
  const packet = JSON.parse(await readFile(fixturePath, "utf8"));
  return compileTutorialDeepLessonV1(packet).skills[0].editingIr;
};
const project = () => ({
  schema: "editflow.virtual-ae.project.v1",
  activeCompId: "comp.transition",
  compositions: [{
    compId: "comp.transition",
    name: "Tutorial 001 Transition",
    width: 1080,
    height: 1920,
    durationMs: 5000,
    frameRate: 60,
    layers: [{
      layerId: "layer.outgoing",
      name: "Outgoing",
      kind: "FOOTAGE",
      sourceRef: "source:outgoing",
      inMs: 0,
      outMs: 3000,
      properties: [],
      effects: [],
      masks: [],
    }, {
      layerId: "layer.incoming",
      name: "Incoming",
      kind: "FOOTAGE",
      sourceRef: "source:incoming",
      inMs: 1000,
      outMs: 4000,
      properties: [],
      effects: [],
      masks: [],
    }],
  }],
});
const context = (anchorMs = 2000) => ({
  compId: "comp.transition",
  eventTimesMs: { "transition-anchor": anchorMs },
  roleBindings: [{
    role: "transition.outgoing_shot",
    layerIds: ["layer.outgoing"],
  }, {
    role: "transition.incoming_shot",
    layerIds: ["layer.incoming"],
  }],
  parameterValues: {
    [recipeParameterKeyV1(
      "shape-temporal-velocity-pulse",
      "velocityPulseDuration",
    )]: 0.3,
    [recipeParameterKeyV1(
      "shape-temporal-velocity-pulse",
      "velocityContrast",
    )]: 0.4,
    [recipeParameterKeyV1(
      "shape-temporal-velocity-pulse",
      "temporalPeakPhase",
    )]: 0.5,
    [recipeParameterKeyV1(
      "couple-zoom-pulse",
      "zoomPulseDuration",
    )]: 0.25,
    [recipeParameterKeyV1(
      "couple-zoom-pulse",
      "zoomIntensity",
    )]: 0.3,
    [recipeParameterKeyV1(
      "couple-zoom-pulse",
      "zoomCenter",
    )]: [0.62, 0.44],
    [recipeParameterKeyV1(
      "couple-zoom-pulse",
      "zoomTemporalPhase",
    )]: 0.5,
  },
});

const observedState = {
  projectId: "tutorial-001-project",
  projectRevision: "ae-revision:352",
  projectFingerprint: "project:sha256:tutorial-001",
  environmentFingerprint: "environment:sha256:ae-25.6.6",
};

const registryForTutorial001 = () => {
  const registry = new CapabilityRegistry(
    observedState.environmentFingerprint,
    "2026-09-18T03:35:00.000Z",
  );
  registry.registerStatic([
    ...applyM2AcceptedProofEvidence(AE_CEP_PUBLIC_CAPABILITIES_V11),
    ...M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
    ...M3_TEMPORAL_EASE_CAPABILITIES_V18,
    ...M5_TIME_REMAP_CAPABILITIES_V27,
  ]);
  return registry;
};

const integrationResponseFor = (request, overrides = {}) => ({
  protocolVersion: request.protocolVersion,
  requestId: request.requestId,
  transactionId: request.transactionId,
  operationId: request.operationId,
  capabilityId: request.capabilityId,
  command: request.command,
  outcome: "NO_OP",
  error: null,
  affectedObjects: [],
  readback: null,
  projectSnapshot: null,
  environmentProbe: null,
  hostProjectRevision: null,
  diagnostics: {
    adapterProtocolVersion: request.protocolVersion,
    adapterBuild: "tutorial-001-mixed-runtime",
    command: request.command,
    notes: [],
  },
  proofArtifactRefs: [],
  ...overrides,
});

class Tutorial001MixedTransport {
  constructor() {
    this.requests = [];
    this.hostRevision = 500;
    this.mutationCount = 0;
    this.project = {
      hostRevision: this.hostRevision,
      filePath: "C:/EditFlow/tutorial-001-offline-runtime.aep",
      activeItemHostId: null,
      itemCount: 0,
      items: [],
    };
  }

  easeCardinality(request) {
    const propertyPath = request.payload.propertyPath;
    const leaf = Array.isArray(propertyPath) ? propertyPath.at(-1) : null;
    if (leaf === "ADBE Scale") return 3;
    if (leaf === "ADBE Position") return 2;
    return 1;
  }

  async dispatch(request) {
    this.requests.push(structuredClone(request));
    if (request.command === "host.probe") {
      return integrationResponseFor(request, {
        environmentProbe: {
          adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
          adapterBuild: "tutorial-001-mixed-runtime",
          hostName: "Adobe After Effects",
          hostVersion: "25.6.6",
          hostBuild: "4",
          os: "Windows test",
          projectOpen: true,
        },
        hostProjectRevision: this.hostRevision,
      });
    }
    if (request.command === "project.inspect") {
      this.project.hostRevision = this.hostRevision;
      return integrationResponseFor(request, {
        projectSnapshot: structuredClone(this.project),
        hostProjectRevision: this.hostRevision,
      });
    }
    if (request.command === "property.temporal_ease.readback") {
      return integrationResponseFor(request, {
        outcome: "NO_OP",
        readback: {
          temporalEase: {
            property: { easeCardinality: this.easeCardinality(request) },
            keyIndex: request.payload.keyIndex,
          },
        },
        hostProjectRevision: this.hostRevision,
      });
    }
    if (
      request.expectedHostProjectRevision !== null
      && request.expectedHostProjectRevision !== undefined
      && request.expectedHostProjectRevision !== this.hostRevision
    ) {
      return integrationResponseFor(request, {
        outcome: "REJECTED",
        error: {
          code: "HOST_REVISION_MISMATCH",
          message: "stale revision",
        },
        hostProjectRevision: this.hostRevision,
      });
    }

    this.mutationCount += 1;
    this.hostRevision += 1;
    this.project.hostRevision = this.hostRevision;
    return integrationResponseFor(request, {
      outcome: "APPLIED",
      hostProjectRevision: this.hostRevision,
    });
  }
}

const compiledAt = async (anchorMs = 2000) => {
  const recipe = await loadRecipe();
  return compileEditingIrRecipeToVirtualAeV1(recipe, project(), context(anchorMs));
};

const supportedCurvePaths = new Set([
  "TimeRemap.SourceTime",
  "Transform.CameraPush.Scale",
  "Transform.CameraPush.Center",
]);
const nativeValueFor = (path, operation, ordinal) => {
  if (path === "TimeRemap.SourceTime") {
    return [0.8, 1.15, 1.45][ordinal];
  }
  if (path === "Transform.CameraPush.Scale") {
    const intensity = operation.value.parameters.zoomIntensity;
    const peak = 100 * (1 + intensity);
    return operation.value.phase === "PEAK"
      ? [peak, peak]
      : [100, 100];
  }
  const center = operation.value.parameters.zoomCenter;
  return operation.value.phase === "PEAK"
    ? [center[0] * 1080, center[1] * 1920]
    : [540, 960];
};

const easeHandleIntent = () => ({ speed: 0, influence: 33.333 });

const curveBindingsFor = (compiled) => {
  const groups = new Map();
  for (const operation of compiled.operations) {
    if (operation.type !== "ADD_KEYFRAME") continue;
    if (!supportedCurvePaths.has(operation.propertyPath)) continue;
    const key = operation.layerId + "\u0000" + operation.propertyPath;
    const existing = groups.get(key) ?? [];
    existing.push(operation);
    groups.set(key, existing);
  }
  return [...groups.values()].map((operations) => {
    const { layerId, propertyPath } = operations[0];
    return {
      layerId,
      semanticPropertyPath: propertyPath,
      keyframes: operations.map((operation, ordinal) => ({
        timeMs: operation.timeMs,
        value: nativeValueFor(propertyPath, operation, ordinal),
      })),
      easeIntentByKey: operations.map((operation, ordinal) => ({
        keyIndex: ordinal + 1,
        inEase: easeHandleIntent(),
        outEase: easeHandleIntent(),
      })),
    };
  });
};

const lower = (compiled, curveBindings = curveBindingsFor(compiled)) =>
  lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "tutorial-001-native-plan",
    observedState,
    curveBindings,
    creativeObjective: "Reconstruct Tutorial 001 with native AE primitives.",
    recipeRefs: ["skill.velocity-zoom-transition"],
  });

const findSetKeys = (plan, propertyMatchName) =>
  plan.operations.find((operation) =>
    operation.input.command === "property.set_keyframes"
    && Array.isArray(operation.input.payload.keyframes)
    && operation.input.payload.propertyPath.at(-1) === propertyMatchName);
test("Tutorial 001 lowers to one mixed-protocol native AE execution plan", async () => {
  const compiled = await compiledAt();
  const plan = lower(compiled);

  assert.equal(plan.operations.length, 48);
  assert.deepEqual([...plan.requiredCapabilities].sort(), [
    "ae.keyframe.set",
    "ae.layer.time_remap.enable",
    "ae.precompose.layers",
    "ae.property.temporal_ease.set",
    "ae.property.temporal_interpolation.set",
  ]);
  assert.deepEqual(
    plan.operations.slice(0, 2).map((operation) => operation.input.command),
    ["layers.precompose", "layers.precompose"],
  );

  const replacementLayerIds = plan.operations
    .slice(0, 2)
    .map((operation) => operation.input.payload.replacementStableId);
  assert.equal(new Set(replacementLayerIds).size, 2);
  assert.ok(replacementLayerIds.every((layerId) => typeof layerId === "string"));

  const postPrecomposeLayerIds = plan.operations
    .slice(2)
    .map((operation) => operation.input.payload.layer?.stableId)
    .filter((layerId) => typeof layerId === "string");
  assert.ok(postPrecomposeLayerIds.length > 0);
  assert.ok(postPrecomposeLayerIds.every((layerId) =>
    replacementLayerIds.includes(layerId)));
  assert.ok(!postPrecomposeLayerIds.includes("layer.outgoing"));
  assert.ok(!postPrecomposeLayerIds.includes("layer.incoming"));

  const routeCounts = new Map();
  for (const operation of plan.operations) {
    routeCounts.set(
      String(operation.routeId),
      (routeCounts.get(String(operation.routeId)) ?? 0) + 1,
    );
  }
  assert.equal(routeCounts.get(AE_ADAPTER_ROUTE_ID_V11), 10);
  assert.equal(routeCounts.get(AE_TIME_REMAP_ROUTE_ID_V27), 2);
  assert.equal(routeCounts.get(AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17), 18);
  assert.equal(routeCounts.get(AE_TEMPORAL_EASE_ROUTE_ID_V18), 18);

  const easeOperations = plan.operations.filter((operation) =>
    operation.input.command === "property.temporal_ease.set");
  assert.equal(easeOperations.length, 18);
  assert.ok(easeOperations.every((operation) =>
    operation.input.payload.ease === undefined
    && operation.input.payload.easeIntent !== undefined));
  const easeCardinalityTargets = new Set(easeOperations.map((operation) =>
    JSON.stringify([
      operation.input.payload.comp,
      operation.input.payload.layer,
      operation.input.payload.propertyPath,
    ])));
  assert.equal(easeCardinalityTargets.size, 6);
  assert.equal(plan.operations.length + easeCardinalityTargets.size, 54);

  const frozen = validateAndFreezeExecutionPlan(
    plan,
    observedState,
    registryForTutorial001(),
  );
  assert.equal(frozen.topologicalOrder.length, 48);
  assert.ok(String(frozen.plan.planHash).length > 0);

  for (let index = 1; index < plan.operations.length; index += 1) {
    assert.deepEqual(
      plan.operations[index].dependsOn,
      [plan.operations[index - 1].operationId],
    );
  }
  assert.ok(plan.operations.every((operation) =>
    operation.rollbackBoundaryId === plan.rollbackBoundaries[0].id));

  const timeResetOperations = plan.operations.filter((operation) =>
    operation.input.command === "property.set_keyframes"
    && operation.input.payload.propertyPath?.at(-1) === "ADBE Time Remapping"
    && Array.isArray(operation.input.payload.removeKeyIndices));
  assert.equal(timeResetOperations.length, 2);
  assert.ok(timeResetOperations.every((operation) =>
    JSON.stringify(operation.input.payload.removeKeyIndices) === "[5,1]"));

  const timeKeys = findSetKeys(plan, "ADBE Time Remapping");
  assert.ok(timeKeys);
  const firstTimeResetIndex = plan.operations.indexOf(timeResetOperations[0]);
  const firstTimeSetIndex = plan.operations.indexOf(timeKeys);
  const firstTimeEnableIndex = plan.operations.findIndex((operation) =>
    operation.input.command === "layer.time_remap.enable");
  const firstTimeInterpolationIndex = plan.operations.findIndex((operation) =>
    operation.input.command === "property.temporal_interpolation.set"
    && operation.input.payload.propertyPath?.at(-1) === "ADBE Time Remapping");
  assert.ok(firstTimeEnableIndex >= 0);
  assert.ok(firstTimeSetIndex > firstTimeEnableIndex);
  assert.ok(firstTimeResetIndex > firstTimeSetIndex);
  assert.ok(firstTimeInterpolationIndex > firstTimeResetIndex);
  assert.deepEqual(
    timeKeys.input.payload.keyframes.map((keyframe) => keyframe.time),
    [1.55, 2, 2.45],
  );
  assert.deepEqual(
    timeKeys.input.payload.keyframes.map((keyframe) => keyframe.value),
    [0.8, 1.15, 1.45],
  );
});

test("Tutorial 001 executes end-to-end through the current mixed-protocol runtime", async () => {
  const transport = new Tutorial001MixedTransport();
  const projectId = "tutorial-001-runtime-project";
  let observerRequest = 0;
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    projectId,
    "tutorial-001-observe",
    () => `tutorial-001-observe-${++observerRequest}`,
  );
  const liveObserved = await observer.readState();
  const compiled = await compiledAt();
  const plan = lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "tutorial-001-runtime-plan",
    observedState: liveObserved,
    curveBindings: curveBindingsFor(compiled),
    recipeRefs: ["skill.velocity-zoom-transition"],
  });

  const beforeRuntimeRequests = transport.requests.length;
  const runtime = new CurrentAeTransactionRuntimeV1(
    transport,
    projectId,
    64,
  );
  const result = await runtime.execute(plan);
  const runtimeRequests = transport.requests.slice(beforeRuntimeRequests);

  assert.equal(result.state, "COMMITTED");
  assert.equal(result.recovered, false);
  assert.equal(result.appliedOperations, 48);
  assert.equal(transport.mutationCount, 48);
  assert.equal(runtimeRequests.length, 64);
  assert.equal(runtimeRequests.filter((request) =>
    request.command === "host.probe").length, 5);
  assert.equal(runtimeRequests.filter((request) =>
    request.command === "project.inspect").length, 5);

  const easeReadbacks = runtimeRequests.filter((request) =>
    request.command === "property.temporal_ease.readback");
  const easeSets = runtimeRequests.filter((request) =>
    request.command === "property.temporal_ease.set");
  assert.equal(easeReadbacks.length, 6);
  assert.equal(easeSets.length, 18);

  for (const request of easeSets) {
    const leaf = request.payload.propertyPath.at(-1);
    const expectedCardinality = leaf === "ADBE Scale"
      ? 3
      : leaf === "ADBE Position"
        ? 2
        : 1;
    assert.equal(request.payload.ease.inEase.length, expectedCardinality);
    assert.equal(request.payload.ease.outEase.length, expectedCardinality);
    assert.equal(request.payload.easeIntent, undefined);
  }
});

test("native lowering preserves semantic timing adaptation", async () => {
  const baseline = lower(await compiledAt(2000));
  const shifted = lower(await compiledAt(2200));
  const baselineKeys = findSetKeys(baseline, "ADBE Time Remapping");
  const shiftedKeys = findSetKeys(shifted, "ADBE Time Remapping");

  assert.equal(baselineKeys.input.payload.keyframes[1].time, 2);
  assert.equal(shiftedKeys.input.payload.keyframes[1].time, 2.2);
  assert.notDeepEqual(
    baselineKeys.input.payload.keyframes.map((keyframe) => keyframe.time),
    shiftedKeys.input.payload.keyframes.map((keyframe) => keyframe.time),
  );
});
test("native lowering fails closed on missing or stale native adaptation evidence", async () => {
  const compiled = await compiledAt();
  const bindings = curveBindingsFor(compiled);

  const unsafeTimeRemap = structuredClone(compiled);
  unsafeTimeRemap.operations = unsafeTimeRemap.operations.filter((operation) =>
    operation.type !== "PRECOMPOSE");
  assert.throws(
    () => lowerCompiledRecipeToNativeAePlanV1(unsafeTimeRemap, {
      planId: "tutorial-001-unsafe-time-remap",
      observedState,
      curveBindings: bindings,
    }),
    (error) => {
      assert.ok(error instanceof NativeAeRecipeLoweringError);
      assert.equal(error.code, "UNSAFE_TIME_REMAP_KEY_RESET");
      return true;
    },
  );

  assert.throws(
    () => lower(compiled, bindings.slice(1)),
    (error) => {
      assert.ok(error instanceof NativeAeRecipeLoweringError);
      assert.equal(error.code, "NATIVE_BINDING_REQUIRED");
      return true;
    },
  );

  const bad = structuredClone(bindings);
  bad[0].easeIntentByKey[0].outEase.influence = 0;
  assert.throws(
    () => lower(compiled, bad),
    (error) => {
      assert.ok(error instanceof NativeAeRecipeLoweringError);
      assert.equal(error.code, "INVALID_NATIVE_EASE");
      return true;
    },
  );
});
