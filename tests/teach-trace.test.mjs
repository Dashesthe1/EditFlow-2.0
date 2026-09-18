import test from "node:test";
import assert from "node:assert/strict";

import {
  compileTeachTraceRegressionV1,
  createTeachTraceFromProgramV1,
  createTeachTraceFromSnapshotsV1,
  diffVirtualAeProjectsV1,
  replayTeachTraceV1,
  verifyTeachTraceIntegrityV1,
} from "../.tmp/runtime/packages/teach-trace/src/index.js";
import {
  createEmptyVirtualAeProjectV1,
  simulateVirtualAeV1,
} from "../.tmp/runtime/packages/virtual-ae/src/index.js";

const source = {
  kind: "TUTORIAL_RECONSTRUCTION",
  referenceId: "tutorial://001",
};

const program = () => [{
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
  layerId: "layer.rig",
  name: "Rig",
  kind: "NULL",
  inMs: 0,
  outMs: 1500,
}, {
  type: "CREATE_LAYER",
  compId: "comp.main",
  layerId: "layer.subject",
  name: "Subject",
  kind: "FOOTAGE",
  inMs: 0,
  outMs: 1500,
  sourceRef: "source://hero",
}, {
  type: "CREATE_LAYER",
  compId: "comp.main",
  layerId: "layer.matte",
  name: "Matte",
  kind: "SHAPE",
  inMs: 0,
  outMs: 1500,
}, {
  type: "SET_PARENT",
  compId: "comp.main",
  layerId: "layer.subject",
  parentLayerId: "layer.rig",
}, {
  type: "SET_MATTE",
  compId: "comp.main",
  layerId: "layer.subject",
  matteLayerId: "layer.matte",
}, {
  type: "SET_PROPERTY",
  compId: "comp.main",
  layerId: "layer.subject",
  propertyPath: "Transform.Position",
  value: [540, 540],
}, {
  type: "ADD_KEYFRAME",
  compId: "comp.main",
  layerId: "layer.subject",
  propertyPath: "Transform.Opacity",
  timeMs: 100,
  value: 100,
}, {
  type: "ADD_EFFECT",
  compId: "comp.main",
  layerId: "layer.subject",
  effectId: "fx.blur",
  matchName: "ADBE Gaussian Blur 2",
}, {
  type: "SET_EFFECT_PROPERTY",
  compId: "comp.main",
  layerId: "layer.subject",
  effectId: "fx.blur",
  propertyPath: "Blurriness",
  value: 18,
}, {
  type: "ADD_MASK",
  compId: "comp.main",
  layerId: "layer.subject",
  maskId: "mask.hero",
  mode: "ADD",
  closed: true,
}];

test("Teach/Trace deterministically records semantic construction deltas", () => {
  const before = createEmptyVirtualAeProjectV1();
  const first = createTeachTraceFromProgramV1(source, before, program());
  const second = createTeachTraceFromProgramV1(source, before, program());

  assert.equal(first.traceId, second.traceId);
  assert.equal(first.afterHash, second.afterHash);
  assert.equal(first.deltaHash, second.deltaHash);
  assert.equal(first.replayable, true);
  assert.ok(first.delta.changeCount > 0);

  const kinds = new Set(first.delta.changes.map((change) => change.entityKind));
  assert.ok(kinds.has("COMPOSITION"));
  assert.ok(kinds.has("LAYER"));
  assert.ok(kinds.has("PROPERTY"));
  assert.ok(kinds.has("KEYFRAME"));
  assert.ok(kinds.has("EFFECT"));
  assert.ok(kinds.has("EFFECT_PROPERTY"));
  assert.ok(kinds.has("MASK"));
  assert.ok(kinds.has("RELATION"));
});

test("Teach/Trace exact replay reaches the same state and delta", () => {
  const trace = createTeachTraceFromProgramV1(
    source,
    createEmptyVirtualAeProjectV1(),
    program(),
  );
  const replay = replayTeachTraceV1(trace);
  assert.equal(replay.status, "PASS", replay.errors.join("\n"));
  assert.equal(replay.actualAfterHash, trace.afterHash);
  assert.equal(replay.actualDeltaHash, trace.deltaHash);
});

