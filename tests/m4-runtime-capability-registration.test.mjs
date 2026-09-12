import test from "node:test";
import assert from "node:assert/strict";

import { createDesktopAeSession } from "../.tmp/runtime/apps/desktop-host/src/index.js";

const fakeObservedState = (projectId) => ({
  observed: {
    projectId,
    projectRevision: "m4-runtime-revision",
    projectFingerprint: "m4-runtime-project-fingerprint",
    environmentFingerprint: "m4-runtime-environment",
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

const adapter = { observe: async (projectId) => fakeObservedState(projectId) };
const forwardDriver = {
  driverId: "editgpt.eyes-hands.tracker.v1",
  verifiedVision: true,
  verifiedCursorControl: true,
  supportedDirections: ["FORWARD"],
  async analyze() { return { status: "REFUSED" }; },
};
test("default desktop session does not silently expose unconfigured M4 tracking routes", async () => {
  const session = await createDesktopAeSession(adapter, "m4-default");
  assert.equal(session.registry.get("ae.tracker.readback"), null);
  assert.equal(session.registry.get("ae.tracker.two_point_transform"), null);
  assert.equal(session.registry.get("ae.tracker.four_point_perspective"), null);
  assert.equal(session.registry.get("ae.tracker.analysis.guarded_visual"), null);
});

test("explicit protocol 2.1 availability registers readback without inventing a visual driver", async () => {
  const session = await createDesktopAeSession(adapter, "m4-readback", {
    m4TrackerRuntime: { pointTrackingV21Available: true, visualDriver: null },
  });
  const readback = session.registry.get("ae.tracker.readback");
  assert.ok(readback);
  assert.equal(readback.status, "PARTIAL");
  assert.ok(readback.routes.some((route) => route.kind === "HOST_ADAPTER" && route.available));
  const twoPoint = session.registry.get("ae.tracker.two_point_transform");
  assert.ok(twoPoint);
  assert.equal(twoPoint.proofMaturity, "STRUCTURAL");
  assert.ok(twoPoint.routes.some((route) => route.available));
  const fourPoint = session.registry.get("ae.tracker.four_point_perspective");
  assert.ok(fourPoint);
  assert.equal(fourPoint.proofMaturity, "STRUCTURAL");
  assert.ok(fourPoint.routes.some((route) => route.kind === "HOST_ADAPTER" && route.available));
  assert.equal(session.registry.get("ae.tracker.analysis.guarded_visual"), null);
});

test("verified Forward driver registers the bounded M4 analysis route", async () => {
  const session = await createDesktopAeSession(adapter, "m4-analysis", {
    m4TrackerRuntime: { pointTrackingV21Available: true, visualDriver: forwardDriver },
  });
  const analysis = session.registry.get("ae.tracker.analysis.guarded_visual");
  assert.ok(analysis);
  assert.equal(analysis.status, "PARTIAL");
  assert.equal(analysis.proofMaturity, "VISUAL");
  assert.ok(analysis.routes.some((route) => route.kind === "GUARDED_UI" && route.available));
  assert.ok(analysis.limitations.some((value) => value.includes("Analyze Backward remains unavailable")));
});

test("visual proof cannot register analysis when protocol 2.1 readback is unavailable", async () => {
  const session = await createDesktopAeSession(adapter, "m4-no-v21", {
    m4TrackerRuntime: { pointTrackingV21Available: false, visualDriver: forwardDriver },
  });
  assert.equal(session.registry.get("ae.tracker.readback"), null);
  assert.equal(session.registry.get("ae.tracker.two_point_transform"), null);
  assert.equal(session.registry.get("ae.tracker.four_point_perspective"), null);
  assert.equal(session.registry.get("ae.tracker.analysis.guarded_visual"), null);
});
