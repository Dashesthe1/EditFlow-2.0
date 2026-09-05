import test from "node:test";
import assert from "node:assert/strict";

import {
  asCapabilityId,
  asOperationId,
  asPlanId,
  asRollbackBoundaryId,
  asRouteId,
  asTransactionId,
} from "../.tmp/runtime/packages/core-contracts/src/index.js";
import {
  CapabilityRegistry,
} from "../.tmp/runtime/packages/capability-registry/src/index.js";
import {
  computeEnvironmentFingerprint,
} from "../.tmp/runtime/packages/fingerprints/src/index.js";
import {
  PlanValidationError,
  validateAndFreezeExecutionPlan,
} from "../.tmp/runtime/packages/planner/src/index.js";
import {
  InMemoryTransactionLedger,
  SimulatedProjectHost,
  TransactionExecutor,
} from "../.tmp/runtime/packages/executor/src/index.js";

const environmentFingerprint = computeEnvironmentFingerprint({
  host: "M1_SIMULATION",
  runtime: "0.1.0-dev.1",
});

const hostRoute = {
  routeId: asRouteId("sim.host"),
  kind: "HOST_ADAPTER",
  available: true,
  adapterVersion: "sim-1",
};

const guardedUiRoute = {
  routeId: asRouteId("sim.ui"),
  kind: "GUARDED_UI",
  available: true,
  adapterVersion: "sim-ui-1",
};

const capabilityRecord = (id, routes = [hostRoute]) => ({
  id: asCapabilityId(id),
  domain: "test",
  description: `M1 simulated capability ${id}`,
  status: "FULL",
  proofMaturity: "ROLLBACK",
  routes,
  readbackStrategy: "SIMULATED_READBACK",
  rollbackStrategy: "RESTORE_SNAPSHOT",
  riskClass: "R1_REVERSIBLE",
  fallbackPolicy: "FORBID",
});

const makeRegistry = () => {
  const registry = new CapabilityRegistry(environmentFingerprint, "2026-09-05T18:00:00.000Z");
  registry.registerStatic([
    {
      ...capabilityRecord("test.set", []),
      status: "ADAPTER_REQUIRED",
      proofMaturity: "DECLARED",
    },
    {
      ...capabilityRecord("test.increment", []),
      status: "ADAPTER_REQUIRED",
      proofMaturity: "DECLARED",
    },
    {
      ...capabilityRecord("test.fail", []),
      status: "ADAPTER_REQUIRED",
      proofMaturity: "DECLARED",
    },
  ]);
  registry.registerAdapter({
    adapterId: "simulation",
    adapterVersion: "sim-1",
    priority: 100,
    capabilities: [
      capabilityRecord("test.set", [guardedUiRoute, hostRoute]),
      capabilityRecord("test.increment"),
      capabilityRecord("test.fail"),
    ],
  });
  return registry;
};

const makePlan = (state, operations, requiredCapabilities, rollbackBoundaries) => ({
  planId: asPlanId("PLAN_M1_TEST"),
  planRevision: 1,
  projectRevision: state.projectRevision,
  projectFingerprint: state.projectFingerprint,
  environmentFingerprint: state.environmentFingerprint,
  creativeObjective: "Exercise M1 transaction semantics.",
  requiredCapabilities: requiredCapabilities.map(asCapabilityId),
  bindings: [],
  operations,
  checkpoints: [],
  invariants: { structural: [], visual: [] },
  rollbackBoundaries,
});

const operation = ({ id, capability, dependsOn = [], action, key, value, by, boundary, message }) => {
  const input = { action };
  if (key !== undefined) input.key = key;
  if (value !== undefined) input.value = value;
  if (by !== undefined) input.by = by;
  if (message !== undefined) input.message = message;
  return {
    operationId: asOperationId(id),
    capabilityId: asCapabilityId(capability),
    routeId: asRouteId("sim.host"),
    dependsOn: dependsOn.map(asOperationId),
    idempotency: action === "increment" ? "NON_IDEMPOTENT" : "CHECK_THEN_APPLY",
    riskClass: "R1_REVERSIBLE",
    input,
    rollbackBoundaryId: asRollbackBoundaryId(boundary),
  };
};

const boundary = (id) => ({
  id: asRollbackBoundaryId(id),
  strategy: "RESTORE_SNAPSHOT",
});

