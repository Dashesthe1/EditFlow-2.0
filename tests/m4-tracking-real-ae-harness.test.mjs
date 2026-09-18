import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m4-tracking-real-ae-cli.ts";

test("M4 real-AE tracker proof stays on authenticated typed CEP and fixed TIFF evidence", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /new LoopbackCepBroker/);
  assert.match(source, /new AeCepAdapterClientV11/);
  assert.match(source, /executePublic\("render\.capture"/);
  assert.match(source, /outputProfile: "TRACKING_TIFF_SEQUENCE_V1"/);
  assert.match(source, /readTiffGrayFrameV1/);
  assert.match(source, /trackPointV1/);
  assert.match(source, /M4_POINT_TRACK_REAL_AE_V1/);
  assert.doesNotMatch(source, /comp\.create/);
  assert.doesNotMatch(source, /layer\.add_media/);
  assert.doesNotMatch(source, /project\.save/);
});

test("M4 real-AE tracker proof fails closed on weak motion and does not self-promote visual or transfer maturity", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /selected\.track\.status === "STABLE"/);
  assert.match(source, /selected\.track\.confidence >= 0\.72/);
  assert.match(source, /selected\.displacement >= 0\.0025/);
  assert.match(source, /projectFingerprint === after\.observed\.projectFingerprint/);
  assert.match(source, /P3_visual_external_review: false/);
  assert.match(source, /P4_failure_recovery: false/);
  assert.match(source, /P5_transfer: false/);
  assert.match(source, /classification: ok \? "PASS" : "EVIDENCE_INSUFFICIENT"/);
});
