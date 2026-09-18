import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  compileTutorialDeepLessonV1,
} from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import {
  simulateVirtualAeV1,
} from "../.tmp/runtime/packages/virtual-ae/src/index.js";
import {
  RecipeCompileError,
  compileEditingIrRecipeToVirtualAeV1,
  recipeParameterKeyV1,
} from "../.tmp/runtime/packages/recipe-compiler/src/index.js";

const fixturePath =
  "tests/fixtures/tutorials/smooth-zoom-reverse-v1.json";

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
const context = (overrides = {}) => ({
  compId: "comp.transition",
  eventTimesMs: { "transition-anchor": 2000 },
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
    ...(overrides.parameterValues ?? {}),
  },
  ...(overrides.eventTimesMs
    ? { eventTimesMs: overrides.eventTimesMs }
    : {}),
});

const property = (layer, path) =>
  layer.properties.find((candidate) => candidate.path === path);
test("Tutorial 001 compiles into a valid Virtual AE transition structure", async () => {
  const recipe = await loadRecipe();
  const compiled = compileEditingIrRecipeToVirtualAeV1(
    recipe,
    project(),
    context(),
  );

  assert.equal(
    compiled.operations.filter((operation) => operation.type === "PRECOMPOSE").length,
    2,
  );
  assert.deepEqual(compiled.skippedOptionalNodeIds, []);

  const simulation = simulateVirtualAeV1(project(), compiled.operations);
  assert.equal(simulation.valid, true, simulation.errors.join("\n"));

  const comp = simulation.project.compositions.find(
    (candidate) => candidate.compId === "comp.transition",
  );
  assert.ok(comp);
  assert.equal(comp.layers.length, 2);
  assert.ok(comp.layers.every((layer) => layer.kind === "PRECOMP"));

  for (const layer of comp.layers) {
    assert.ok(property(layer, "TimeRemap.Enabled"));
    assert.equal(
      property(layer, "TimeRemap.SourceTime")?.keyframes.length,
      3,
    );
    assert.equal(
      property(layer, "Transform.CameraPush.Scale")?.keyframes.length,
      3,
    );
    assert.equal(
      property(layer, "Transform.CameraPush.Center")?.keyframes.length,
      3,
    );
    assert.equal(
      property(layer, "TimeRemap.SourceTime")?.keyframes[1]?.timeMs,
      2000,
    );
    assert.equal(
      property(layer, "Transform.CameraPush.Scale")?.keyframes[1]?.timeMs,
      2000,
    );
  }
});

test("Tutorial 001 timing adapts to the bound event instead of fixed tutorial frames", async () => {
  const recipe = await loadRecipe();
  const baseline = compileEditingIrRecipeToVirtualAeV1(
    recipe,
    project(),
    context(),
  );
  const shifted = compileEditingIrRecipeToVirtualAeV1(
    recipe,
    project(),
    context({ eventTimesMs: { "transition-anchor": 2200 } }),
  );
  const baselineState = simulateVirtualAeV1(project(), baseline.operations);
  const shiftedState = simulateVirtualAeV1(project(), shifted.operations);

  const getPeak = (state) => {
    const comp = state.project.compositions.find(
      (candidate) => candidate.compId === "comp.transition",
    );
    return property(comp.layers[0], "TimeRemap.SourceTime")
      .keyframes[1].timeMs;
  };

  assert.equal(getPeak(baselineState), 2000);
  assert.equal(getPeak(shiftedState), 2200);
});

test("Recipe compilation fails closed on unsafe adapted parameters", async () => {
  const recipe = await loadRecipe();
  const badKey = recipeParameterKeyV1(
    "shape-temporal-velocity-pulse",
    "velocityPulseDuration",
  );

  assert.throws(
    () => compileEditingIrRecipeToVirtualAeV1(
      recipe,
      project(),
      context({ parameterValues: { [badKey]: 0.9 } }),
    ),
    (error) => {
      assert.ok(error instanceof RecipeCompileError);
      assert.ok(error.issues.some((issue) =>
        issue.code === "PARAMETER_OUT_OF_RANGE"
        && issue.nodeId === "shape-temporal-velocity-pulse"));
      return true;
    },
  );
});
