import test from "node:test";
import assert from "node:assert/strict";

import {
  validateEditingIrRecipeV1,
} from "../.tmp/runtime/packages/editing-ir/src/index.js";
import {
  createEmptyVirtualAeProjectV1,
  simulateVirtualAeV1,
} from "../.tmp/runtime/packages/virtual-ae/src/index.js";

const trailRecipe = () => ({
  schema: "editflow.editing-ir.recipe.v1",
  recipeId: "recipe.subject-trail.v1",
  skillId: "skill.subject-trail",
  creativeIntent: "Create a readable directional echo behind a moving subject.",
  prerequisites: ["subject identity available", "motion direction available"],
  nodes: [{
    nodeId: "isolate",
    kind: "SUBJECT_ISOLATION",
    intent: "Separate the subject from the background.",
    dependsOn: [],
    capabilityIds: ["ae.subject.isolate"],
    parameters: [],
  }, {
    nodeId: "duplicate",
    kind: "TEMPORAL_DUPLICATION",
    intent: "Create motion-aware temporal echoes.",
    dependsOn: ["isolate"],
    capabilityIds: ["ae.layer.duplicate"],
    parameters: [{
      name: "temporalSpacing",
      intent: "Separate echoes enough to show velocity without fragmenting the subject.",
      derivedFrom: ["subjectVelocity", "frameRate", "desiredPersistence"],
      normalizedRange: { min: 0, max: 1 },
    }],
    timing: { anchor: "EVENT", eventRef: "peak-motion", durationMs: 220 },
  }, {
    nodeId: "blur",
    kind: "BLUR",
    intent: "Soften echoes without obscuring the hero subject.",
    dependsOn: ["duplicate"],
    capabilityIds: ["ae.effect.add", "ae.effect.property.set"],
    parameters: [],
  }],
  outputs: ["blur"],
  validationCriteria: ["subject remains readable", "trail follows motion direction"],
});

test("Editing IR accepts a semantic recipe and returns dependency order", () => {
  const result = validateEditingIrRecipeV1(trailRecipe());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.orderedNodeIds.indexOf("isolate") < result.orderedNodeIds.indexOf("duplicate"));
  assert.ok(result.orderedNodeIds.indexOf("duplicate") < result.orderedNodeIds.indexOf("blur"));
});

test("Editing IR rejects cycles and missing outputs before AE", () => {
  const recipe = trailRecipe();
  recipe.nodes[0].dependsOn = ["blur"];
  recipe.outputs = ["missing"];
  const result = validateEditingIrRecipeV1(recipe);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /dependency cycle/i);
  assert.match(result.errors.join("\n"), /output 'missing'/i);
});

const baseProgram = () => [{
  type: "CREATE_COMP",
  compId: "comp.main",
  name: "Main",
  width: 1080,
  height: 1080,
  durationMs: 2000,
  frameRate: 60,
}, {
  type: "CREATE_LAYER",
  compId: "comp.main",
  layerId: "layer.subject",
  name: "Subject",
  kind: "FOOTAGE",
  inMs: 0,
  outMs: 1500,
  sourceRef: "source://subject",
}, {
  type: "DUPLICATE_LAYER",
  compId: "comp.main",
  sourceLayerId: "layer.subject",
  layerId: "layer.trail",
  name: "Trail",
  offsetMs: 16.667,
}, {
  type: "ADD_EFFECT",
  compId: "comp.main",
  layerId: "layer.trail",
  effectId: "fx.blur",
  matchName: "ADBE Gaussian Blur 2",
}, {
  type: "SET_EFFECT_PROPERTY",
  compId: "comp.main",
  layerId: "layer.trail",
  effectId: "fx.blur",
  propertyPath: "Blurriness",
  value: 24,
}, {
  type: "ADD_KEYFRAME",
  compId: "comp.main",
  layerId: "layer.trail",
  propertyPath: "Transform.Opacity",
  timeMs: 100,
  value: 65,
}, {
  type: "ADD_KEYFRAME",
  compId: "comp.main",
  layerId: "layer.trail",
  propertyPath: "Transform.Opacity",
  timeMs: 500,
  value: 0,
}];

