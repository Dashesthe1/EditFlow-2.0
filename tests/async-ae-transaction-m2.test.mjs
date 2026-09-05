import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  asOperationId,
  asPlanId,
  asRollbackBoundaryId,
  asRouteId,
  asTransactionId,
} from "../.tmp/runtime/packages/core-contracts/src/index.js";
import { createM1CapabilityRegistry } from "../.tmp/runtime/packages/capability-registry/src/index.js";
import { AsyncTransactionExecutor } from "../.tmp/runtime/packages/executor/src/async.js";
import { InMemoryTransactionLedger } from "../.tmp/runtime/packages/executor/src/index.js";
import {
  AE_CEP_PUBLIC_CAPABILITIES_V11,
  AeCepAdapterClientV11,
  AeCepAsyncTransactionalHostV11,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_BUILD_V11,
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  AE_ADAPTER_ROUTE_ID_V11,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";

const environmentProbe = {
  adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
  adapterBuild: AE_ADAPTER_BUILD_V11,
  hostName: "Adobe After Effects",
  hostVersion: "26.0-test",
  hostBuild: "test-build",
  os: "Windows test",
  projectOpen: true,
};

const makeProject = () => ({
  hostRevision: 20,
  filePath: "C:/EditFlow/disposable.aep",
  activeItemHostId: null,
  itemCount: 0,
  items: [],
});

const responseFor = (request, overrides = {}) => ({
  protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
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
    adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
    adapterBuild: AE_ADAPTER_BUILD_V11,
    command: request.command,
  },
  proofArtifactRefs: [],
  ...overrides,
});

const deepClone = (value) => structuredClone(value);

class StatefulFakeAeV11Transport {
  constructor() {
    this.project = makeProject();
    this.undoStack = [];
    this.requests = [];
  }

  pushUndo() {
    this.undoStack.push(deepClone(this.project));
  }

