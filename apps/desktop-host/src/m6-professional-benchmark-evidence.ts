import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  createCanonicalProfessionalBenchmarkV1,
  type BenchmarkCaseEvidenceV1,
} from "../../../packages/visual-effects-intelligence/src/index.js";

export const M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1 =
  "editflow.m6-professional-benchmark-evidence.v1" as const;

export interface M6ProfessionalBenchmarkEvidenceFileV1 {
  readonly schema: typeof M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1;
  readonly evidence: readonly BenchmarkCaseEvidenceV1[];
}

const objectRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const validMaturityProof = (value: unknown): boolean => {
  const item = objectRecord(value);
  return item !== null
    && typeof item.functionallyPresent === "boolean"
    && typeof item.structuralCoverageComplete === "boolean"
    && typeof item.visuallyRecognizable === "boolean"
    && typeof item.referenceFaithful === "boolean"
    && typeof item.transferVariantCount === "number"
    && Number.isFinite(item.transferVariantCount)
    && typeof item.professionalCasePassCount === "number"
    && Number.isFinite(item.professionalCasePassCount)
    && Array.isArray(item.robustnessAxesPassed);
};

const validTransferEvidence = (value: unknown): boolean => {
  const item = objectRecord(value);
  return item !== null
    && nonEmptyString(item.axis)
    && typeof item.passed === "boolean"
    && nonEmptyString(item.evidenceRef)
    && nonEmptyString(item.variantFingerprint);
};

const validateCaseEvidence = (
  value: unknown,
  canonicalCaseIds: ReadonlySet<string>,
): value is BenchmarkCaseEvidenceV1 => {
  const item = objectRecord(value);
  return item !== null
    && nonEmptyString(item.caseId)
    && canonicalCaseIds.has(item.caseId)
    && nonEmptyString(item.referenceEvidenceRef)
    && validMaturityProof(item.maturityProof)
    && nonEmptyString(item.directAbReferenceRef)
    && nonEmptyString(item.comparisonEvidenceRef)
    && Array.isArray(item.transferEvidence)
    && item.transferEvidence.every(validTransferEvidence)
    && typeof item.degradedCaseRejected === "boolean"
    && nonEmptyString(item.degradedCaseEvidenceRef);
};

export const defaultM6ProfessionalBenchmarkEvidencePathV1 = (
  repositoryRoot: string,
): string => path.join(
  path.resolve(repositoryRoot),
  "proofs",
  "manifests",
  "m6-professional-benchmark-evidence-v1.json",
);

export const loadM6ProfessionalBenchmarkEvidenceV1 = (
  repositoryRoot: string,
  evidenceFilePath = defaultM6ProfessionalBenchmarkEvidencePathV1(repositoryRoot),
): readonly BenchmarkCaseEvidenceV1[] => {
  const resolved = path.resolve(evidenceFilePath);
  if (!existsSync(resolved)) return [];

  const parsed = JSON.parse(
    readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""),
  ) as unknown;
  const payload = objectRecord(parsed);
  if (payload === null
    || payload.schema !== M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1
    || !Array.isArray(payload.evidence)) {
    throw new TypeError(
      "M6 professional benchmark evidence file has an unsupported schema.",
    );
  }

  const canonicalCaseIds = new Set(
    createCanonicalProfessionalBenchmarkV1().map((item) => item.caseId),
  );
  const seen = new Set<string>();
  for (const item of payload.evidence) {
    if (!validateCaseEvidence(item, canonicalCaseIds)) {
      throw new TypeError(
        "M6 professional benchmark evidence contains an invalid or unknown case.",
      );
    }
    if (seen.has(item.caseId)) {
      throw new TypeError(
        "M6 professional benchmark evidence contains a duplicate case: " + item.caseId,
      );
    }
    seen.add(item.caseId);
  }
  return structuredClone(payload.evidence as readonly BenchmarkCaseEvidenceV1[]);
};