test("Virtual AE simulates a valid layered construction without live AE", () => {
  const simulation = simulateVirtualAeV1(createEmptyVirtualAeProjectV1(), baseProgram());
  assert.equal(simulation.valid, true, simulation.errors.join("\n"));
  const comp = simulation.project.compositions[0];
  assert.equal(comp.layers.length, 2);
  const trail = comp.layers.find((layer) => layer.layerId === "layer.trail");
  assert.equal(trail.effects[0].matchName, "ADBE Gaussian Blur 2");
  assert.deepEqual(
    trail.properties.find((property) => property.path === "Transform.Opacity").keyframes
      .map((keyframe) => keyframe.timeMs),
    [100, 500],
  );
});

test("Virtual AE rejects impossible timing and missing effect dependencies", () => {
  const invalid = [
    ...baseProgram().slice(0, 2),
    {
      type: "ADD_KEYFRAME",
      compId: "comp.main",
      layerId: "layer.subject",
      propertyPath: "Transform.Scale",
      timeMs: 1800,
      value: 120,
    },
    {
      type: "SET_EFFECT_PROPERTY",
      compId: "comp.main",
      layerId: "layer.subject",
      effectId: "fx.missing",
      propertyPath: "Amount",
      value: 1,
    },
  ];
  const simulation = simulateVirtualAeV1(createEmptyVirtualAeProjectV1(), invalid);
  assert.equal(simulation.valid, false);
  assert.match(simulation.errors.join("\n"), /keyframe time/i);
  assert.match(simulation.errors.join("\n"), /effect 'fx\.missing' does not exist/i);
});

test("Virtual AE preserves explicit effect ordering", () => {
  const program = [
    ...baseProgram().slice(0, 2),
    { type: "ADD_EFFECT", compId: "comp.main", layerId: "layer.subject",
      effectId: "fx.blur", matchName: "ADBE Gaussian Blur 2" },
    { type: "ADD_EFFECT", compId: "comp.main", layerId: "layer.subject",
      effectId: "fx.glow", matchName: "ADBE Glo2", insertAfterEffectId: "fx.blur" },
  ];
  const simulation = simulateVirtualAeV1(createEmptyVirtualAeProjectV1(), program);
  assert.equal(simulation.valid, true, simulation.errors.join("\n"));
  const subject = simulation.project.compositions[0].layers[0];
  assert.deepEqual(subject.effects.map((effect) => effect.effectId), ["fx.blur", "fx.glow"]);
});

test("Virtual AE detects relationship cycles structurally", () => {
  const program = [
    baseProgram()[0],
    baseProgram()[1],
    { type: "CREATE_LAYER", compId: "comp.main", layerId: "layer.null", name: "Rig",
      kind: "NULL", inMs: 0, outMs: 1500 },
    { type: "SET_PARENT", compId: "comp.main", layerId: "layer.subject", parentLayerId: "layer.null" },
    { type: "SET_PARENT", compId: "comp.main", layerId: "layer.null", parentLayerId: "layer.subject" },
  ];
  const simulation = simulateVirtualAeV1(createEmptyVirtualAeProjectV1(), program);
  assert.equal(simulation.valid, false);
  assert.match(simulation.errors.join("\n"), /parent cycle/i);
});

test("Virtual AE precompose creates a structural subcomposition", () => {
  const program = [
    baseProgram()[0],
    baseProgram()[1],
    { type: "CREATE_LAYER", compId: "comp.main", layerId: "layer.accent", name: "Accent",
      kind: "SHAPE", inMs: 100, outMs: 900 },
    { type: "PRECOMPOSE", compId: "comp.main", newCompId: "comp.pre",
      newCompName: "Trail Precomp", newLayerId: "layer.pre", layerIds: ["layer.subject", "layer.accent"] },
  ];
  const simulation = simulateVirtualAeV1(createEmptyVirtualAeProjectV1(), program);
  assert.equal(simulation.valid, true, simulation.errors.join("\n"));
  assert.equal(simulation.project.compositions.length, 2);
  const main = simulation.project.compositions.find((comp) => comp.compId === "comp.main");
  const pre = simulation.project.compositions.find((comp) => comp.compId === "comp.pre");
  assert.deepEqual(main.layers.map((layer) => layer.layerId), ["layer.pre"]);
  assert.deepEqual(pre.layers.map((layer) => layer.layerId), ["layer.subject", "layer.accent"]);
  assert.equal(main.layers[0].kind, "PRECOMP");
});
