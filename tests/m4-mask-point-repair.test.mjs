import test from "node:test";
import assert from "node:assert/strict";

import {
  M4_MASK_POINT_REPAIR_CAPABILITY_V1,
  planM4MaskPointRepairV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-mask-point-repair.js";
import { buildMaskRequestV12 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-mask.js";

const shape = (offset = 0) => ({
  closed: true,
  vertices: [[10 + offset, 10], [110 + offset, 10], [110 + offset, 80], [10 + offset, 80]],
  inTangents: [[0, 0], [-12, 0], [0, -12], [12, 0]],
  outTangents: [[12, 0], [0, 12], [-12, 0], [0, -12]],
  variableFeather: {
    segLocs: [0.2], relSegLocs: [0.2], radii: [4], interps: [0],
    tensions: [0], types: [0], relCornerAngles: [0],
  },
});

const base = (overrides = {}) => ({
  comp: { stableId: "COMP_MASK_REPAIR" },
  layer: { stableId: "LAYER_MASK_REPAIR" },
  mask: { stableId: "MASK_REPAIR_01" },
  path: { kind: "STATIC", shape: shape() },
  pointIndex: 1,
  replacement: { vertex: [118, 14] },
  evidenceIds: ["MASK:READBACK:EXACT"],
  ...overrides,
});

test("mask-point repair planner is read-only and inherits the accepted protocol 1.2 write surface", () => {
  assert.equal(M4_MASK_POINT_REPAIR_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_MASK_POINT_REPAIR_CAPABILITY_V1.proofMaturity, "VISUAL");
  assert.equal(M4_MASK_POINT_REPAIR_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
  assert.equal(M4_MASK_POINT_REPAIR_CAPABILITY_V1.visualProofProfile, "M4_MASK_POINT_REPAIR_STATIC_VERTEX_VISUAL");
  assert.ok(M4_MASK_POINT_REPAIR_CAPABILITY_V1.limitations.some((value) => value.includes("static-path vertex repair")));
  assert.ok(M4_MASK_POINT_REPAIR_CAPABILITY_V1.limitations.some((value) => value.includes("Tangent-only repair")));
  assert.equal(M4_MASK_POINT_REPAIR_CAPABILITY_V1.fallbackPolicy, "FORBID");
  assert.ok(M4_MASK_POINT_REPAIR_CAPABILITY_V1.limitations.some((value) => value.includes("existing exact mask path")));
});

test("static repair changes only the requested point component and preserves source geometry", () => {
  const input = base();
  const original = structuredClone(input.path.shape);
  const plan = planM4MaskPointRepairV1(input);
  assert.ok(plan);
  assert.equal(plan.command, "mask.set_path");
  assert.equal(plan.hostCapabilityId, "ae.mask.path.set");
  assert.deepEqual(plan.before.vertex, [110, 10]);
  assert.deepEqual(plan.after.vertex, [118, 14]);
  assert.deepEqual(plan.after.inTangent, [-12, 0]);
  assert.deepEqual(plan.payload.shape.vertices[0], [10, 10]);
  assert.deepEqual(plan.payload.shape.vertices[1], [118, 14]);
  assert.deepEqual(plan.payload.shape.variableFeather, original.variableFeather);
  assert.deepEqual(input.path.shape, original);
});

test("tangent-only repair leaves vertex and opposite tangent exact", () => {
  const plan = planM4MaskPointRepairV1(base({ replacement: { inTangent: [-18, 3] } }));
  assert.ok(plan);
  assert.deepEqual(plan.after.vertex, [110, 10]);
  assert.deepEqual(plan.after.inTangent, [-18, 3]);
  assert.deepEqual(plan.after.outTangent, [0, 12]);
});

test("animated repair requires an exact existing key time and preserves every other key", () => {
  const keyframes = [
    { time: 0, shape: shape(0) },
    { time: 0.5, shape: shape(5) },
    { time: 1, shape: shape(10) },
  ];
  const plan = planM4MaskPointRepairV1(base({
    path: { kind: "ANIMATED", keyframes },
    targetTime: 0.5,
    pointIndex: 2,
    replacement: { vertex: [130, 92], outTangent: [-20, -2] },
  }));
  assert.ok(plan);
  assert.equal(plan.targetTime, 0.5);
  assert.equal(plan.payload.shape, undefined);
  assert.equal(plan.payload.keyframes.length, 3);
  assert.deepEqual(plan.payload.keyframes[0], keyframes[0]);
  assert.deepEqual(plan.payload.keyframes[2], keyframes[2]);
  assert.deepEqual(plan.payload.keyframes[1].shape.vertices[2], [130, 92]);
  assert.deepEqual(plan.payload.keyframes[1].shape.outTangents[2], [-20, -2]);
  assert.deepEqual(keyframes[1].shape.vertices[2], [115, 80]);
});

test("planned payload binds cleanly to the accepted typed mask.set_path request", () => {
  const plan = planM4MaskPointRepairV1(base());
  const request = buildMaskRequestV12({
    requestId: "REQ_MASK_REPAIR",
    transactionId: "TX_MASK_REPAIR",
    operationId: "OP_MASK_REPAIR",
    command: plan.command,
    expectedHostProjectRevision: 7,
    payload: plan.payload,
  });
  assert.equal(request.protocolVersion, "1.2.0");
  assert.equal(request.capabilityId, "ae.mask.path.set");
  assert.deepEqual(request.payload, plan.payload);
});

test("animated repair refuses interpolation-time guesses and malformed key ordering", () => {
  const keyframes = [
    { time: 0, shape: shape(0) },
    { time: 0.5, shape: shape(5) },
  ];
  assert.equal(planM4MaskPointRepairV1(base({
    path: { kind: "ANIMATED", keyframes },
    targetTime: 0.25,
  })), null);
  assert.equal(planM4MaskPointRepairV1(base({
    path: { kind: "ANIMATED", keyframes: [keyframes[0], { time: 0, shape: shape(5) }] },
    targetTime: 0,
  })), null);
});

test("static repair refuses target time, invalid index, or missing repair evidence", () => {
  assert.equal(planM4MaskPointRepairV1(base({ targetTime: 0 })), null);
  assert.equal(planM4MaskPointRepairV1(base({ pointIndex: 4 })), null);
  assert.equal(planM4MaskPointRepairV1(base({ pointIndex: 1.5 })), null);
  assert.equal(planM4MaskPointRepairV1(base({ evidenceIds: [] })), null);
  assert.equal(planM4MaskPointRepairV1(base({ evidenceIds: ["", " "] })), null);
});

test("repair refuses ambiguous identity, malformed source geometry, and empty replacement", () => {
  assert.equal(planM4MaskPointRepairV1(base({ mask: { stableId: "" } })), null);
  assert.equal(planM4MaskPointRepairV1(base({ replacement: {} })), null);
  assert.equal(planM4MaskPointRepairV1(base({ replacement: { vertex: [NaN, 20] } })), null);
  const badTangents = shape();
  badTangents.inTangents = badTangents.inTangents.slice(0, 3);
  assert.equal(planM4MaskPointRepairV1(base({ path: { kind: "STATIC", shape: badTangents } })), null);
  const badFeather = shape();
  badFeather.variableFeather.radii = [4, 8];
  assert.equal(planM4MaskPointRepairV1(base({ path: { kind: "STATIC", shape: badFeather } })), null);
});
