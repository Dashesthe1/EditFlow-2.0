import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyVirtualAeProjectV1,
  simulateVirtualAeTransactionV1,
} from "../.tmp/runtime/packages/virtual-ae/src/index.js";

const comp = {
  type: "CREATE_COMP",
  compId: "comp.main",
  name: "Main",
  width: 640,
  height: 360,
  durationMs: 3000,
  frameRate: 30,
};

const layer = (layerId, name) => ({
  type: "CREATE_LAYER",
  compId: "comp.main",
  layerId,
  name,
  kind: "FOOTAGE",
  inMs: 0,
  outMs: 2500,
  sourceRef: `source:${layerId}`,
});

test("Virtual AE validates a reusable structural edit transaction without live AE", () => {
  const result = simulateVirtualAeTransactionV1(createEmptyVirtualAeProjectV1(), [
    comp,
    layer("hero", "Hero"),
    {
      type: "DUPLICATE_LAYER",
      compId: "comp.main",
      sourceLayerId: "hero",
      layerId: "echo",
      name: "Echo",
      offsetMs: 50,
    },
    {
      type: "SET_PROPERTY",
      compId: "comp.main",
      layerId: "echo",
      propertyPath: "Transform.Opacity",
      value: 45,
    },
    {
      type: "ADD_KEYFRAME",
      compId: "comp.main",
      layerId: "echo",
      propertyPath: "Transform.Position",
      timeMs: 500,
      value: [250, 180],
    },
    {
      type: "ADD_EFFECT",
      compId: "comp.main",
      layerId: "echo",
      effectId: "blur",
      matchName: "ADBE Gaussian Blur 2",
    },
    {
      type: "SET_EFFECT_PROPERTY",
      compId: "comp.main",
      layerId: "echo",
      effectId: "blur",
      propertyPath: "Blurriness",
      value: 18,
    },
    {
      type: "ADD_MASK",
      compId: "comp.main",
      layerId: "echo",
      maskId: "mask.subject",
    },
    {
      type: "SET_MATTE",
      compId: "comp.main",
      layerId: "echo",
      matteLayerId: "hero",
    },
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.rolledBack, false);
  const echo = result.project.compositions[0].layers.find((candidate) => candidate.layerId === "echo");
  assert.equal(echo.effects[0].matchName, "ADBE Gaussian Blur 2");
  assert.equal(echo.matteLayerId, "hero");
});

test("Virtual AE transaction rolls back an impossible timing plan", () => {
  const initial = createEmptyVirtualAeProjectV1();
  const result = simulateVirtualAeTransactionV1(initial, [
    comp,
    {
      type: "CREATE_LAYER",
      compId: "comp.main",
      layerId: "bad",
      name: "Bad Timing",
      kind: "FOOTAGE",
      inMs: 0,
      outMs: 3500,
    },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(result.project, initial);
  assert.match(result.errors.join("\n"), /exceeds composition duration/);
});

test("Virtual AE rejects cyclic parenting and restores the starting state", () => {
  const initial = createEmptyVirtualAeProjectV1();
  const result = simulateVirtualAeTransactionV1(initial, [
    comp,
    layer("a", "A"),
    layer("b", "B"),
    { type: "SET_PARENT", compId: "comp.main", layerId: "a", parentLayerId: "b" },
    { type: "SET_PARENT", compId: "comp.main", layerId: "b", parentLayerId: "a" },
  ]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.project, initial);
  assert.match(result.errors.join("\n"), /parent cycle/i);
});

test("Virtual AE models precomposition structure without a render", () => {
  const result = simulateVirtualAeTransactionV1(createEmptyVirtualAeProjectV1(), [
    comp,
    layer("hero", "Hero"),
    layer("echo", "Echo"),
    {
      type: "PRECOMPOSE",
      compId: "comp.main",
      layerIds: ["hero", "echo"],
      newCompId: "comp.trail",
      newCompName: "Trail Precomp",
      newLayerId: "trail.precomp.layer",
    },
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.project.compositions.length, 2);
  const parent = result.project.compositions.find((candidate) => candidate.compId === "comp.main");
  const child = result.project.compositions.find((candidate) => candidate.compId === "comp.trail");
  assert.deepEqual(child.layers.map((candidate) => candidate.layerId), ["hero", "echo"]);
  assert.equal(parent.layers[0].sourceRef, "comp.trail");
});
