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
const maskForwardDriver = {
  driverId: "editgpt.eyes-hands.mask-tracking.v1", verifiedVision: true, verifiedCursorControl: true,
  supportedDirections: ["FORWARD"], async analyze() { return { status: "REFUSED" }; },
};
const forwardDriver = {
  driverId: "editgpt.eyes-hands.tracker.v1",
  verifiedVision: true,
  verifiedCursorControl: true,
  supportedDirections: ["FORWARD"],
  async analyze() { return { status: "REFUSED" }; },
};
const faceForwardDriver = {
  driverId: "editgpt.eyes-hands.face-tracking.v1", verifiedVision: true, verifiedCursorControl: true,
  supportedDirections: ["FORWARD"], async analyze() { return { status: "REFUSED" }; },
};
const stabilizationForwardDriver = {
  driverId: "editgpt.eyes-hands.stabilization.v1", verifiedVision: true, verifiedCursorControl: true,
  supportedDirections: ["FORWARD"], async stabilize() { return { status: "REFUSED" }; },
};
test("default desktop session does not silently expose unconfigured M4 tracking routes", async () => {
  const session = await createDesktopAeSession(adapter, "m4-default");
  assert.equal(session.registry.get("ae.tracker.readback"), null);
  assert.equal(session.registry.get("ae.tracker.two_point_transform"), null);
  assert.equal(session.registry.get("ae.tracker.four_point_perspective"), null);
  assert.equal(session.registry.get("ae.tracker.analysis.guarded_visual"), null);
  assert.equal(session.registry.get("ae.mask.tracking.guarded_visual"), null);
  assert.equal(session.registry.get("ae.face.readback"), null);
  assert.equal(session.registry.get("ae.face.tracking.detailed.guarded_visual"), null);
  assert.equal(session.registry.get("ae.stabilization.readback"), null);
  assert.equal(session.registry.get("ae.stabilization.position.guarded_visual"), null);
  assert.equal(session.registry.get("ae.tracker.repair.readback"), null);
  assert.equal(session.registry.get("ae.tracker.repair.feature_center.set"), null);
  assert.equal(session.registry.get("tracking.repair_resume.state"), null);
  assert.equal(session.registry.get("tracking.repair_resume.auto_escalate"), null);
  assert.equal(session.registry.get("tracking.repair_resume.auto_correct.plan"), null);
  const maskPointRepair = session.registry.get("tracking.mask_point_repair.plan");
  assert.ok(maskPointRepair);
  assert.equal(maskPointRepair.proofMaturity, "VISUAL");
  assert.equal(maskPointRepair.riskClass, "R0_READ_ONLY");
  assert.ok(maskPointRepair.routes.some((route) => route.kind === "SUBSYSTEM_ADAPTER" && route.available));
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


test("verified mask driver registers independently of protocol 2.1 point tracking", async () => {
  const session = await createDesktopAeSession(adapter, "m4-mask", {
    m4TrackerRuntime: { pointTrackingV21Available: false, visualDriver: null, maskVisualDriver: maskForwardDriver },
  });
  const mask = session.registry.get("ae.mask.tracking.guarded_visual");
  assert.ok(mask);
  assert.equal(mask.proofMaturity, "VISUAL");
  assert.ok(mask.routes.some((route) => route.kind === "GUARDED_UI" && route.available));
  assert.equal(session.registry.get("ae.tracker.readback"), null);
});


test("protocol 2.2 face truth and Detailed Features register independently of point protocol 2.1", async () => {
  const readbackOnly = await createDesktopAeSession(adapter, "m4-face-readback", {
    m4TrackerRuntime: { pointTrackingV21Available: false, visualDriver: null, faceTrackingV22Available: true, faceVisualDriver: null },
  });
  const faceReadback = readbackOnly.registry.get("ae.face.readback");
  assert.ok(faceReadback);
  assert.equal(faceReadback.proofMaturity, "STRUCTURAL");
  assert.ok(faceReadback.routes.some((route) => route.kind === "HOST_ADAPTER" && route.available));
  assert.equal(readbackOnly.registry.get("ae.face.tracking.detailed.guarded_visual"), null);
  assert.equal(readbackOnly.registry.get("ae.tracker.readback"), null);

  const live = await createDesktopAeSession(adapter, "m4-face-live", {
    m4TrackerRuntime: { pointTrackingV21Available: false, visualDriver: null, faceTrackingV22Available: true, faceVisualDriver: faceForwardDriver },
  });
  const face = live.registry.get("ae.face.tracking.detailed.guarded_visual");
  assert.ok(face);
  assert.equal(face.proofMaturity, "VISUAL");
  assert.ok(face.routes.some((route) => route.kind === "GUARDED_UI" && route.available));
  assert.equal(live.registry.get("ae.tracker.readback"), null);
});

test("face visual proof cannot register without protocol 2.2 readback", async () => {
  const session = await createDesktopAeSession(adapter, "m4-face-no-v22", {
    m4TrackerRuntime: { pointTrackingV21Available: false, visualDriver: null, faceTrackingV22Available: false, faceVisualDriver: faceForwardDriver },
  });
  assert.equal(session.registry.get("ae.face.readback"), null);
  assert.equal(session.registry.get("ae.face.tracking.detailed.guarded_visual"), null);
});


test("protocol 2.3 stabilization truth and guarded Position route register only when explicitly available", async () => {
  const readbackOnly = await createDesktopAeSession(adapter, "m4-stabilization-readback", {
    m4TrackerRuntime: { stabilizationV23Available: true, stabilizationVisualDriver: null },
  });
  const readback = readbackOnly.registry.get("ae.stabilization.readback");
  assert.ok(readback);
  assert.equal(readback.proofMaturity, "STRUCTURAL");
  assert.ok(readback.routes.some((route) => route.kind === "HOST_ADAPTER" && route.available));
  assert.equal(readbackOnly.registry.get("ae.stabilization.position.guarded_visual"), null);

  const live = await createDesktopAeSession(adapter, "m4-stabilization-live", {
    m4TrackerRuntime: { stabilizationV23Available: true, stabilizationVisualDriver: stabilizationForwardDriver },
  });
  const stabilization = live.registry.get("ae.stabilization.position.guarded_visual");
  assert.ok(stabilization);
  assert.equal(stabilization.proofMaturity, "VISUAL");
  assert.ok(stabilization.routes.some((route) => route.kind === "GUARDED_UI" && route.available));
});

test("stabilization visual proof cannot register without protocol 2.3 readback", async () => {
  const session = await createDesktopAeSession(adapter, "m4-stabilization-no-v23", {
    m4TrackerRuntime: { stabilizationV23Available: false, stabilizationVisualDriver: stabilizationForwardDriver },
  });
  assert.equal(session.registry.get("ae.stabilization.readback"), null);
  assert.equal(session.registry.get("ae.stabilization.position.guarded_visual"), null);
});

test("protocol 2.4 tracker repair registers only when explicitly available", async () => {
  const session = await createDesktopAeSession(adapter, "m4-tracker-repair", {
    m4TrackerRuntime: { pointTrackingV21Available: false, visualDriver: null, trackerRepairV24Available: true },
  });
  const readback = session.registry.get("ae.tracker.repair.readback");
  const write = session.registry.get("ae.tracker.repair.feature_center.set");
  assert.ok(readback);
  assert.ok(write);
  assert.equal(readback.proofMaturity, "STRUCTURAL");
  assert.equal(write.proofMaturity, "ROLLBACK");
  assert.ok(readback.routes.some((route) => route.kind === "HOST_ADAPTER" && route.available));
  assert.ok(write.routes.some((route) => route.kind === "HOST_ADAPTER" && route.available));
  assert.equal(write.riskClass, "R1_REVERSIBLE");
  assert.equal(session.registry.get("ae.tracker.readback"), null);
  assert.equal(session.registry.get("tracking.repair_resume.auto_escalate"), null);
  assert.equal(session.registry.get("tracking.repair_resume.auto_correct.plan"), null);
});

test("repair/resume state registers only with protocol 2.4 plus verified point analysis", async () => {
  const session = await createDesktopAeSession(adapter, "m4-tracker-repair-resume", {
    m4TrackerRuntime: {
      pointTrackingV21Available: true,
      visualDriver: forwardDriver,
      trackerRepairV24Available: true,
    },
  });
  const repair = session.registry.get("tracking.repair_resume.state");
  const automatic = session.registry.get("tracking.repair_resume.auto_escalate");
  const autoCorrect = session.registry.get("tracking.repair_resume.auto_correct.plan");
  assert.ok(repair);
  assert.ok(automatic);
  assert.equal(repair.status, "PARTIAL");
  assert.equal(repair.proofMaturity, "VISUAL");
  assert.ok(repair.routes.some((route) => route.kind === "SUBSYSTEM_ADAPTER" && route.available));
  assert.equal(repair.visualProofProfile, "M4_TRACKER_REPAIR_RESUME_BIDIRECTIONAL_VISUAL");
  assert.ok(repair.limitations.some((value) => value.includes("Analyze Forward and Analyze Backward")));
  assert.equal(automatic.proofMaturity, "STRUCTURAL");
  assert.equal(automatic.riskClass, "R0_READ_ONLY");
  assert.ok(automatic.routes.some((route) => route.kind === "SUBSYSTEM_ADAPTER" && route.available));
  assert.ok(autoCorrect);
  assert.equal(autoCorrect.proofMaturity, "STRUCTURAL");
  assert.equal(autoCorrect.riskClass, "R0_READ_ONLY");
  assert.ok(autoCorrect.routes.some((route) => route.kind === "SUBSYSTEM_ADAPTER" && route.available));
});
