import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1,
  defaultM6ProfessionalBenchmarkEvidencePathV1,
  loadM6ProfessionalBenchmarkEvidenceV1,
} from "../.tmp/runtime/apps/desktop-host/src/index.js";
import {
  createCanonicalProfessionalBenchmarkV1,
} from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const evidenceFor = (item) => ({
  caseId: item.caseId,
  achievedLevel: "PROFESSIONAL_FIDELITY_VERIFIED",
  maturityProof: {
    functionallyPresent: true,
    structuralCoverageComplete: true,
    visuallyRecognizable: true,
    referenceFaithful: true,
    transferVariantCount: 1,
    professionalCasePassCount: 2,
    robustnessAxesPassed: [],
  },
  referenceEvidenceRef: item.referenceEvidenceRef,
  directAbReferenceRef: "proof:a-b:" + item.caseId,
  comparisonEvidenceRef: "proof:comparison:" + item.caseId,
  transferEvidence: item.transferAxes.map((axis, index) => ({
    axis,
    passed: true,
    evidenceRef: "proof:transfer:" + item.caseId + ":" + axis,
    variantFingerprint: "variant:" + item.caseId + ":" + String(index + 1),
  })),
  degradedCaseRejected: true,
  degradedCaseEvidenceRef: "proof:degraded:" + item.caseId,
});

test("M6 benchmark evidence loader is absent-safe and rejects untrusted structure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-m6-benchmark-"));
  try {
    assert.deepEqual(loadM6ProfessionalBenchmarkEvidenceV1(root), []);

    const filePath = defaultM6ProfessionalBenchmarkEvidencePathV1(root);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({
      schema: "wrong-schema",
      evidence: [],
    }), "utf8");
    assert.throws(
      () => loadM6ProfessionalBenchmarkEvidenceV1(root),
      /unsupported schema/i,
    );

    const canonical = createCanonicalProfessionalBenchmarkV1();
    const evidence = evidenceFor(canonical[0]);
    await writeFile(filePath, JSON.stringify({
      schema: M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1,
      evidence: [evidence],
    }), "utf8");
    assert.deepEqual(loadM6ProfessionalBenchmarkEvidenceV1(root), [evidence]);

    await writeFile(filePath, JSON.stringify({
      schema: M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1,
      evidence: [evidence, evidence],
    }), "utf8");
    assert.throws(
      () => loadM6ProfessionalBenchmarkEvidenceV1(root),
      /duplicate case/i,
    );

    await writeFile(filePath, JSON.stringify({
      schema: M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1,
      evidence: [{ ...evidence, caseId: "m6:not-canonical" }],
    }), "utf8");
    assert.throws(
      () => loadM6ProfessionalBenchmarkEvidenceV1(root),
      /invalid or unknown case/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
