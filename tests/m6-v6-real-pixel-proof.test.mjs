import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

test("M6 v6 retains one real-AE professional shutter certification without overclaiming M6.9", async () => {
  const manifest = await readJson("proofs/manifests/m6-real-pixel-fidelity-v6.json");
  const pass = await readJson(manifest.certifiedRealAeCandidate.fidelity);
  const reference = await readJson(manifest.reference.evidence);
  const negativeCoordination = await readJson(manifest.retainedNegativeControls[0].fidelity);
  const negativeGeometry = await readJson(manifest.retainedNegativeControls[1].fidelity);

  assert.equal(manifest.schema, "editflow.m6.real-pixel-fidelity-manifest.v6");
  assert.equal(manifest.status, "SINGLE_CASE_PROFESSIONAL_FIDELITY_VERIFIED");
  assert.equal(manifest.certification.singleCaseProfessionalFidelityVerified, true);
  assert.equal(manifest.certification.fullM6ProfessionalBenchmarkVerified, false);
  assert.equal(manifest.certification.transferVerifiedForThisConstruction, false);
  assert.equal(manifest.certification.robust, false);
  assert.equal(pass.result, "CERTIFIED");
  assert.equal(pass.gate.certified, true);
  assert.equal(pass.comparison.definingCoverage, 1);
  assert.equal(pass.comparison.weightedFidelity, 1);
  assert.equal(pass.reference.analyzerFingerprint, pass.render.analyzerFingerprint);
  assert.equal(pass.reference.analyzerFingerprint, reference.analyzerFingerprint);
  assert.equal(pass.render.classifiedFamily, "SHUTTER_FRAGMENTATION");
  assert.equal(pass.render.shutterContract.shutter, true);

  for (const rejected of [negativeCoordination, negativeGeometry]) {
    assert.equal(rejected.result, "REJECTED");
    assert.equal(rejected.gate.certified, false);
    assert.ok(rejected.comparison.definingCoverage < 1);
  }
  assert.ok(negativeCoordination.gate.underDrivenInvariantIds.includes("shutter.coordination"));
  assert.ok(negativeGeometry.gate.underDrivenInvariantIds.includes("shutter.displacement"));

  assert.equal(
    await sha256(manifest.directAbEvidence.path),
    manifest.directAbEvidence.sha256,
    "retained A/B image must stay content-addressed",
  );
  assert.equal(manifest.proofGovernance.preservesLegacyEvidence, true);
  assert.match(manifest.milestones["M6.7"], /^PARTIAL_/);
  assert.ok(manifest.certification.openGates.length >= 3);
});
