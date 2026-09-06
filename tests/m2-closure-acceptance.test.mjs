import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getMcpServerStatus } from "../.tmp/runtime/apps/mcp-server/src/index.js";
import { AE_CEP_PUBLIC_CAPABILITIES_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import {
  M2_ACCEPTED_SOURCE_COMMIT,
  M2_P4_P5_ACCEPTANCE_RUN,
  M2_REAL_AE_ACCEPTANCE_RUN,
  applyM2AcceptedProofEvidence,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m2-proof-maturity.js";

test("M2 MCP status exposes the accepted real-AE baseline and enables Adobe writes", () => {
  const status = getMcpServerStatus();
  assert.equal(status.version, "0.3.0-dev");
  assert.equal(status.phase, "M2_ADOBE_HOST_BASELINE_ACCEPTED");
  assert.equal(status.adobeWritesEnabled, true);
  assert.equal(status.cepRuntimeBridge, "REAL_AE_PROVEN");
  assert.equal(status.cepBrokerBinding, "127.0.0.1_AUTHENTICATED");
  assert.equal(status.realAeAcceptance, "P1_P5_ACCEPTED");
  assert.equal(status.restartRecovery, "COMMITTED_BOUNDARY_RESUME");
});

test("every public AE protocol 1.1 capability receives explicit M2 evidence maturity", () => {
  const promoted = applyM2AcceptedProofEvidence(AE_CEP_PUBLIC_CAPABILITIES_V11);
  assert.equal(promoted.length, AE_CEP_PUBLIC_CAPABILITIES_V11.length);
  assert.ok(promoted.every((capability) => capability.proofMaturity !== "DECLARED"));

  for (const capability of promoted) {
    if (capability.proofMaturity === "TRANSFER" || capability.proofMaturity === "ROBUST") {
      assert.equal(capability.status, "FULL", `${capability.id} has P5+ evidence and must be FULL`);
    } else {
      assert.equal(capability.status, "PARTIAL", `${capability.id} is below P5 and must remain PARTIAL`);
    }
  }
});

test("M2 maturity map keeps visual, rollback, structural and transfer evidence distinct", () => {
  const promoted = new Map(
    applyM2AcceptedProofEvidence(AE_CEP_PUBLIC_CAPABILITIES_V11)
      .map((capability) => [String(capability.id), capability]),
  );

  assert.equal(promoted.get("ae.layer.transform.set")?.proofMaturity, "VISUAL");
  assert.equal(promoted.get("ae.render.capture")?.proofMaturity, "VISUAL");
  assert.equal(promoted.get("ae.media.import")?.proofMaturity, "ROLLBACK");
  assert.equal(promoted.get("ae.transaction.undo_last")?.proofMaturity, "ROLLBACK");
  assert.equal(promoted.get("ae.comp.settings.set")?.proofMaturity, "STRUCTURAL");
  assert.equal(promoted.get("ae.expression.set")?.proofMaturity, "STRUCTURAL");
  assert.equal(promoted.get("ae.project.save")?.proofMaturity, "TRANSFER");
  assert.equal(promoted.get("ae.layer.duplicate")?.proofMaturity, "TRANSFER");
  assert.equal(promoted.get("ae.precompose.layers")?.proofMaturity, "TRANSFER");
  assert.equal(promoted.get("ae.object.readback")?.proofMaturity, "TRANSFER");
});

test("M2 accepted evidence constants point to the authoritative source and host runs", () => {
  assert.equal(M2_ACCEPTED_SOURCE_COMMIT, "8d5f8ddf0143ce0e1ec33cff14269ecab8769d60");
  assert.equal(M2_REAL_AE_ACCEPTANCE_RUN, 34022332767);
  assert.equal(M2_P4_P5_ACCEPTANCE_RUN, 34013038916);
});

test("M2 manifest is accepted and records both real-AE evidence families", async () => {
  const manifest = JSON.parse(await readFile("proofs/manifests/m2-ae-host-baseline.json", "utf8"));
  assert.equal(manifest.status, "ACCEPTED");
  assert.equal(manifest.milestone_version, "0.3.0-dev");
  assert.equal(manifest.accepted_source_commit, M2_ACCEPTED_SOURCE_COMMIT);
  assert.equal(manifest.evidence.authenticated_real_ae.run_id, M2_REAL_AE_ACCEPTANCE_RUN);
  assert.equal(manifest.evidence.authenticated_real_ae.final_baseline_status, "PASS");
  assert.equal(manifest.evidence.dedicated_p4_p5.run_id, M2_P4_P5_ACCEPTANCE_RUN);
  assert.equal(manifest.evidence.dedicated_p4_p5.verdict, "PASS");
});

test("root metadata and README no longer advertise pre-M2 phase state", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const readme = await readFile("README.md", "utf8");
  assert.equal(pkg.version, "0.3.0-dev");
  assert.match(readme, /M2 — Adobe Host Baseline: accepted/);
  assert.match(readme, /M3 — Human-Parity Core/);
  assert.doesNotMatch(readme, /Phase 0 — Clean-room architecture/);
});
