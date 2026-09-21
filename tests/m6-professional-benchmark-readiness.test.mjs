import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

test("M6.9 retained readiness binds canonical shutter Level 6 to independent professional proof", async () => {
  const manifest = await load("proofs/manifests/m6-professional-benchmark-readiness-v1.json");
  assert.equal(manifest.status, "IN_PROGRESS");
  assert.equal(manifest.canonicalCaseCount, 24);
  assert.equal(manifest.result.passed, false);
  assert.equal(manifest.result.passedCases, 1);
  assert.equal(manifest.result.failures.length, 23);
  const shutter = manifest.retainedCases.find((item) => item.caseId === "m6:shutter_fragmentation:canonical");
  assert.equal(shutter?.achievedLevel, "PROFESSIONAL_FIDELITY_VERIFIED");
  assert.equal(shutter?.maturityProof.professionalCasePassCount, 2);
  assert.deepEqual(manifest.nextRequiredForShutterCanonical, []);
  const ref = shutter?.professionalCaseEvidenceRefs?.[0];
  const artifact = manifest.artifacts.find((item) => item.ref === ref);
  assert.equal(artifact?.kind, "PROFESSIONAL_CASE_PROOF");
  assert.equal(artifact?.certified, true);
  assert.equal(artifact?.definingCoverage, 1);
  assert.ok(artifact?.weightedFidelity > 0.99);
  assert.equal(artifact?.sha256, await sha256(ref));
});

test("M6.9 benchmark inventory keeps retained benchmark references isolated from live correction fixtures", async () => {
  const manifest = await load("proofs/manifests/m6-professional-benchmark-readiness-v1.json");
  const liveCanonical = await load("proofs/m6/references/shutter_fragmentation-canonical.json");
  const liveProof = await load("proofs/diagnostics/m6-shutter-measurement-v17-proof.json");
  const referenceArtifact = manifest.artifacts.find((item) =>
    item.caseId === "m6:shutter_fragmentation:canonical"
    && item.kind === "REFERENCE_DENSE_EVIDENCE"
  );
  assert.match(referenceArtifact?.ref ?? "", /^proofs\/m6\/benchmark\/references\//u);
  assert.notEqual(referenceArtifact?.ref, "proofs/m6/references/shutter_fragmentation-canonical.json");
  assert.equal(liveCanonical.analyzerFingerprint, liveProof.analyzer.measurementFingerprint);
  const benchmarkReference = await load(referenceArtifact.ref);
  assert.equal(benchmarkReference.contentKey, referenceArtifact.contentKey);
  const liveSource = liveCanonical.evidenceRefs.find((item) => item.startsWith("video:sha256:"));
  const benchmarkSource = benchmarkReference.evidenceRefs.find((item) => item.startsWith("video:sha256:"));
  assert.equal(benchmarkSource, liveSource);
});