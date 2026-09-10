import test from "node:test";
import assert from "node:assert/strict";

import { createDesktopAeSession } from "../.tmp/runtime/apps/desktop-host/src/index.js";
import {
  AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS,
  AE_ACCEPTED_M3_RUNTIME_PROTOCOLS,
} from "../.tmp/runtime/apps/desktop-host/src/ae-runtime-capabilities.js";
import { getMcpServerStatus } from "../.tmp/runtime/apps/mcp-server/src/index.js";

const fakeObservedState = (projectId) => ({
  observed: {
    projectId,
    projectRevision: "runtime-registry-test-revision",
    projectFingerprint: "runtime-registry-test-project-fingerprint",
    environmentFingerprint: "runtime-registry-test-environment",
  },
  project: {
    schemaVersion: 1,
    projectId,
    filePath: null,
    itemCount: 0,
    items: [],
  },
  hostRevision: 1,
});

test("desktop AE session composes every accepted M3 capability family into the live registry", async () => {
  const adapter = { observe: async (projectId) => fakeObservedState(projectId) };
  const session = await createDesktopAeSession(adapter, "runtime-registry-test-project");
  const snapshot = session.registry.snapshot();
  const byId = new Map(snapshot.capabilities.map((capability) => [String(capability.id), capability]));

  assert.deepEqual(AE_ACCEPTED_M3_RUNTIME_PROTOCOLS, ["1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "2.0.0"]);
  assert.equal(AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS.length, 9);

  for (const group of AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS) {
    assert.ok(group.capabilities.length > 0, `${group.adapterId} must contain accepted capabilities`);
    for (const expected of group.capabilities) {
      const capabilityId = String(expected.id);
      const live = byId.get(capabilityId);
      assert.ok(live, `${capabilityId} must be discoverable in the desktop runtime registry`);
      assert.equal(live.status, expected.status, `${capabilityId} status must match accepted evidence`);
      assert.equal(live.proofMaturity, expected.proofMaturity, `${capabilityId} proof maturity must match accepted evidence`);
      const resolution = session.registry.resolve(expected.id);
      assert.equal(String(resolution.capability.id), capabilityId);
      assert.equal(resolution.route.available, true, `${capabilityId} must resolve to an available route`);
    }
  }
});

test("newer accepted metadata wins for capability IDs that overlap the M2 baseline", async () => {
  const adapter = { observe: async (projectId) => fakeObservedState(projectId) };
  const session = await createDesktopAeSession(adapter);
  const layerOrder = session.registry.get("ae.layer.order.set");
  assert.ok(layerOrder);
  const acceptedLayerOrder = AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS.flatMap((group) => group.capabilities).find((capability) => String(capability.id) === "ae.layer.order.set");
  assert.ok(acceptedLayerOrder);
  assert.equal(layerOrder.status, acceptedLayerOrder.status);
  assert.equal(layerOrder.proofMaturity, acceptedLayerOrder.proofMaturity);
  assert.ok(layerOrder.routes.some((route) => String(route.routeId) === "ae-cep.layer-controls.v1_6" && route.available));
});

test("accepted protocol-1.8 temporal ease is visible as transfer-mature runtime capability", async () => {
  const adapter = { observe: async (projectId) => fakeObservedState(projectId) };
  const session = await createDesktopAeSession(adapter);
  for (const id of ["ae.property.temporal_ease.set", "ae.property.temporal_ease.readback"]) {
    const capability = session.registry.get(id);
    assert.ok(capability, `${id} must be registered`);
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
    assert.ok(capability.routes.some((route) => String(route.routeId) === "ae-cep.temporal-ease.v1_8" && route.available));
  }
});

test("accepted protocol-1.9 spatial graph is visible as transfer-mature runtime capability", async () => {
  const adapter = { observe: async (projectId) => fakeObservedState(projectId) };
  const session = await createDesktopAeSession(adapter);
  for (const id of ["ae.property.spatial_graph.set", "ae.property.spatial_graph.readback"]) {
    const capability = session.registry.get(id);
    assert.ok(capability, `${id} must be registered`);
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
    assert.ok(capability.routes.some((route) => String(route.routeId) === "ae-cep.spatial-graph.v1_9" && route.available));
  }
});

test("accepted protocol-2.0 marker motion is visible as transfer-mature runtime capability", async () => {
  const adapter = { observe: async (projectId) => fakeObservedState(projectId) };
  const session = await createDesktopAeSession(adapter);
  for (const id of ["ae.marker.set", "ae.marker.remove", "ae.marker.readback", "ae.comp.motion.set", "ae.comp.motion.readback", "ae.layer.motion.set", "ae.layer.motion.readback"]) {
    const capability = session.registry.get(id);
    assert.ok(capability, `${id} must be registered`);
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
    assert.ok(capability.routes.some((route) => String(route.routeId) === "ae-cep.marker-motion.v2_0" && route.available));
  }
});

test("MCP diagnostics describe the composed M3 runtime through marker-motion protocol 2.0", () => {
  const status = getMcpServerStatus();
  assert.equal(status.runtimeCapabilityComposition, "M2_BASE_PLUS_ACCEPTED_M3");
  assert.equal(status.acceptedM3HostProtocols, "1.2.0_THROUGH_2.0.0_REGISTERED");
  assert.equal(status.humanParityCore, "MASK_COMPOSITE_PARENTING_NULL_LAYER_CONTROLS_TEMPORAL_SPATIAL_GRAPH_EDITOR_MARKER_MOTION_ACCEPTED");
  assert.equal(status.m3LatestHostProtocol, "2.0.0_TRANSFER_ACCEPTED");
});
