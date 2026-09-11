import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AE_POINT_TRACKING_ADAPTER_BUILD_V21,
  AE_POINT_TRACKING_COMMANDS_V21,
  AE_POINT_TRACKING_PROTOCOL_VERSION_V21,
  AE_POINT_TRACKING_ROUTE_ID_V21,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_1.js";
import {
  CepEvalScriptPointTrackingTransportV21,
  M4_POINT_TRACKING_CAPABILITIES_V21,
  buildPointTrackingRequestV21,
  trackerReadbackToSubjectObservationsV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-point-tracking.js";
import { TrackingStateReducerV1 } from "../.tmp/runtime/packages/tracking-state/src/index.js";

test("M4 point tracking protocol 2.1 begins read-only and unpromoted", () => {
  assert.equal(AE_POINT_TRACKING_PROTOCOL_VERSION_V21, "2.1.0");
  assert.equal(AE_POINT_TRACKING_ADAPTER_BUILD_V21, "0.5.0-dev.1");
  assert.equal(AE_POINT_TRACKING_ROUTE_ID_V21, "ae-cep.point-tracking.v2_1");
  assert.deepEqual([...AE_POINT_TRACKING_COMMANDS_V21], ["tracker.readback"]);
  assert.equal(M4_POINT_TRACKING_CAPABILITIES_V21.length, 1);
  assert.equal(M4_POINT_TRACKING_CAPABILITIES_V21[0].riskClass, "R0_READ_ONLY");
  assert.equal(M4_POINT_TRACKING_CAPABILITIES_V21[0].proofMaturity, "DECLARED");
});
test("point-tracking transport serializes payload as data in one dispatcher call", async () => {
  let captured = "";
  const request = buildPointTrackingRequestV21({
    requestId: "REQ_TRACK", transactionId: "TX_TRACK", operationId: "OP_TRACK", command: "tracker.readback",
    payload: { comp: { stableId: "COMP\"); evil() //" }, layer: { stableId: "LAYER" } },
  });
  const bridge = { evalScript(script, callback) {
    captured = script;
    callback(JSON.stringify({
      protocolVersion: "2.1.0", requestId: "REQ_TRACK", transactionId: "TX_TRACK", operationId: "OP_TRACK",
      capabilityId: "ae.tracker.readback", command: "tracker.readback", outcome: "NO_OP", error: null,
      affectedObjects: [], readback: { comp: { stableId: "COMP", hostId: 1, name: "C", width: 100, height: 100 }, layer: { stableId: "LAYER", hostId: 2, name: "L", index: 1 }, trackers: [] },
      hostProjectRevision: 0, diagnostics: { adapterProtocolVersion: "2.1.0", adapterBuild: "0.5.0-dev.1", command: "tracker.readback", notes: [] },
    }));
  } };
  const response = await new CepEvalScriptPointTrackingTransportV21(bridge).dispatch(request);
  assert.equal(response.outcome, "NO_OP");
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
});
test("tracker samples convert into reducer-ready subject observations", () => {
  const readback = {
    comp: { stableId: "COMP", hostId: 1, name: "Comp", width: 1000, height: 500 },
    layer: { stableId: "LAYER", hostId: 2, name: "Footage", index: 1 },
    trackers: [{ trackerIndex: 1, name: "Tracker 1", matchName: "ADBE MTracker", points: [{
      pointIndex: 1, name: "Track Point 1", matchName: "ADBE MTracker Pt", keyedSampleCount: 2,
      samples: [
        { time: 0, featureCenter: [400, 250], featureSize: [100, 80], searchOffset: [0, 0], searchSize: [160, 140], confidence: 0.95, attachPoint: [400, 250], attachPointOffset: [0, 0], compPoint: [400, 250], compNormalized: [0.4, 0.5] },
        { time: 0.5, featureCenter: [600, 250], featureSize: [100, 80], searchOffset: [0, 0], searchSize: [160, 140], confidence: 0.9, attachPoint: [600, 250], attachPointOffset: [0, 0], compPoint: [600, 250], compNormalized: [0.6, 0.5] },
      ],
    }] }],
  };
  const observations = trackerReadbackToSubjectObservationsV1(readback, "SUBJECT_PETER");
  assert.equal(observations.length, 2);
  assert.equal(observations[0].x, 0.4);
  assert.equal(observations[1].timestampMs, 500);
  assert.equal(observations[1].confidence, 0.9);
  const reducer = new TrackingStateReducerV1();
  assert.ok(reducer.update(observations[0]));
  const estimate = reducer.update(observations[1]);
  assert.ok(estimate && estimate.velocityX > 0);
});
test("protocol 2.1 host reads tracker properties without creating or analyzing them", async () => {
  const source = await readFile("packages/adapters/ae-cep/host/editflow_host_m4_point_tracking.jsx", "utf8");
  for (const token of [
    'layer.property("ADBE MTrackers")',
    '"ADBE MTracker"',
    '"ADBE MTracker Pt"',
    '"ADBE MTracker Pt Feature Center"',
    '"ADBE MTracker Pt Confidence"',
    '"ADBE MTracker Pt Attach Pt"',
    "sourcePointToComp",
    "comp.time = oldTime",
  ]) assert.ok(source.includes(token), `host missing ${token}`);
  assert.equal(source.includes("addProperty("), false);
  assert.equal(source.includes("executeCommand("), false);
  assert.equal(source.includes("beginUndoGroup("), false);
});

test("v21 loader is additive over accepted v20 and fails closed only for 2.1", async () => {
  const source = await readFile("packages/adapters/ae-cep/host/editflow_host_current_v21.jsx", "utf8");
  assert.ok(source.includes("editflow_host_current_v20.jsx"));
  assert.ok(source.includes("editflow_host_m4_point_tracking.jsx"));
  assert.ok(source.includes("M4_POINT_TRACKING_MODULE_LOAD_FAILED"));
  assert.ok(source.includes('request.protocolVersion === "2.1.0"'));
  assert.ok(source.includes("EditFlow2_HOST_PROTOCOL_21 = true"));
});
test("loopback broker compiles 2.1 only when explicitly requested", async () => {
  const { LoopbackCepBroker } = await import("../.tmp/runtime/apps/desktop-host/src/loopback-cep.js");
  const defaultBroker = new LoopbackCepBroker({ port: 0, token: "x".repeat(32) });
  assert.deepEqual([...defaultBroker.options.supportedProtocolVersions], ["1.1.0"]);
  const previewBroker = new LoopbackCepBroker({
    port: 0,
    token: "y".repeat(32),
    supportedProtocolVersions: ["2.1.0", "2.0.0"],
  });
  assert.deepEqual([...previewBroker.options.supportedProtocolVersions], ["2.1.0", "2.0.0"]);
});

test("M4 live proof is reversible and never saves or closes the user project", async () => {
  const source = await readFile("scripts/windows/m4-point-tracking-v21-live-proof.jsx", "utf8");
  assert.ok(source.includes('baselineTrackers !== 0'));
  assert.ok(source.includes('app.beginUndoGroup("EditFlow M4 point-tracking live proof")'));
  assert.ok(source.includes("app.executeCommand(16)"));
  assert.ok(source.includes("trackerRollbackExact"));
  assert.ok(source.includes("itemCountRestored"));
  assert.equal(source.includes("app.project.save"), false);
  assert.equal(source.includes("app.project.close"), false);
});
