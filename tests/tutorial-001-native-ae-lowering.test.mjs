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
import { AE_ADAPTER_ROUTE_ID_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_7.js";
import { AE_TEMPORAL_EASE_ROUTE_ID_V18 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_8.js";
import { AE_TIME_REMAP_ROUTE_ID_V27 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_7.js";

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

const easeArray = (count) =>
  Array.from({ length: count }, () => ({ speed: 0, influence: 33.333 }));

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
    const easeCount = propertyPath === "TimeRemap.SourceTime" ? 1 : 2;
    return {
      layerId,
      semanticPropertyPath: propertyPath,
      keyframes: operations.map((operation, ordinal) => ({
        timeMs: operation.timeMs,
        value: nativeValueFor(propertyPath, operation, ordinal),
      })),
      easeByKey: operations.map((operation, ordinal) => ({
        keyIndex: ordinal + 1,
        inEase: easeArray(easeCount),
        outEase: easeArray(easeCount),
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
    && operation.input.payload.propertyPath.at(-1) === propertyMatchName);
test("Tutorial 001 lowers to one mixed-protocol native AE execution plan", async () => {
  const compiled = await compiledAt();
  const plan = lower(compiled);

  assert.equal(plan.operations.length, 46);
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

  const routeCounts = new Map();
  for (const operation of plan.operations) {
    routeCounts.set(
      String(operation.routeId),
      (routeCounts.get(String(operation.routeId)) ?? 0) + 1,
    );
  }
  assert.equal(routeCounts.get(AE_ADAPTER_ROUTE_ID_V11), 8);
  assert.equal(routeCounts.get(AE_TIME_REMAP_ROUTE_ID_V27), 2);
  assert.equal(routeCounts.get(AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17), 18);
  assert.equal(routeCounts.get(AE_TEMPORAL_EASE_ROUTE_ID_V18), 18);

  const frozen = validateAndFreezeExecutionPlan(
    plan,
    observedState,
    registryForTutorial001(),
  );
  assert.equal(frozen.topologicalOrder.length, 46);
  assert.ok(String(frozen.plan.planHash).length > 0);

  for (let index = 1; index < plan.operations.length; index += 1) {
    assert.deepEqual(
      plan.operations[index].dependsOn,
      [plan.operations[index - 1].operationId],
    );
  }
  assert.ok(plan.operations.every((operation) =>
    operation.rollbackBoundaryId === plan.rollbackBoundaries[0].id));

  const timeKeys = findSetKeys(plan, "ADBE Time Remapping");
  assert.ok(timeKeys);
  assert.deepEqual(
    timeKeys.input.payload.keyframes.map((keyframe) => keyframe.time),
    [1.55, 2, 2.45],
  );
  assert.deepEqual(
    timeKeys.input.payload.keyframes.map((keyframe) => keyframe.value),
    [0.8, 1.15, 1.45],
  );
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

  assert.throws(
    () => lower(compiled, bindings.slice(1)),
    (error) => {
      assert.ok(error instanceof NativeAeRecipeLoweringError);
      assert.equal(error.code, "NATIVE_BINDING_REQUIRED");
      return true;
    },
  );

  const bad = structuredClone(bindings);
  bad[0].easeByKey[0].outEase = [
    ...bad[0].easeByKey[0].outEase,
    { speed: 0, influence: 33.333 },
  ];
  assert.throws(
    () => lower(compiled, bad),
    (error) => {
      assert.ok(error instanceof NativeAeRecipeLoweringError);
      assert.equal(error.code, "INVALID_NATIVE_EASE");
      return true;
    },
  );
});
