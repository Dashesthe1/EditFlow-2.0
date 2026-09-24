import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CurrentAeTransactionRuntimeV1,
  createCurrentAeTransactionRegistryV1,
} from "../.tmp/runtime/apps/desktop-host/src/current-ae-transaction-runtime.js";
import {
  compilePracticeAeBaselineExecutionPlanV1,
  createPracticeCurrentAeBaselineRunnerV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-training-runtime.js";
import {
  AeCepCurrentTransactionalHostV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/current-transactional-host.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  AE_ADAPTER_ROUTE_ID_V11,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_MASK_ROUTE_ID_V12,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_2.js";
import {
  AE_COMPOSITE_ROUTE_ID_V13,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_3.js";
import {
  AE_LAYER_CONTROLS_ROUTE_ID_V16,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_6.js";
import {
  AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_7.js";
import {
  AE_TEMPORAL_EASE_ROUTE_ID_V18,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_8.js";
import {
  AE_MARKER_MOTION_ROUTE_ID_V20,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_0.js";
import {
  AE_MEDIA_SEQUENCE_ROUTE_ID_V25,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_5.js";
import {
  AE_TIME_REMAP_ROUTE_ID_V27,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_7.js";
import {
  M4_STABILIZATION_GUARDED_ROUTE_ID_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-stabilization.js";

const environmentProbe = {
  adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
  adapterBuild: "test-current-runtime",
  hostName: "Adobe After Effects",
  hostVersion: "25.6.6",
  hostBuild: "4",
  os: "Windows test",
  projectOpen: true,
};

const responseFor = (request, overrides = {}) => ({
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
    adapterBuild: "test-current-runtime",
    command: request.command,
    notes: [],
  },
  proofArtifactRefs: [],
  ...overrides,
});

class RuntimeTransport {
  constructor() {
    this.requests = [];
    this.project = {
      hostRevision: 30,
      filePath: "C:/EditFlow/current-runtime-test.aep",
      activeItemHostId: null,
      itemCount: 0,
      items: [],
    };
    this.undoStack = [];
    this.mutationCount = 0;
  }

  async dispatch(request) {
    this.requests.push(structuredClone(request));
    if (request.command === "host.probe") {
      return responseFor(request, {
        environmentProbe,
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "project.inspect") {
      return responseFor(request, {
        projectSnapshot: structuredClone(this.project),
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (
      request.expectedHostProjectRevision !== null
      && request.expectedHostProjectRevision !== undefined
      && request.expectedHostProjectRevision !== this.project.hostRevision
    ) {
      return responseFor(request, {
        outcome: "REJECTED",
        error: {
          code: "HOST_REVISION_MISMATCH",
          message: "stale revision",
        },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "transaction.undo_last") {
      const prior = this.undoStack.pop();
      if (!prior) {
        return responseFor(request, {
          outcome: "FAILED",
          error: { code: "NO_UNDO_AVAILABLE", message: "Nothing to undo." },
          hostProjectRevision: this.project.hostRevision,
        });
      }
      const nextRevision = this.project.hostRevision + 1;
      this.project = prior;
      this.project.hostRevision = nextRevision;
      return responseFor(request, {
        outcome: "APPLIED",
        readback: { undone: true },
        hostProjectRevision: this.project.hostRevision,
      });
    }

    this.undoStack.push(structuredClone(this.project));
    this.mutationCount += 1;
    const hostId = 2000 + this.mutationCount;
    this.project.items.push({
      hostId,
      stableId: `RUNTIME_MUTATION_${this.mutationCount}`,
      kind: "COMPOSITION",
      name: `Runtime Mutation ${this.mutationCount}`,
      parentHostId: null,
      comment: "",
      composition: {
        hostId,
        stableId: `RUNTIME_MUTATION_${this.mutationCount}`,
        name: `Runtime Mutation ${this.mutationCount}`,
        width: 100,
        height: 100,
        pixelAspect: 1,
        duration: 1,
        frameRate: 24,
        displayStartTime: 0,
        layers: [],
      },
    });
    this.project.itemCount = this.project.items.length;
    this.project.hostRevision += 1;
    return responseFor(request, {
      outcome: "APPLIED",
      readback: { mutationCount: this.mutationCount },
      hostProjectRevision: this.project.hostRevision,
    });
  }
}

class EffectBindingTransport extends RuntimeTransport {
  async dispatch(request) {
    const response = await super.dispatch(request);
    if (request.command === "effect.add"
      && (response.outcome === "APPLIED" || response.outcome === "NO_OP")) {
      return {
        ...response,
        readback: { ...(response.readback ?? {}), propertyIndex: 7 },
      };
    }
    return response;
  }
}

class RevisionAdvancingReadTransport extends RuntimeTransport {
  async dispatch(request) {
    if (request.command === "host.probe" || request.command === "project.inspect") {
      this.project.hostRevision += 1;
    }
    return await super.dispatch(request);
  }
}

class FailingMutationTransport extends RuntimeTransport {
  constructor(failAtMutation) {
    super();
    this.failAtMutation = failAtMutation;
  }

  async dispatch(request) {
    const observational = request.command === "host.probe"
      || request.command === "project.inspect"
      || request.command === "transaction.undo_last";
    if (!observational && this.mutationCount + 1 === this.failAtMutation) {
      this.requests.push(structuredClone(request));
      return responseFor(request, {
        outcome: "FAILED",
        error: { code: "INJECTED_FAILURE", message: "Injected correction failure." },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    return await super.dispatch(request);
  }
}

const op = (id, capabilityId, routeId, command, dependsOn = []) => ({
  operationId: id,
  capabilityId,
  routeId,
  dependsOn,
  idempotency: "CHECK_THEN_APPLY",
  riskClass: "R1_REVERSIBLE",
  input: { command, payload: {} },
  rollbackBoundaryId: "ROLLBACK_CURRENT_RUNTIME",
});

const buildRepeatedPlan = (observed, operationCount, riskClass = "R1_REVERSIBLE") => {
  const operations = Array.from({ length: operationCount }, (_, index) => ({
    ...op(
      `OP_CORRECTION_${String(index + 1).padStart(3, "0")}`,
      "ae.keyframe.set",
      AE_ADAPTER_ROUTE_ID_V11,
      "property.set_keyframes",
      index === 0 ? [] : [`OP_CORRECTION_${String(index).padStart(3, "0")}`],
    ),
    riskClass,
  }));
  return {
    planId: "current-runtime-correction-plan",
    planRevision: 1,
    projectRevision: observed.projectRevision,
    projectFingerprint: observed.projectFingerprint,
    environmentFingerprint: observed.environmentFingerprint,
    requiredCapabilities: ["ae.keyframe.set"],
    bindings: [],
    operations,
    checkpoints: [],
    invariants: { structural: [], visual: [] },
    rollbackBoundaries: [{
      id: "ROLLBACK_CURRENT_RUNTIME",
      strategy: "RESTORE_SNAPSHOT",
    }],
  };
};

const buildPlan = (observed) => {
  const operations = [
    op("OP_PRECOMPOSE", "ae.precompose.layers", AE_ADAPTER_ROUTE_ID_V11, "layers.precompose"),
    op("OP_TIME_REMAP", "ae.layer.time_remap.enable", AE_TIME_REMAP_ROUTE_ID_V27, "layer.time_remap.enable", ["OP_PRECOMPOSE"]),
    op("OP_KEYS", "ae.keyframe.set", AE_ADAPTER_ROUTE_ID_V11, "property.set_keyframes", ["OP_TIME_REMAP"]),
    op("OP_INTERPOLATION", "ae.property.temporal_interpolation.set", AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17, "property.temporal_interpolation.set", ["OP_KEYS"]),
    op("OP_EASE", "ae.property.temporal_ease.set", AE_TEMPORAL_EASE_ROUTE_ID_V18, "property.temporal_ease.set", ["OP_INTERPOLATION"]),
  ];
  return {
    planId: "current-runtime-plan",
    planRevision: 1,
    projectRevision: observed.projectRevision,
    projectFingerprint: observed.projectFingerprint,
    environmentFingerprint: observed.environmentFingerprint,
    requiredCapabilities: [
      "ae.precompose.layers",
      "ae.layer.time_remap.enable",
      "ae.keyframe.set",
      "ae.property.temporal_interpolation.set",
      "ae.property.temporal_ease.set",
    ],
    bindings: [],
    operations,
    checkpoints: [],
    invariants: { structural: [], visual: [] },
    rollbackBoundaries: [{
      id: "ROLLBACK_CURRENT_RUNTIME",
      strategy: "RESTORE_SNAPSHOT",
    }],
  };
};

test("current AE transaction runtime executes and recovers one mixed-protocol plan", async () => {
  const transport = new RuntimeTransport();
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-runtime-project",
    "observe-runtime",
    () => "observe-runtime-request",
  );
  const observed = await observer.readState();
  const runtime = new CurrentAeTransactionRuntimeV1(
    transport,
    "current-runtime-project",
  );
  const plan = buildPlan(observed);

  const first = await runtime.execute(plan);
  assert.equal(first.state, "COMMITTED");
  assert.equal(first.recovered, false);
  assert.equal(first.appliedOperations, 5);
  assert.equal(transport.mutationCount, 5);

  const second = await runtime.execute(plan);
  assert.equal(second.state, "COMMITTED");
  assert.equal(second.recovered, true);
  assert.equal(second.appliedOperations, 5);
  assert.equal(transport.mutationCount, 5);

  assert.equal(runtime.status().recoveryLedgerEntries, 1);
  assert.equal(runtime.status().maxOperations, 64);
});

test("current AE transactional host dispatches protocol 1.2 mask mutations through the typed mask route", async () => {
  const transport = new RuntimeTransport();
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "mask-route-project",
    "mask-route-transaction",
    () => `mask-route-request-${transport.requests.length + 1}`,
  );
  await host.readState();

  const createMask = {
    ...op("OP_MASK_CREATE", "ae.mask.create", AE_MASK_ROUTE_ID_V12, "mask.create"),
    riskClass: "R2_STRUCTURAL",
    input: {
      command: "mask.create",
      payload: {
        comp: { stableId: "comp" },
        layer: { stableId: "hero" },
        stableId: "PRACTICE_MASK_TEST",
        name: "Practice Mask",
        shape: {
          closed: true,
          vertices: [[10, 10], [90, 10], [90, 90], [10, 90]],
          inTangents: [[0, 0], [0, 0], [0, 0], [0, 0]],
          outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]],
        },
        properties: { mode: "ADD" },
      },
    },
  };

  assert.equal((await host.apply(createMask)).outcome, "APPLIED");
  const request = transport.requests.findLast((item) => item.command === "mask.create");
  assert.ok(request);
  assert.equal(request.protocolVersion, "1.2.0");
  assert.equal(request.capabilityId, "ae.mask.create");
  assert.equal(request.expectedHostProjectRevision, 30);
  assert.equal(request.payload.stableId, "PRACTICE_MASK_TEST");
});

test("current AE transactional host resolves effect-bound property expressions through the runtime effect index", async () => {
  const transport = new EffectBindingTransport();
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "effect-expression-project",
    "effect-expression-transaction",
    () => `effect-expression-request-${transport.requests.length + 1}`,
  );
  await host.readState();

  const addEffect = {
    ...op("OP_EFFECT_ADD", "ae.effect.add", AE_ADAPTER_ROUTE_ID_V11, "effect.add"),
    input: {
      command: "effect.add",
      payload: {
        comp: { stableId: "comp" },
        layer: { stableId: "hero" },
        matchName: "ADBE Turbulent Displace",
        effectBindingId: "warp:dynamic",
      },
    },
  };
  const expression = {
    ...op("OP_EFFECT_EXPRESSION", "ae.expression.set", AE_ADAPTER_ROUTE_ID_V11,
      "property.set_expression", ["OP_EFFECT_ADD"]),
    input: {
      command: "property.set_expression",
      payload: {
        comp: { stableId: "comp" },
        layer: { stableId: "hero" },
        effectBindingId: "warp:dynamic",
        propertyPath: ["ADBE Turbulent Displace-0006"],
        expression: "value+time*180",
        enabled: true,
      },
    },
  };

  assert.equal((await host.apply(addEffect)).outcome, "APPLIED");
  assert.equal((await host.apply(expression)).outcome, "APPLIED");
  const request = transport.requests.findLast((item) => item.command === "property.set_expression");
  assert.ok(request);
  assert.equal(request.payload.effectBindingId, undefined);
  assert.deepEqual(request.payload.propertyPath, [
    "ADBE Effect Parade",
    7,
    "ADBE Turbulent Displace-0006",
  ]);
});

test("current AE transaction runtime tolerates revision-only observation drift while fingerprints remain stable", async () => {
  const transport = new RevisionAdvancingReadTransport();
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    "revision-drift-project",
    "observe-revision-drift",
    () => "observe-revision-drift-request",
  );
  const observed = await observer.readState();
  const plan = buildPlan(observed);
  const runtime = new CurrentAeTransactionRuntimeV1(
    transport,
    "revision-drift-project",
  );

  const result = await runtime.execute(plan);
  assert.equal(result.state, "COMMITTED");
  assert.equal(result.recovered, false);
  assert.equal(result.appliedOperations, 5);
  assert.equal(transport.mutationCount, 5);
});

test("current AE transaction runtime uses only proof-backed current routes", async () => {
  const transport = new RuntimeTransport();
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    "registry-project",
    "observe-registry",
    () => "observe-registry-request",
  );
  const observed = await observer.readState();
  const registry = createCurrentAeTransactionRegistryV1(
    observed.environmentFingerprint,
  );

  for (const [capabilityId, routeId] of [
    ["ae.precompose.layers", AE_ADAPTER_ROUTE_ID_V11],
    ["ae.keyframe.set", AE_ADAPTER_ROUTE_ID_V11],
    ["ae.layer.blend_mode.set", AE_COMPOSITE_ROUTE_ID_V13],
    ["ae.property.temporal_interpolation.set", AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17],
    ["ae.property.temporal_ease.set", AE_TEMPORAL_EASE_ROUTE_ID_V18],
    ["ae.comp.motion.set", AE_MARKER_MOTION_ROUTE_ID_V20],
    ["ae.layer.motion.set", AE_MARKER_MOTION_ROUTE_ID_V20],
    ["ae.media.sequence.import", AE_MEDIA_SEQUENCE_ROUTE_ID_V25],
    ["ae.media.sequence.readback", AE_MEDIA_SEQUENCE_ROUTE_ID_V25],
    ["ae.layer.time_remap.enable", AE_TIME_REMAP_ROUTE_ID_V27],
  ]) {
    assert.equal(String(registry.assertRouteAvailable(capabilityId, routeId).routeId), routeId);
  }

  assert.throws(
    () => registry.assertRouteAvailable(
      "ae.stabilization.position.guarded_visual",
      String(M4_STABILIZATION_GUARDED_ROUTE_ID_V1),
    ),
  );

  const verifiedDriver = {
    driverId: "TEST_VERIFIED_STABILIZATION_DRIVER",
    verifiedVision: true,
    verifiedCursorControl: true,
    supportedDirections: ["FORWARD"],
    async stabilize() { return { status: "REFUSED" }; },
  };
  const stabilizationRegistry = createCurrentAeTransactionRegistryV1(
    observed.environmentFingerprint,
    undefined,
    { protocolV23Available: true, visualDriver: verifiedDriver },
  );
  assert.equal(
    String(stabilizationRegistry.assertRouteAvailable(
      "ae.stabilization.position.guarded_visual",
      String(M4_STABILIZATION_GUARDED_ROUTE_ID_V1),
    ).routeId),
    String(M4_STABILIZATION_GUARDED_ROUTE_ID_V1),
  );
  assert.equal(
    stabilizationRegistry.assertRouteAvailable(
      "ae.stabilization.readback",
      "ae-cep.stabilization.v2_3",
    ).kind,
    "HOST_ADAPTER",
  );
});

test("current AE transaction runtime rejects oversized plans before contacting AE", async () => {
  const transport = new RuntimeTransport();
  const runtime = new CurrentAeTransactionRuntimeV1(
    transport,
    "current-runtime-project",
    2,
  );
  const requestCount = transport.requests.length;

  await assert.rejects(
    runtime.execute({ operations: [{}, {}, {}] }),
    /CURRENT_AE_TRANSACTION_OPERATION_LIMIT/,
  );
  assert.equal(transport.requests.length, requestCount);
});

test("current AE correction runtime admits one bounded restore-snapshot plan above the normal limit", async () => {
  const transport = new RuntimeTransport();
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    "correction-runtime-project",
    "observe-correction-runtime",
    () => "observe-correction-runtime-request",
  );
  const observed = await observer.readState();
  const runtime = new CurrentAeTransactionRuntimeV1(
    transport,
    "correction-runtime-project",
  );
  const plan = buildRepeatedPlan(observed, 72);
  const requestCount = transport.requests.length;

  await assert.rejects(
    runtime.execute(plan),
    /CURRENT_AE_TRANSACTION_OPERATION_LIMIT/,
  );
  assert.equal(transport.requests.length, requestCount);

  const result = await runtime.executeCorrection(plan);
  assert.equal(result.state, "COMMITTED");
  assert.equal(result.appliedOperations, 72);
  assert.equal(transport.project.itemCount, 72);
  assert.equal(runtime.status().maxOperations, 64);
  assert.equal(runtime.status().correctionMaxOperations, 96);
});

test("current AE correction runtime rolls back a failure beyond operation 64", async () => {
  const transport = new FailingMutationTransport(66);
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    "correction-rollback-project",
    "observe-correction-rollback",
    () => "observe-correction-rollback-request",
  );
  const observed = await observer.readState();
  const runtime = new CurrentAeTransactionRuntimeV1(
    transport,
    "correction-rollback-project",
  );
  const result = await runtime.executeCorrection(buildRepeatedPlan(observed, 72));

  assert.equal(result.state, "ROLLED_BACK");
  assert.equal(result.appliedOperations, 65);
  assert.equal(transport.project.itemCount, 0);
  assert.equal(transport.undoStack.length, 0);
  assert.equal(
    transport.requests.filter((request) => request.command === "transaction.undo_last").length,
    65,
  );
  assert.equal(result.finalState.projectFingerprint, observed.projectFingerprint);
});

test("current AE correction runtime forbids oversized external-UI plans before contacting AE", async () => {
  const transport = new RuntimeTransport();
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    "correction-external-ui-project",
    "observe-correction-external-ui",
    () => "observe-correction-external-ui-request",
  );
  const observed = await observer.readState();
  const runtime = new CurrentAeTransactionRuntimeV1(
    transport,
    "correction-external-ui-project",
  );
  const requestCount = transport.requests.length;

  await assert.rejects(
    runtime.executeCorrection(buildRepeatedPlan(observed, 65, "R4_EXTERNAL_UI")),
    /CURRENT_AE_CORRECTION_EXTERNAL_UI_FORBIDDEN/,
  );
  assert.equal(transport.requests.length, requestCount);
});


test("current Shadow daemon exposes typed mixed-protocol transaction execution", async () => {
  const source = await readFile("scripts/current-shadow-control-daemon.mjs", "utf8");
  assert.match(source, /CurrentAeTransactionRuntimeV1/);
  assert.match(source, /url\.pathname === "\/run-transaction"/);
  assert.match(source, /currentTransactionRuntime\.execute\(body\.plan\)/);
  assert.match(source, /run-correction-transaction/);
  assert.match(source, /currentTransactionRuntime\.executeCorrection\(body\.plan\)/);
  assert.match(source, /x-editflow-mutation-lease/);
  assert.match(source, /mutation-lease\/acquire/);
  assert.match(source, /MUTATION_LEASE_HELD/);
  assert.match(source, /LEASE_GUARDED_MUTATION_PATHS/);
  assert.match(source, /EditGptStabilizationVisualDriverV1/);
  assert.match(source, /supportedProtocolVersions.*2\.3\.0/s);
  assert.match(source, /result\.state === "COMMITTED"/);
});

const practiceBaselinePlan = () => ({
  schema: "editflow.practice-ae-baseline-plan.v1",
  baselineId: "practice-baseline:test-runtime",
  referenceId: "finish:test-runtime",
  compStableId: "PRACTICE_COMP_TEST",
  durationMs: 2500,
  frameRate: 24,
  audioMatchId: null,
  operations: [
    {
      operationId: "PRACTICE_OP_001",
      command: "media.import",
      capabilityId: "ae.media.import",
      payload: {
        path: "C:\\Media\\movie.mp4",
        stableId: "PRACTICE_MEDIA_TEST",
        sequence: false,
      },
    },
    {
      operationId: "PRACTICE_OP_002",
      command: "comp.create",
      capabilityId: "ae.comp.create",
      payload: {
        stableId: "PRACTICE_COMP_TEST",
        name: "Practice Test",
        width: 320,
        height: 180,
        pixelAspect: 1,
        duration: 2.5,
        frameRate: 24,
      },
    },
    {
      operationId: "PRACTICE_OP_003",
      command: "layer.add_media",
      capabilityId: "ae.layer.create",
      payload: {
        stableId: "PRACTICE_LAYER_TEST",
        comp: { stableId: "PRACTICE_COMP_TEST" },
        item: { stableId: "PRACTICE_MEDIA_TEST" },
      },
    },
    {
      operationId: "PRACTICE_OP_004",
      command: "layer.set_timing",
      capabilityId: "ae.layer.timing.set",
      payload: {
        comp: { stableId: "PRACTICE_COMP_TEST" },
        layer: { stableId: "PRACTICE_LAYER_TEST" },
        timing: {
          startTime: 0,
          inPoint: 0,
          outPoint: 2.5,
          stretch: 100,
        },
      },
    },
    {
      operationId: "PRACTICE_OP_005",
      command: "layer.switches.set",
      capabilityId: "ae.layer.switches.set",
      payload: {
        comp: { stableId: "PRACTICE_COMP_TEST" },
        layer: { stableId: "PRACTICE_LAYER_TEST" },
        switches: { audioEnabled: false },
      },
    },
  ],
  evidenceRefs: ["practice:test-runtime"],
});

test("Practice baseline compiles to the current mixed-protocol AE transaction surface", async () => {
  const transport = new RuntimeTransport();
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    "practice-runtime-project",
    "practice-runtime-observe",
    () => "practice-runtime-observe-request",
  );
  const observed = await observer.readState();
  const execution = compilePracticeAeBaselineExecutionPlanV1(
    practiceBaselinePlan(),
    observed,
  );

  assert.equal(execution.operations.length, 5);
  assert.equal(
    String(execution.operations[0].routeId),
    AE_ADAPTER_ROUTE_ID_V11,
  );
  assert.equal(
    String(execution.operations.at(-1).routeId),
    AE_LAYER_CONTROLS_ROUTE_ID_V16,
  );
  assert.equal(execution.rollbackBoundaries.length, 1);
  assert.equal(
    execution.rollbackBoundaries[0].strategy,
    "RESTORE_SNAPSHOT",
  );
  assert.deepEqual(
    execution.operations.slice(1).map((operation) =>
      operation.dependsOn.map(String)),
    [["PRACTICE_OP_001"], ["PRACTICE_OP_002"], ["PRACTICE_OP_003"], ["PRACTICE_OP_004"]],
  );
});

test("Practice baseline executes atomically through the current AE runtime", async () => {
  const transport = new RuntimeTransport();
  const runner = createPracticeCurrentAeBaselineRunnerV1({
    transport,
    projectId: "practice-runtime-project",
    mediaRoots: ["C:\\Media"],
  });
  const result = await runner.executePlan(practiceBaselinePlan());

  assert.equal(transport.mutationCount, 5);
  assert.ok(
    result.evidenceRefs.includes(
      "practice-ae-transaction:practice-ae:practice-baseline:test-runtime:COMMITTED",
    ),
  );
  assert.ok(
    transport.requests.some((request) =>
      request.command === "layer.switches.set"),
  );
});

test("Practice baseline refuses oversized atomic construction before contacting AE", async () => {
  const transport = new RuntimeTransport();
  const runner = createPracticeCurrentAeBaselineRunnerV1({
    transport,
    projectId: "practice-runtime-project",
    mediaRoots: ["C:\\Media"],
  });
  const base = practiceBaselinePlan();
  const operations = Array.from({ length: 65 }, (_, index) => ({
    ...base.operations[0],
    operationId: `PRACTICE_OVERSIZED_${String(index + 1).padStart(3, "0")}`,
  }));

  await assert.rejects(
    runner.executePlan({ ...base, operations }),
    /PRACTICE_BASELINE_TRANSACTION_LIMIT/,
  );
  assert.equal(transport.requests.length, 0);
});
