import test from "node:test";
import assert from "node:assert/strict";

import { GuardedRotoBrushExportControllerV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-export-controller.js";

const target = { compHostId: 10, layerHostId: 20, expectedCompName: "Roto Proof", expectedLayerName: "Subject" };
const atom = (name, value) => ({
  index: 1, name, matchName: "ADBE Paint Atom", propertyType: 2, propertyValueType: null,
  numProperties: 0, numKeys: 0, canSetExpression: false, expressionEnabled: null, value, children: [],
});
const rotoValue = (layerHostId = 20, strokes = ["seed"]) => ({
  comp: { stableId: "COMP", hostId: 10, name: "Roto Proof", width: 1920, height: 1080, time: 0.5 },
  layer: { stableId: layerHostId === 20 ? null : "M5_ROTO_TRACK_MATTE_001", hostId: layerHostId, name: layerHostId === 20 ? "Subject" : "Subject 2", index: layerHostId === 20 ? 1 : 2 },
  rotoBrushMatchName: "ADBE Samurai", effectMatchCount: 1,
  effect: { effectIndex: 1, name: "Roto Brush & Refine Edge", matchName: "ADBE Samurai", enabled: true,
    numProperties: 1, properties: [{ index: 1, name: "Strokes", matchName: "ADBE Samurai Strokes Group",
      propertyType: 1, propertyValueType: 1, numProperties: strokes.length, numKeys: 0,
      canSetExpression: false, expressionEnabled: null, value: null,
      children: strokes.map((value, index) => atom(`Foreground ${index + 1}`, value)) }] },
  propertyNodeCount: strokes.length + 1, propertyTreeTruncated: false,
});
const rotoResponse = (readback, revision = 10) => ({
  protocolVersion: "2.6.0", requestId: "IGNORED", transactionId: "IGNORED", operationId: "IGNORED",
  capabilityId: "ae.roto_brush.session.inspect", command: "roto_brush.readback", outcome: "NO_OP", error: null,
  affectedObjects: [], readback, hostProjectRevision: revision,
  diagnostics: { adapterProtocolVersion: "2.6.0", adapterBuild: "0.6.0-dev.2", command: "roto_brush.readback", notes: [] },
});
const layer = (hostId, stableId = null) => ({
  hostId, stableId, index: hostId === 20 ? 1 : 2, name: hostId === 20 ? "Subject" : "Subject 2", kind: "LAYER_AV",
  sourceHostId: 5, sourceStableId: "MEDIA_1", startTime: 0, inPoint: 0, outPoint: 2, stretch: 100,
  parentStableId: null, transform: { anchorPoint: [960, 540], position: [960, 540], scale: [100, 100], rotation: 0, opacity: 100 },
  enabled: true, locked: false, shy: false, solo: false, threeDLayer: false, adjustmentLayer: false,
});
const project = (layers, hostRevision = 20) => ({
  hostRevision, filePath: null, activeItemHostId: 10, itemCount: 2,
  items: [{ hostId: 10, stableId: "COMP", kind: "COMPOSITION", name: "Roto Proof", parentHostId: null, comment: "",
    composition: { hostId: 10, stableId: "COMP", name: "Roto Proof", width: 1920, height: 1080, pixelAspect: 1,
      duration: 2, frameRate: 30, displayStartTime: 0, layers } }],
});
const inspectResponse = (snapshot) => ({
  protocolVersion: "1.1.0", requestId: "IGNORED", transactionId: "IGNORED", operationId: "IGNORED",
  capabilityId: "ae.project.inspect", command: "project.inspect", outcome: "NO_OP", error: null,
  affectedObjects: [], readback: null, projectSnapshot: snapshot, environmentProbe: null,
  hostProjectRevision: snapshot.hostRevision,
  diagnostics: { adapterProtocolVersion: "1.1.0", adapterBuild: "0.1.0-dev.3", command: "project.inspect", durationMs: 2 }, proofArtifactRefs: [],
});
const duplicateResponse = () => ({
  protocolVersion: "1.1.0", requestId: "IGNORED", transactionId: "IGNORED", operationId: "IGNORED",
  capabilityId: "ae.layer.duplicate", command: "layer.duplicate", outcome: "APPLIED", error: null,
  affectedObjects: [{ stableId: "M5_ROTO_TRACK_MATTE_001", hostId: 21, kind: "LAYER_AV" }],
  readback: { layer: layer(21, "M5_ROTO_TRACK_MATTE_001") }, projectSnapshot: null, environmentProbe: null,
  hostProjectRevision: 21,
  diagnostics: { adapterProtocolVersion: "1.1.0", adapterBuild: "0.1.0-dev.3", command: "layer.duplicate", durationMs: 7 }, proofArtifactRefs: [],
});
const transport = ({ roto, host }) => {
  let ri = 0; let hi = 0;
  return {
    rotoCalls: [], hostCalls: [],
    async dispatchRoto(request) { this.rotoCalls.push(request); const value = roto[Math.min(ri++, roto.length - 1)]; return { ...value, requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId }; },
    async dispatchHost(request) { this.hostCalls.push(request); const value = host[Math.min(hi++, host.length - 1)]; return { ...value, requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId, capabilityId: request.capabilityId, command: request.command }; },
  };
};
const runInput = (kind = "TRACK_MATTE") => ({ ...target, export: { kind, stableId: "M5_ROTO_TRACK_MATTE_001" }, evidenceIds: ["M5:ROTO:EXPORT:001"] });

test("TRACK_MATTE export duplicates the exact Roto-isolated layer into one stable output identity", async () => {
  const io = transport({
    roto: [rotoResponse(rotoValue(20)), rotoResponse(rotoValue(21), 21)],
    host: [inspectResponse(project([layer(20)])), duplicateResponse(), inspectResponse(project([layer(21, "M5_ROTO_TRACK_MATTE_001"), layer(20)], 21))],
  });
  const result = await new GuardedRotoBrushExportControllerV1(io).run(runInput());
  assert.equal(result.route, "LOCAL");
  assert.equal(result.exportKind, "TRACK_MATTE");
  assert.equal(result.outputLayerHostId, 21);
  assert.equal(result.structuralOutputVerified, true);
  assert.equal(result.nativeRotoOutputVerified, true);
  assert.equal(result.baselineEffectFingerprint, result.outputEffectFingerprint);
  assert.equal(result.hostMutationDurationMs, 7);
  assert.equal(io.hostCalls[1].command, "layer.duplicate");
  assert.equal(io.hostCalls[1].expectedHostProjectRevision, 20);
  assert.equal(io.hostCalls[1].payload.stableId, "M5_ROTO_TRACK_MATTE_001");
});

test("MASK export remains fail-closed until a real mask conversion route is proven", async () => {
  const io = transport({ roto: [rotoResponse(rotoValue(20))], host: [] });
  const result = await new GuardedRotoBrushExportControllerV1(io).run(runInput("MASK"));
  assert.equal(result.route, "ESCALATE");
  assert.equal(result.escalationReason, "EXPORT_KIND_UNPROVEN");
  assert.equal(io.hostCalls.length, 0);
});

test("export refuses output stable-id collisions before duplication", async () => {
  const io = transport({
    roto: [rotoResponse(rotoValue(20))],
    host: [inspectResponse(project([layer(21, "M5_ROTO_TRACK_MATTE_001"), layer(20)]))],
  });
  const result = await new GuardedRotoBrushExportControllerV1(io).run(runInput());
  assert.equal(result.escalationReason, "OUTPUT_ID_COLLISION");
  assert.equal(io.hostCalls.length, 1);
});

test("export refuses a duplicate whose transform or visibility structure drifts from the source", async () => {
  const drifted = { ...layer(21, "M5_ROTO_TRACK_MATTE_001"), transform: { ...layer(21).transform, position: [999, 540] }, shy: true };
  const io = transport({
    roto: [rotoResponse(rotoValue(20))],
    host: [inspectResponse(project([layer(20)])), duplicateResponse(), inspectResponse(project([drifted, layer(20)], 21))],
  });
  const result = await new GuardedRotoBrushExportControllerV1(io).run(runInput());
  assert.equal(result.escalationReason, "OUTPUT_STRUCTURE_MISMATCH");
  assert.equal(result.structuralOutputVerified, false);
  assert.equal(io.rotoCalls.length, 1);
});

test("export refuses a duplicate whose native Roto fingerprint differs from the source", async () => {
  const io = transport({
    roto: [rotoResponse(rotoValue(20)), rotoResponse(rotoValue(21, ["seed", "different"]), 21)],
    host: [inspectResponse(project([layer(20)])), duplicateResponse(), inspectResponse(project([layer(21, "M5_ROTO_TRACK_MATTE_001"), layer(20)], 21))],
  });
  const result = await new GuardedRotoBrushExportControllerV1(io).run(runInput());
  assert.equal(result.escalationReason, "OUTPUT_ROTO_MISMATCH");
  assert.equal(result.structuralOutputVerified, true);
  assert.equal(result.nativeRotoOutputVerified, false);
});
