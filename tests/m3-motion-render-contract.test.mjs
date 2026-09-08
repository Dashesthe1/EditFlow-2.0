import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  AE_MOTION_RENDER_ADAPTER_BUILD_V110,
  AE_MOTION_RENDER_COMMANDS_V110,
  AE_MOTION_RENDER_PROTOCOL_VERSION_V110,
  AE_MOTION_RENDER_ROUTE_ID_V110,
  capabilityForMotionRenderCommandV110,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_10.js";
import {
  M3_MOTION_RENDER_CAPABILITIES_V110,
  buildMotionRenderRequestV110,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-motion-render.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_motion_render.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v110.jsx";

test("protocol 1.10 declares the bounded motion/frame rendering surface", () => {
  assert.equal(AE_MOTION_RENDER_PROTOCOL_VERSION_V110, "1.10.0");
  assert.equal(AE_MOTION_RENDER_ADAPTER_BUILD_V110, "0.4.0-dev.10");
  assert.equal(AE_MOTION_RENDER_ROUTE_ID_V110, "ae-cep.motion-render.v1_10");
  assert.deepEqual(AE_MOTION_RENDER_COMMANDS_V110, [
    "comp.motion_render.set",
    "layer.motion_render.set",
    "motion_render.readback",
  ]);
  assert.equal(capabilityForMotionRenderCommandV110("comp.motion_render.set"), "ae.comp.motion_render.set");
  assert.equal(capabilityForMotionRenderCommandV110("layer.motion_render.set"), "ae.layer.motion_render.set");
  assert.equal(capabilityForMotionRenderCommandV110("motion_render.readback"), "ae.motion_render.readback");
});

test("protocol 1.10 capabilities remain PARTIAL through accepted real-AE P3/P4 rollback maturity", () => {
  assert.equal(M3_MOTION_RENDER_CAPABILITIES_V110.length, 3);
  for (const capability of M3_MOTION_RENDER_CAPABILITIES_V110) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "ROLLBACK");
    assert.ok(capability.routes.some((route) => String(route.routeId) === "ae-cep.motion-render.v1_10" && route.available));
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("protocol 1.10 request builder correlates exact command/capability and defaults structural readback", () => {
  const request = buildMotionRenderRequestV110({
    requestId: "req-motion-render",
    transactionId: "tx-motion-render",
    operationId: "op-motion-render",
    command: "layer.motion_render.set",
    expectedHostProjectRevision: 42,
    payload: {
      comp: { stableId: "COMP" },
      layer: { stableId: "LAYER" },
      settings: { motionBlur: true, frameBlendingType: "PIXEL_MOTION" },
    },
  });
  assert.equal(request.protocolVersion, "1.10.0");
  assert.equal(request.capabilityId, "ae.layer.motion_render.set");
  assert.equal(request.expectedHostProjectRevision, 42);
  assert.equal(request.readbackProfile, "M3_MOTION_RENDER_STRUCTURAL");
});

test("motion-render host encodes Adobe composition ranges and writable frameBlendingType semantics", async () => {
  const source = await readFile(hostPath, "utf8");
  assert.match(source, /PROTOCOL = "1\.10\.0"/);
  assert.match(source, /shutterAngle/);
  assert.match(source, /requireIntegerInRange\(settings\[key\], 0, 720/);
  assert.match(source, /requireIntegerInRange\(settings\[key\], -360, 360/);
  assert.match(source, /requireIntegerInRange\(settings\[key\], 2, 64/);
  assert.match(source, /requireIntegerInRange\(settings\[key\], 16, 256/);
  assert.match(source, /layer\.frameBlendingType = frameBlendingTypeValue/);
  assert.doesNotMatch(source, /layer\.frameBlending\s*=/);
  assert.match(source, /LAYER_FRAME_BLENDING_DERIVED_STATE_MISMATCH/);
  assert.match(source, /expectedEnabled = settings\.frameBlendingType !== "NO_FRAME_BLEND"/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: hostPath }));
});

test("motion-render host is revision-gated, exact-readback verified, and self-restoring on post-write failure", async () => {
  const source = await readFile(hostPath, "utf8");
  assert.match(source, /EXPECTED_HOST_REVISION_REQUIRED/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /COMP_MOTION_RENDER_READBACK_MISMATCH/);
  assert.match(source, /LAYER_MOTION_RENDER_READBACK_MISMATCH/);
  assert.match(source, /restoreComp\(prepared\.comp, beforeComp\)/);
  assert.match(source, /restoreLayer\(prepared\.layer, beforeLayer\)/);
  assert.match(source, /COMP_MOTION_RENDER_ROLLBACK_MISMATCH/);
  assert.match(source, /LAYER_MOTION_RENDER_ROLLBACK_MISMATCH/);
  assert.match(source, /exact prior state was restored/);
});

test("protocol 1.10 loader is additive and fails closed to accepted protocol 1.9", async () => {
  const source = await readFile(loaderPath, "utf8");
  assert.match(source, /editflow_host_current_v19\.jsx/);
  assert.match(source, /editflow_host_m3_motion_render\.jsx/);
  assert.match(source, /M3_MOTION_RENDER_MODULE_LOAD_FAILED/);
  assert.match(source, /accepted protocol 1\.1-1\.9 dispatch remains available/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_110/);
  assert.match(source, /return dispatchBeforeFailure\(requestJson\)/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: loaderPath }));
});