  async dispatch(request) {
    this.requests.push(deepClone(request));
    if (request.command === "host.probe") {
      return responseFor(request, { environmentProbe, hostProjectRevision: this.project.hostRevision });
    }
    if (request.command === "project.inspect") {
      return responseFor(request, { projectSnapshot: deepClone(this.project), hostProjectRevision: this.project.hostRevision });
    }
    if (request.expectedHostProjectRevision !== null && request.expectedHostProjectRevision !== this.project.hostRevision) {
      return responseFor(request, {
        outcome: "REJECTED",
        error: { category: "STALE_PROJECT_STATE", code: "HOST_REVISION_MISMATCH", message: "stale revision" },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "comp.create") {
      this.pushUndo();
      const item = {
        hostId: 1000 + this.project.items.length,
        stableId: request.payload.stableId,
        kind: "COMPOSITION",
        name: request.payload.name,
        parentHostId: null,
        comment: `[[EDITFLOW2_STABLE:${request.payload.stableId}]]`,
        composition: {
          hostId: 1000 + this.project.items.length,
          stableId: request.payload.stableId,
          name: request.payload.name,
          width: request.payload.width,
          height: request.payload.height,
          pixelAspect: request.payload.pixelAspect,
          duration: request.payload.duration,
          frameRate: request.payload.frameRate,
          displayStartTime: 0,
          layers: [],
        },
      };
      this.project.items.push(item);
      this.project.itemCount = this.project.items.length;
      this.project.hostRevision += 1;
      return responseFor(request, {
        outcome: "APPLIED",
        affectedObjects: [{ stableId: item.stableId, hostId: item.hostId, kind: "COMPOSITION" }],
        readback: { composition: item.composition },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "comp.update_settings") {
      const target = this.project.items.find((item) => item.stableId === request.payload.comp?.stableId);
      if (!target) {
        return responseFor(request, {
          outcome: "FAILED",
          error: { category: "ADAPTER_FAILURE", code: "HOST_COMMAND_FAILED", message: "Composition target could not be resolved." },
          hostProjectRevision: this.project.hostRevision,
        });
      }
      this.pushUndo();
      Object.assign(target.composition, request.payload.settings ?? {});
      this.project.hostRevision += 1;
      return responseFor(request, { outcome: "APPLIED", readback: { composition: deepClone(target.composition) }, hostProjectRevision: this.project.hostRevision });
    }
    if (request.command === "transaction.undo_last") {
      const previous = this.undoStack.pop();
      if (!previous) {
        return responseFor(request, {
          outcome: "FAILED",
          error: { category: "ROLLBACK_FAILURE", code: "NO_UNDO_AVAILABLE", message: "Nothing to undo." },
          hostProjectRevision: this.project.hostRevision,
        });
      }
      const newerRevision = this.project.hostRevision + 1;
      this.project = previous;
      this.project.hostRevision = newerRevision;
      return responseFor(request, { outcome: "APPLIED", readback: { undone: true }, hostProjectRevision: this.project.hostRevision });
    }
    throw new Error(`Unhandled fake v1.1 command: ${request.command}`);
  }
}

const planOperation = ({ id, capabilityId, command, payload, dependsOn = [], boundary = "ROLLBACK_1" }) => ({
  operationId: asOperationId(id),
  capabilityId,
  routeId: asRouteId(AE_ADAPTER_ROUTE_ID_V11),
  dependsOn: dependsOn.map(asOperationId),
  idempotency: "CHECK_THEN_APPLY",
  riskClass: "R2_STRUCTURAL",
  input: { command, payload },
  rollbackBoundaryId: asRollbackBoundaryId(boundary),
});

const makePlan = (state) => ({
  planId: asPlanId("PLAN_M2_ASYNC_ROLLBACK"),
  planRevision: 1,
  projectRevision: state.projectRevision,
  projectFingerprint: state.projectFingerprint,
  environmentFingerprint: state.environmentFingerprint,
  creativeObjective: "Prove async AE transaction rollback.",
  requiredCapabilities: ["ae.comp.create", "ae.comp.settings.set"],
  bindings: [],
  operations: [
    planOperation({
      id: "OP_CREATE",
      capabilityId: "ae.comp.create",
      command: "comp.create",
      payload: { stableId: "COMP_ROLLBACK", name: "Rollback Candidate", width: 100, height: 100, pixelAspect: 1, duration: 1, frameRate: 24 },
    }),
    planOperation({
      id: "OP_FAIL_AFTER_CREATE",
      capabilityId: "ae.comp.settings.set",
      command: "comp.update_settings",
      payload: { comp: { stableId: "COMP_DOES_NOT_EXIST" }, settings: { width: 200 } },
      dependsOn: ["OP_CREATE"],
    }),
  ],
  checkpoints: [],
  invariants: { structural: [], visual: [] },
  rollbackBoundaries: [{ id: asRollbackBoundaryId("ROLLBACK_1"), strategy: "RESTORE_SNAPSHOT" }],
});

test("protocol 1.1 async AE transaction rolls back applied operations after a later host failure", async () => {
  const transport = new StatefulFakeAeV11Transport();
  const client = new AeCepAdapterClientV11(transport, () => `req-${transport.requests.length + 1}`);
  const initialState = (await client.observe("project-async-rollback")).observed;
  const registry = createM1CapabilityRegistry(initialState.environmentFingerprint);
  registry.registerAdapter({
    adapterId: "ae-cep-v1.1-test",
    adapterVersion: AE_ADAPTER_BUILD_V11,
    priority: 110,
    capabilities: AE_CEP_PUBLIC_CAPABILITIES_V11,
  });
  const host = new AeCepAsyncTransactionalHostV11(client, "project-async-rollback", "tx-async");
  const executor = new AsyncTransactionExecutor(
    registry,
    new InMemoryTransactionLedger(),
    () => asTransactionId("tx-async"),
    () => "2026-09-05T19:00:00.000Z",
  );

  const result = await executor.execute(makePlan(initialState), host);
  assert.equal(result.state, "ROLLED_BACK");
  assert.match(result.error ?? "", /Composition target could not be resolved/);
  assert.equal(transport.project.items.length, 0);
  assert.equal(result.finalState.projectFingerprint, initialState.projectFingerprint);
  assert.notEqual(result.finalState.projectRevision, initialState.projectRevision, "undo may advance AE's monotonic revision");
  assert.equal(transport.requests.some((request) => request.command === "transaction.undo_last"), true);
});

test("protocol 1.1 transaction host rejects command/capability mismatches before mutation", async () => {
  const transport = new StatefulFakeAeV11Transport();
  const client = new AeCepAdapterClientV11(transport, () => `req-${transport.requests.length + 1}`);
  const host = new AeCepAsyncTransactionalHostV11(client, "project-command-mismatch", "tx-mismatch");
  await assert.rejects(
    () => host.apply(planOperation({
      id: "OP_BAD_COMMAND",
      capabilityId: "ae.comp.create",
      command: "comp.remove",
      payload: { comp: { stableId: "anything" } },
    })),
    /command\/capability mismatch/,
  );
  assert.equal(transport.project.items.length, 0);
});

test("current AE host loader layers v1.1 hardening over the green v1.0 dispatcher", async () => {
  const loader = await readFile("packages/adapters/ae-cep/host/editflow_host_current.jsx", "utf8");
  const hardening = await readFile("packages/adapters/ae-cep/host/editflow_host_hardening.jsx", "utf8");
  assert.match(loader, /editflow_host\.jsx/);
  assert.match(loader, /editflow_host_hardening\.jsx/);
  assert.match(hardening, /transaction\.undo_last/);
  assert.match(hardening, /app\.executeCommand\(16\)/);
  assert.match(hardening, /replacementStableId/);
  assert.match(hardening, /findLayerBySource/);
  assert.doesNotMatch(hardening, /\beval\s*\(/);
  assert.doesNotMatch(hardening, /new\s+Function\s*\(/);
});