test("Teach/Trace refuses replay from a different baseline", () => {
  const trace = createTeachTraceFromProgramV1(
    source,
    createEmptyVirtualAeProjectV1(),
    program(),
  );
  const wrongBaseline = createEmptyVirtualAeProjectV1();
  wrongBaseline.activeCompId = "comp.other";
  const replay = replayTeachTraceV1(trace, wrongBaseline);
  assert.equal(replay.status, "BASELINE_MISMATCH");
  assert.equal(replay.actualAfterHash, null);
});

test("Snapshot-only teaching captures knowledge without pretending it is replayable", () => {
  const before = createEmptyVirtualAeProjectV1();
  const simulation = simulateVirtualAeV1(before, program());
  assert.equal(simulation.valid, true, simulation.errors.join("\n"));

  const trace = createTeachTraceFromSnapshotsV1(
    { kind: "HUMAN_TEACH", referenceId: "session://human-1" },
    before,
    simulation.project,
  );
  assert.equal(trace.replayable, false);
  assert.ok(trace.delta.changeCount > 0);
  assert.equal(replayTeachTraceV1(trace).status, "NO_REPLAY_OPERATIONS");
});

test("Teach/Trace detects operation tampering during integrity and replay", () => {
  const trace = createTeachTraceFromProgramV1(
    source,
    createEmptyVirtualAeProjectV1(),
    program(),
  );
  const tampered = structuredClone(trace);
  const effectWrite = tampered.operations.find(
    (operation) => operation.type === "SET_EFFECT_PROPERTY",
  );
  assert.ok(effectWrite);
  effectWrite.value = 99;

  const integrity = verifyTeachTraceIntegrityV1(tampered);
  assert.equal(integrity.valid, false);
  assert.match(
    integrity.errors.join("\n"),
    /operations do not reproduce|operationHash mismatch/i,
  );

  const replay = replayTeachTraceV1(tampered);
  assert.equal(replay.status, "FINAL_STATE_MISMATCH");
});

test("Semantic delta distinguishes changed and removed state", () => {
  const before = simulateVirtualAeV1(
    createEmptyVirtualAeProjectV1(),
    program(),
  ).project;
  const after = structuredClone(before);
  const subject = after.compositions[0].layers.find(
    (layer) => layer.layerId === "layer.subject",
  );
  assert.ok(subject);
  subject.name = "Hero";
  subject.masks = [];

  const delta = diffVirtualAeProjectsV1(before, after);
  assert.ok(delta.changes.some(
    (change) => change.entityKind === "LAYER" && change.change === "CHANGED",
  ));
  assert.ok(delta.changes.some(
    (change) => change.entityKind === "MASK" && change.change === "REMOVED",
  ));
  assert.ok(delta.changes.some(
    (change) => change.entityKind === "MASK_ORDER" && change.change === "CHANGED",
  ));
});

test("Regression contracts preserve exact semantic expectations", () => {
  const trace = createTeachTraceFromProgramV1(
    { kind: "TRANSFER_PROOF", referenceId: "transfer://case-a" },
    createEmptyVirtualAeProjectV1(),
    program(),
  );
  const contract = compileTeachTraceRegressionV1(trace);
  assert.equal(contract.traceId, trace.traceId);
  assert.equal(contract.expectedAfterHash, trace.afterHash);
  assert.equal(contract.expectedDeltaHash, trace.deltaHash);
  assert.equal(contract.operationCount, program().length);
  assert.deepEqual(
    contract.requiredChangePaths,
    [...contract.requiredChangePaths].sort(),
  );
  assert.ok(contract.requiredEntityKinds.includes("RELATION"));
});

test("Teach/Trace refuses to record an invalid executable program", () => {
  assert.throws(
    () => createTeachTraceFromProgramV1(
      { kind: "PROOF", referenceId: "proof://invalid" },
      createEmptyVirtualAeProjectV1(),
      [{
        type: "CREATE_LAYER",
        compId: "comp.missing",
        layerId: "layer.bad",
        name: "Bad",
        kind: "FOOTAGE",
        inMs: 0,
        outMs: 100,
      }],
    ),
    /Cannot trace invalid program/i,
  );
});
