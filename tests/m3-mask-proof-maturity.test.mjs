import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  M3_MASK_P1_P2_ACCEPTED_SOURCE_COMMIT,
  M3_MASK_P1_P2_ACCEPTANCE_ARTIFACT,
  M3_MASK_P1_P2_ACCEPTANCE_RUN,
  applyM3MaskAcceptedP1P2Evidence,
  m3MaskP1P2MaturityForCapability,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-mask-proof-maturity.js";
import { M3_MASK_CAPABILITIES_V12 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-mask.js";

const manifestPath = "proofs/manifests/m3-mask-p1-p2.json";
const foundationPath = "docs/12_M3_MASK_BEZIER_FOUNDATION.md";

const expectedCapabilities = [
  "ae.mask.create",
  "ae.mask.remove",
  "ae.mask.duplicate",
  "ae.mask.order.set",
  "ae.mask.path.set",
  "ae.mask.properties.set",
  "ae.mask.readback",
];

test("M3 mask structural maturity is pinned to the accepted real-AE source, run and artifact", () => {
  assert.equal(M3_MASK_P1_P2_ACCEPTED_SOURCE_COMMIT, "8a1c499ac26344e2199fa2fa816d4565769c312c");
  assert.equal(M3_MASK_P1_P2_ACCEPTANCE_RUN, 34045287361);
  assert.equal(M3_MASK_P1_P2_ACCEPTANCE_ARTIFACT, 9992921389);
  for (const capabilityId of expectedCapabilities) {
    assert.equal(m3MaskP1P2MaturityForCapability(capabilityId), "STRUCTURAL");
  }
  assert.equal(m3MaskP1P2MaturityForCapability("ae.mask.future.unproven"), "DECLARED");
});

test("accepted P1/P2 evidence cannot promote a mask capability to FULL", () => {
  const promoted = applyM3MaskAcceptedP1P2Evidence([
    {
      id: "ae.mask.future.unproven",
      domain: "mask",
      description: "test",
      status: "FULL",
      proofMaturity: "ROBUST",
      routes: [],
      readbackStrategy: null,
      visualProofProfile: null,
      rollbackStrategy: null,
      riskClass: "R0_READ_ONLY",
      fallbackPolicy: "FORBID",
    },
  ]);
  assert.equal(promoted[0].status, "PARTIAL");
  assert.equal(promoted[0].proofMaturity, "DECLARED");

  for (const capability of M3_MASK_CAPABILITIES_V12) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "STRUCTURAL");
  }
});

test("M3 P1/P2 acceptance manifest records exact bounded proof scope and limitations", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.proof_id, "M3_MASK_P1_P2_REAL_AE");
  assert.equal(manifest.status, "ACCEPTED");
  assert.equal(manifest.accepted_source_commit, M3_MASK_P1_P2_ACCEPTED_SOURCE_COMMIT);
  assert.equal(manifest.evidence.real_ae_p1_p2.run_id, M3_MASK_P1_P2_ACCEPTANCE_RUN);
  assert.equal(manifest.evidence.real_ae_p1_p2.artifact_id, M3_MASK_P1_P2_ACCEPTANCE_ARTIFACT);
  assert.equal(manifest.evidence.real_ae_p1_p2.verdict, "PASS");
  assert.equal(manifest.evidence.real_ae_p1_p2.cleanup_complete, true);
  assert.deepEqual(manifest.evidence.real_ae_p1_p2.proof_levels, {
    P1_validation_rejection: true,
    P2_structural_readback: true,
    P3_visual_proof: false,
    P4_failure_injection_rollback: false,
    P5_save_reopen_reconnect_transfer: false,
  });
  assert.deepEqual(
    manifest.capability_evidence.map((entry) => [entry.capability, entry.proof_maturity]),
    expectedCapabilities.map((capability) => [capability, "STRUCTURAL"]),
  );
  assert.match(manifest.closure_rule, /remain PARTIAL at STRUCTURAL/);
  assert.match(manifest.closure_rule, /FULL is reserved for P5-or-higher/);
  assert.ok(manifest.evidence.real_ae_p1_p2.notes.some((note) => /Variable-feather arrays/.test(note)));
  assert.ok(manifest.evidence.real_ae_p1_p2.notes.some((note) => /idempotency semantics/.test(note)));
});

test("M3 foundation documentation links accepted evidence without overclaiming higher proof levels", async () => {
  const source = await readFile(foundationPath, "utf8");
  assert.match(source, /34045287361/);
  assert.match(source, /9992921389/);
  assert.match(source, /8a1c499ac26344e2199fa2fa816d4565769c312c/);
  assert.match(source, /`PARTIAL` \+ `STRUCTURAL`/);
  assert.match(source, /P3 visual proof: false/);
  assert.match(source, /P4 failure-injection rollback: false/);
  assert.match(source, /P5 save\/reopen\/reconnect transfer: false/);
  assert.match(source, /Variable-feather arrays remain/);
  assert.match(source, /repeat\/idempotency semantics/);
  assert.match(source, /`FULL` remains forbidden until P5/);
});
