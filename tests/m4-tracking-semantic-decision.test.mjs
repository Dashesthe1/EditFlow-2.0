import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m4-tracking-semantic-decision-cli.ts";

test("M4 semantic stage uses official track readback and never invents identity or extent", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /applyPointTrackToEditorSubjectV1/);
  assert.match(source, /validateEditorSubjectStateV1/);
  assert.match(source, /label: "Unclassified tracked feature"/);
  assert.match(source, /identityConfidence: 0/);
  assert.match(source, /geometryConfidence: 0/);
  assert.match(source, /scale: 0/);
  assert.match(source, /heroSubjectId: null/);
  assert.match(source, /status: "ADAPTER_REQUIRED"/);
  assert.match(source, /proofMaturity: "STRUCTURAL"/);
  assert.match(source, /available: false/);
});

test("M4 semantic stage requires Editor Brain v1 to fail closed on unclassified point evidence", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /new EditorBrainV1\(new EditorBrainV0\(\)\)\.decide/);
  assert.match(source, /decision\.route === "ESCALATE"/);
  assert.match(source, /decision\.intent === "DELEGATE_V0"/);
  assert.match(source, /decision\.escalationReason === "LOW_OBJECT_CONFIDENCE"/);
  assert.match(source, /decision\.delegatedDecisionV0 === null/);
  assert.match(source, /decision\.delegatedStateV0 === null/);
  assert.match(source, /noAeMutationExecuted: true/);
  assert.match(source, /maturityImpact: "NONE_UNTIL_PARENT_AUTHENTICATED_LIVE_ACCEPTANCE_AND_LATER_VISUAL_RECOVERY_TRANSFER_GATES"/);
});

test("M4 semantic stage refuses to run from anything except a passing retained parent tracking result", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /trackingReport\["proofId"\] !== "M4_POINT_TRACK_REAL_AE_V1"/);
  assert.match(source, /trackingReport\["ok"\] !== true/);
  assert.match(source, /trackingReport\["classification"\] !== "PASS"/);
  assert.match(source, /track\["targetEntityId"\] !== "M4_REAL_AE_PROOF_FEATURE"/);
  assert.match(source, /track\["status"\] !== "STABLE"/);
  assert.match(source, /track\["confidence"\].*0\.72/);
});
