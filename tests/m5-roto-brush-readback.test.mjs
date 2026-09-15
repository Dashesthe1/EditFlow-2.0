import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_ROTO_BRUSH_ADAPTER_BUILD_V26,
  AE_ROTO_BRUSH_COMMANDS_V26,
  AE_ROTO_BRUSH_EFFECT_MATCH_NAME_V26,
  AE_ROTO_BRUSH_PROTOCOL_VERSION_V26,
  capabilityForRotoBrushCommandV26,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_6.js";
import {
  CepEvalScriptRotoBrushTransportV26,
  assertRotoBrushEffectIdentityV26,
  buildRotoBrushReadbackRequestV26,
  deriveRotoBrushSessionRevisionV26,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-readback.js";

const hostSource = () => readFile(new URL("../packages/adapters/ae-cep/host/editflow_host_m5_roto_brush.jsx", import.meta.url), "utf8");
const loaderSource = () => readFile(new URL("../packages/adapters/ae-cep/host/editflow_host_current_v26.jsx", import.meta.url), "utf8");
const request = () => buildRotoBrushReadbackRequestV26({
  requestId: "M5_ROTO_READ_1",
  transactionId: "M5_ROTO_TX_1",
  operationId: "M5_ROTO_OP_1",
  payload: { comp: { hostId: 10 }, layer: { hostId: 20 }, effectIndex: 1 },
});
const readback = (value = 10) => ({
  comp: { stableId: "COMP_ROTO", hostId: 10, name: "Roto Proof", width: 1920, height: 1080, time: 0.25 },
  layer: { stableId: "LAYER_ROTO", hostId: 20, name: "Subject", index: 1 },
  rotoBrushMatchName: "ADBE Samurai",
  effectMatchCount: 1,
  effect: {
    effectIndex: 1, name: "Roto Brush & Refine Edge", matchName: "ADBE Samurai", enabled: true, numProperties: 1,
    properties: [{ index: 1, name: "Propagation", matchName: "PROP", propertyType: 1, propertyValueType: 1, numProperties: 0, numKeys: 0, canSetExpression: false, expressionEnabled: null, value, children: [] }],
  },
  propertyNodeCount: 1,
  propertyTreeTruncated: false,
});
const response = (value = 10, hostProjectRevision = 77) => ({
  protocolVersion: "2.6.0", requestId: "M5_ROTO_READ_1", transactionId: "M5_ROTO_TX_1", operationId: "M5_ROTO_OP_1",
  capabilityId: "ae.roto_brush.session.inspect", command: "roto_brush.readback", outcome: "NO_OP", error: null,
  affectedObjects: [], readback: readback(value), hostProjectRevision,
  diagnostics: { adapterProtocolVersion: "2.6.0", adapterBuild: "0.6.0-dev.2", command: "roto_brush.readback", notes: [] },
});

test("protocol 2.6 is a single read-only Roto Brush discovery command", () => {
  assert.equal(AE_ROTO_BRUSH_PROTOCOL_VERSION_V26, "2.6.0");
  assert.equal(AE_ROTO_BRUSH_ADAPTER_BUILD_V26, "0.6.0-dev.2");
  assert.equal(AE_ROTO_BRUSH_EFFECT_MATCH_NAME_V26, "ADBE Samurai");
  assert.deepEqual(AE_ROTO_BRUSH_COMMANDS_V26, ["roto_brush.readback"]);
  assert.equal(capabilityForRotoBrushCommandV26("roto_brush.readback"), "ae.roto_brush.session.inspect");
  const built = request();
  assert.equal(built.expectedHostProjectRevision, null);
  assert.equal(built.readbackProfile, "M5_ROTO_BRUSH_SESSION_STRUCTURAL");
});

test("protocol 2.6 transport sends one fixed dispatcher call and preserves payload as data", async () => {
  let script = "";
  const bridge = { evalScript(value, callback) { script = value; callback(JSON.stringify(response())); } };
  const result = await new CepEvalScriptRotoBrushTransportV26(bridge).dispatch(request());
  assert.equal(result.outcome, "NO_OP");
  assert.match(script, /^EditFlow2_dispatch\(/);
  assert.match(script, /roto_brush\.readback/);
  assert.doesNotMatch(script, /eval\(|new Function|system\.callSystem/);
});

test("Roto Brush session revision is deterministic and binds host revision plus property truth", () => {
  const first = deriveRotoBrushSessionRevisionV26(response(10, 77));
  const same = deriveRotoBrushSessionRevisionV26(response(10, 77));
  const changedProperty = deriveRotoBrushSessionRevisionV26(response(11, 77));
  const changedHost = deriveRotoBrushSessionRevisionV26(response(10, 78));
  assert.equal(first, same);
  assert.notEqual(first, changedProperty);
  assert.notEqual(first, changedHost);
  assert.match(first, /^ROTO_V26_[0-9a-f]{64}$/);
});

test("exact Roto Brush identity gate refuses absence and ambiguity", () => {
  assert.doesNotThrow(() => assertRotoBrushEffectIdentityV26(response()));
  assert.throws(() => assertRotoBrushEffectIdentityV26({ ...response(), readback: { ...readback(), effectMatchCount: 0, effect: null } }), /identity/);
  assert.throws(() => assertRotoBrushEffectIdentityV26({ ...response(), readback: { ...readback(), effectMatchCount: 2 } }), /identity/);
});

test("protocol 2.6 host is bounded read-only structural discovery of ADBE Samurai", async () => {
  const source = await hostSource();
  assert.match(source, /ROTO_MATCH = "ADBE Samurai"/);
  assert.match(source, /MAX_DEPTH = 5/);
  assert.match(source, /MAX_NODES = 512/);
  assert.match(source, /property\("ADBE Effect Parade"\)/);
  assert.match(source, /AMBIGUOUS_ROTO_BRUSH_EFFECT/);
  assert.match(source, /Read-only bounded Roto Brush/);
  assert.doesNotMatch(source, /\.setValue\s*\(/);
  assert.doesNotMatch(source, /\.addProperty\s*\(/);
  assert.doesNotMatch(source, /\.remove\s*\(/);
  assert.doesNotMatch(source, /app\.project\.save|open\s*\(/);
});

test("protocol 2.6 loader is additive over accepted 2.5 and fails closed only for 2.6", async () => {
  const source = await loaderSource();
  assert.match(source, /editflow_host_current_v25\.jsx/);
  assert.match(source, /editflow_host_m5_roto_brush\.jsx/);
  assert.match(source, /request\.protocolVersion === "2\.6\.0"/);
  assert.match(source, /accepted protocol 1\.1-2\.5 dispatch remains available/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_26 = true/);
});