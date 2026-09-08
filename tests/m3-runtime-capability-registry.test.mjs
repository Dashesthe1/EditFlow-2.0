import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopAeSession } from "../.tmp/runtime/apps/desktop-host/src/index.js";
import { AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS, AE_ACCEPTED_M3_RUNTIME_PROTOCOLS } from "../.tmp/runtime/apps/desktop-host/src/ae-runtime-capabilities.js";
import { getMcpServerStatus } from "../.tmp/runtime/apps/mcp-server/src/index.js";

const fakeObservedState = (projectId) => ({ observed: { projectId, projectRevision: "runtime-registry-test-revision", projectFingerprint: "runtime-registry-test-project-fingerprint", environmentFingerprint: "runtime-registry-test-environment" }, project: { schemaVersion: 1, projectId, filePath: null, itemCount: 0, items: [] }, hostRevision: 1 });

test("desktop AE session composes every accepted M3 capability family into the live registry", async () => {
  const session = await createDesktopAeSession({ observe: async (projectId) => fakeObservedState(projectId) }, "runtime-registry-test-project");
  const byId = new Map(session.registry.snapshot().capabilities.map((capability) => [String(capability.id), capability]));
  assert.deepEqual(AE_ACCEPTED_M3_RUNTIME_PROTOCOLS, ["1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "1.10.0"]);
  assert.equal(AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS.length, 9);
  for (const group of AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS) {
    assert.ok(group.capabilities.length > 0);
    for (const expected of group.capabilities) {
      const live = byId.get(String(expected.id));
      assert.ok(live, `${String(expected.id)} must be discoverable`);
      assert.equal(live.status, expected.status);
      assert.equal(live.proofMaturity, expected.proofMaturity);
      assert.equal(session.registry.resolve(expected.id).route.available, true);
    }
  }
});

test("newer accepted metadata wins for capability IDs that overlap the M2 baseline", async () => {
  const session = await createDesktopAeSession({ observe: async (projectId) => fakeObservedState(projectId) });
  const layerOrder = session.registry.get("ae.layer.order.set");
  assert.ok(layerOrder);
  const accepted = AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS.flatMap((group) => group.capabilities).find((capability) => String(capability.id) === "ae.layer.order.set");
  assert.ok(accepted);
  assert.equal(layerOrder.status, accepted.status);
  assert.equal(layerOrder.proofMaturity, accepted.proofMaturity);
});

test("accepted protocol-1.9 spatial graph remains transfer-mature", async () => {
  const session = await createDesktopAeSession({ observe: async (projectId) => fakeObservedState(projectId) });
  for (const id of ["ae.property.spatial_graph.set", "ae.property.spatial_graph.readback"]) {
    const capability = session.registry.get(id); assert.ok(capability); assert.equal(capability.status, "FULL"); assert.equal(capability.proofMaturity, "TRANSFER");
  }
});

test("accepted protocol-1.10 motion render is visible as transfer-mature runtime capability", async () => {
  const session = await createDesktopAeSession({ observe: async (projectId) => fakeObservedState(projectId) });
  for (const id of ["ae.comp.motion_render.set", "ae.layer.motion_render.set", "ae.motion_render.readback"]) {
    const capability = session.registry.get(id);
    assert.ok(capability, `${id} must be registered`);
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
    assert.ok(capability.routes.some((route) => String(route.routeId) === "ae-cep.motion-render.v1_10" && route.available));
  }
});

test("MCP diagnostics describe the composed M3 runtime through motion-render protocol 1.10", () => {
  const status = getMcpServerStatus();
  assert.equal(status.runtimeCapabilityComposition, "M2_BASE_PLUS_ACCEPTED_M3");
  assert.equal(status.acceptedM3HostProtocols, "1.2.0_THROUGH_1.10.0_REGISTERED");
  assert.equal(status.humanParityCore, "MASK_COMPOSITE_PARENTING_NULL_LAYER_CONTROLS_TEMPORAL_SPATIAL_GRAPH_MOTION_RENDER_ACCEPTED");
  assert.equal(status.m3LatestHostProtocol, "1.10.0_TRANSFER_ACCEPTED");
});
