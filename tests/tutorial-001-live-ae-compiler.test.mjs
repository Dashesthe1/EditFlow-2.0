import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  RecipeLiveCompileError,
  compileEditingIrRecipeToVirtualAeV1,
  compileVirtualAeRecipeToLiveAeV1,
  materializeCameraPushV1,
  materializeTimeRemapPulseV1,
  recipeParameterKeyV1,
} from "../.tmp/runtime/packages/recipe-compiler/src/index.js";
import {
  compileTutorialDeepLessonV1,
} from "../.tmp/runtime/packages/tutorial-learning/src/index.js";

const fixturePath = "tests/fixtures/tutorials/smooth-zoom-reverse-v1.json";

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
    layers: [{      layerId: "layer.outgoing",
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

const context = {
  compId: "comp.transition",
  eventTimesMs: { "transition-anchor": 2000 },
  roleBindings: [{
    role: "transition.outgoing_shot",
    layerIds: ["layer.outgoing"],
  }, {    role: "transition.incoming_shot",
    layerIds: ["layer.incoming"],
  }],
  parameterValues: {
    [recipeParameterKeyV1("shape-temporal-velocity-pulse", "velocityPulseDuration")]: 0.3,
    [recipeParameterKeyV1("shape-temporal-velocity-pulse", "velocityContrast")]: 0.4,
    [recipeParameterKeyV1("shape-temporal-velocity-pulse", "temporalPeakPhase")]: 0.5,
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomPulseDuration")]: 0.25,
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomIntensity")]: 0.3,
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomCenter")]: [0.62, 0.44],
    [recipeParameterKeyV1("couple-zoom-pulse", "zoomTemporalPhase")]: 0.5,
  },
};

const compiled = async () => {
  const packet = JSON.parse(await readFile(fixturePath, "utf8"));
  const lesson = compileTutorialDeepLessonV1(packet);
  const recipe = lesson.skills[0].editingIr;
  return compileEditingIrRecipeToVirtualAeV1(recipe, project(), context);
};

test("Tutorial 001 lowers its proven semantic recipe into reusable live-AE actions", async () => {
  const live = compileVirtualAeRecipeToLiveAeV1(await compiled(), project());
  assert.equal(live.schema, "editflow.recipe-compiler.live-ae.v1");
  assert.equal(live.actions.length, 8);
  assert.deepEqual(
    live.actions.map((action) => action.type),
    [      "PRECOMPOSE",
      "PRECOMPOSE",
      "TIME_REMAP_ENABLE",
      "TIME_REMAP_ENABLE",
      "TIME_REMAP_PULSE",
      "TIME_REMAP_PULSE",
      "CAMERA_PUSH",
      "CAMERA_PUSH",
    ],
  );

  const pulses = live.actions.filter((action) => action.type === "TIME_REMAP_PULSE");
  assert.equal(pulses.length, 2);
  assert.ok(pulses.every((action) => action.keyTimesSeconds[1] === 2));
  assert.ok(pulses.every((action) => action.velocityContrast === 0.4));
  assert.ok(pulses.every((action) => action.temporalPeakPhase === 0.5));

  const pushes = live.actions.filter((action) => action.type === "CAMERA_PUSH");
  assert.equal(pushes.length, 2);
  assert.ok(pushes.every((action) => action.zoomIntensity === 0.3));
  assert.ok(pushes.every((action) =>
    action.zoomCenter[0] === 0.62 && action.zoomCenter[1] === 0.44));
  assert.ok(pushes.every((action) =>
    action.compWidth === 1080 && action.compHeight === 1920));
});

test("live lowering targets deterministic precompose replacement identities", async () => {
  const live = compileVirtualAeRecipeToLiveAeV1(await compiled(), project());
  const replacements = live.actions
    .filter((action) => action.type === "PRECOMPOSE")
    .map((action) => action.replacementLayerStableId);
  assert.equal(replacements.length, 2);  for (const action of live.actions.filter((candidate) =>
    candidate.type === "TIME_REMAP_ENABLE"
    || candidate.type === "TIME_REMAP_PULSE"
    || candidate.type === "CAMERA_PUSH")) {
    assert.ok(
      replacements.includes(action.layerStableId),
      "post-precompose actions must target the replacement layer identity",
    );
  }
});

test("live lowering fails closed when Virtual AE contains an unowned operation", async () => {
  const virtual = await compiled();
  const unsafe = {
    ...virtual,
    operations: [...virtual.operations, {
      type: "SET_PROPERTY",
      compId: "comp.transition",
      layerId: virtual.nodeTargetLayerIds["couple-zoom-pulse"][0],
      propertyPath: "Unknown.Arbitrary.Path",
      value: { nodeId: "unknown", phase: "UNKNOWN", parameters: {} },
    }],
  };

  assert.throws(
    () => compileVirtualAeRecipeToLiveAeV1(unsafe, project()),
    (error) => {
      assert.ok(error instanceof RecipeLiveCompileError);
      assert.ok(error.issues.some((issue) => issue.code === "LIVE_OPERATION_UNSUPPORTED"));
      return true;
    },
  );
});

test("Time Remap pulse materialization derives a monotonic velocity contrast from native keys", async () => {
  const live = compileVirtualAeRecipeToLiveAeV1(await compiled(), project());
  const action = live.actions.find((candidate) => candidate.type === "TIME_REMAP_PULSE");
  assert.ok(action);
  const materialized = materializeTimeRemapPulseV1(action, {
    timeRemapEnabled: true,
    propertyAvailable: true,
    keys: [
      { index: 1, time: 0, value: 0 },
      { index: 2, time: 3, value: 3 },
    ],
  });

  assert.deepEqual(materialized.propertyPath, ["ADBE Time Remapping"]);
  assert.equal(materialized.keyframes.length, 3);
  assert.ok(materialized.keyframes[0].value < materialized.keyframes[1].value);
  assert.ok(materialized.keyframes[1].value < materialized.keyframes[2].value);
  assert.ok(
    materialized.keyframes[1].value > materialized.keyframes[1].time,
    "positive velocity contrast should advance source time at the peak",
  );
  assert.ok(materialized.curve[1].ease.inEase[0].influence
    > materialized.curve[0].ease.inEase[0].influence);
});

test("Time Remap materialization preserves authored curves by failing closed", async () => {
  const live = compileVirtualAeRecipeToLiveAeV1(await compiled(), project());
  const action = live.actions.find((candidate) => candidate.type === "TIME_REMAP_PULSE");
  assert.ok(action);

  assert.throws(
    () => materializeTimeRemapPulseV1(action, {
      timeRemapEnabled: true,
      propertyAvailable: true,
      keys: [
        { index: 1, time: 0, value: 0 },
        { index: 2, time: 1.5, value: 1.2 },
        { index: 3, time: 3, value: 3 },
      ],
    }),
    (error) => {
      assert.ok(error instanceof RecipeLiveCompileError);
      assert.ok(error.issues.some((issue) =>
        issue.code === "PREAUTHORED_TIME_REMAP_REQUIRES_POLICY"));
      return true;
    },
  );
});

test("camera push materialization derives native scale and subject-aware position compensation", async () => {
  const live = compileVirtualAeRecipeToLiveAeV1(await compiled(), project());
  const action = live.actions.find((candidate) => candidate.type === "CAMERA_PUSH");
  assert.ok(action);
  const materialized = materializeCameraPushV1(action, {
    anchorPoint: [540, 960, 0],
    position: [540, 960, 0],
    scale: [100, 100, 100],
  });

  assert.deepEqual(materialized.scaleKeyframes[0].value, [100, 100, 100]);
  assert.deepEqual(materialized.scaleKeyframes[1].value, [130, 130, 130]);
  assert.deepEqual(materialized.scaleKeyframes[2].value, [100, 100, 100]);
  assert.ok(Math.abs(materialized.positionKeyframes[1].value[0] - 501.12) < 1e-9);
  assert.ok(Math.abs(materialized.positionKeyframes[1].value[1] - 994.56) < 1e-9);
  assert.equal(materialized.positionKeyframes[1].value[2], 0);
});