test("capability registry activates adapter declarations and prioritizes typed host routes over UI fallback", () => {
  const registry = makeRegistry();
  const resolution = registry.resolve(asCapabilityId("test.set"));
  assert.equal(resolution.capability.status, "FULL");
  assert.equal(resolution.route.kind, "HOST_ADAPTER");
  assert.equal(resolution.route.routeId, asRouteId("sim.host"));
});

test("plan preflight rejects project drift before execution", () => {
  const registry = makeRegistry();
  const host = new SimulatedProjectHost("project-stale", environmentFingerprint);
  const initial = host.readState();
  const plan = makePlan(
    initial,
    [operation({ id: "op-set", capability: "test.set", action: "set", key: "mode", value: "ready", boundary: "b1" })],
    ["test.set"],
    [boundary("b1")],
  );

  host.apply(operation({ id: "external-change", capability: "test.set", action: "set", key: "external", value: true, boundary: "b1" }));

  assert.throws(
    () => validateAndFreezeExecutionPlan(plan, host.readState(), registry),
    (error) => error instanceof PlanValidationError
      && error.issues.some((issue) => issue.code === "STALE_PROJECT_REVISION")
      && error.issues.some((issue) => issue.code === "STALE_PROJECT_FINGERPRINT"),
  );
});

test("committed groups resume without duplicating non-idempotent operations", () => {
  const registry = makeRegistry();
  const host = new SimulatedProjectHost("project-resume", environmentFingerprint);
  const plan = makePlan(
    host.readState(),
    [
      operation({ id: "op-set", capability: "test.set", action: "set", key: "mode", value: "ready", boundary: "b1" }),
      operation({ id: "op-inc", capability: "test.increment", dependsOn: ["op-set"], action: "increment", key: "counter", by: 1, boundary: "b2" }),
    ],
    ["test.set", "test.increment"],
    [boundary("b1"), boundary("b2")],
  );

  const firstLedger = new InMemoryTransactionLedger();
  const firstExecutor = new TransactionExecutor(
    registry,
    firstLedger,
    () => asTransactionId("tx-resume"),
    () => "2026-09-05T18:00:00.000Z",
  );
  const interrupted = firstExecutor.execute(plan, host, { stopAfterCommittedGroups: 1 });
  assert.equal(interrupted.state, "EXECUTING");
  assert.deepEqual(host.inspectData(), { mode: "ready" });

  const restoredLedger = new InMemoryTransactionLedger(firstLedger.export());
  const resumedExecutor = new TransactionExecutor(
    registry,
    restoredLedger,
    () => asTransactionId("tx-should-not-be-used"),
    () => "2026-09-05T18:00:01.000Z",
  );
  const resumed = resumedExecutor.execute(plan, host);
  assert.equal(resumed.state, "COMMITTED");
  assert.equal(resumed.recovered, true);
  assert.equal(resumed.transactionId, asTransactionId("tx-resume"));
  assert.deepEqual(host.inspectData(), { mode: "ready", counter: 1 });

  const replay = resumedExecutor.execute(plan, host);
  assert.equal(replay.state, "COMMITTED");
  assert.equal(replay.recovered, true);
  assert.deepEqual(host.inspectData(), { mode: "ready", counter: 1 });
});

test("failed atomic group restores its exact pre-group snapshot", () => {
  const registry = makeRegistry();
  const host = new SimulatedProjectHost("project-rollback", environmentFingerprint, { preserved: "yes" });
  const plan = makePlan(
    host.readState(),
    [
      operation({ id: "op-temp", capability: "test.set", action: "set", key: "temporary", value: 99, boundary: "b1" }),
      operation({ id: "op-fail", capability: "test.fail", dependsOn: ["op-temp"], action: "fail", boundary: "b1", message: "expected simulated failure" }),
    ],
    ["test.set", "test.fail"],
    [boundary("b1")],
  );

  const executor = new TransactionExecutor(
    registry,
    new InMemoryTransactionLedger(),
    () => asTransactionId("tx-rollback"),
    () => "2026-09-05T18:00:02.000Z",
  );
  const result = executor.execute(plan, host);
  assert.equal(result.state, "ROLLED_BACK");
  assert.match(result.error ?? "", /expected simulated failure/);
  assert.deepEqual(host.inspectData(), { preserved: "yes" });
  assert.equal(host.readState().projectRevision, plan.projectRevision);
  assert.equal(host.readState().projectFingerprint, plan.projectFingerprint);
});
