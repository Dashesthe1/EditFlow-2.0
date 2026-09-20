import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateUnknownEffectSynthesisMilestoneV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CASE01 = path.join(ROOT, "proofs", "diagnostics", "m6-real-unknown-synthesis-case01.json");
const CASE02 = path.join(ROOT, "proofs", "diagnostics", "m6-unknown-case02-professional-proof.json");
const CASE03 = path.join(
  ROOT, "proofs", "diagnostics", "m6-unknown-case03-k-v11-live05-zero-schema.json",
);
const OUT = path.join(ROOT, "proofs", "manifests", "m6-unknown-effect-synthesis-v1.json");

const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const sha256File = async (file) => createHash("sha256")
  .update(await readFile(file))
  .digest("hex");
const relative = (file) => path.relative(ROOT, file).replaceAll("\\", "/");
const latestCertifiedPass = (passes) => [...passes].reverse().find(
  (item) => item?.gate?.certified === true,
);
const case01 = await load(CASE01);
const case02 = await load(CASE02);
const case03 = await load(CASE03);
const case03ReferencePath = path.join(
  ROOT, "proofs", "diagnostics", "m6-unknown-case03-reference-v11-evidence.json",
);
const case03Reference = await load(case03ReferencePath);

const normalized = [
  {
    caseId: "m6.8:unknown-case01-fragmentation",
    proofRef: relative(CASE01),
    proofSha256: await sha256File(CASE01),
    referenceContentKey: case01.reference?.contentKey ?? "",
    family: case01.synthesis?.selectedFamily,
    provenance: "LEARNED_SKILL_DISABLED",
    behaviorFirst: case01.learnedSkillAccess === "DISABLED_BY_PROOF"
      && case01.synthesis?.status === "READY_FOR_PROOF",
    namedEffectFallbackUsed: case01.synthesis?.selectedFamily !== "UNKNOWN",
    finalCertified: case01.reconstruction?.gate?.certified === true,
    finalDefiningCoverage: Number(case01.reconstruction?.comparison?.definingCoverage),
    finalWeightedFidelity: Number(case01.reconstruction?.comparison?.weightedFidelity),
    degradedOrUnderDrivenRejected: case01.degradedControl?.gate?.certified === false
      && (case01.degradedControl?.gate?.underDrivenInvariantIds?.length ?? 0) > 0,
    renderedOutputVerified: typeof case01.reconstruction?.evidencePath === "string"
      && typeof case01.reconstruction?.comparison?.renderEvidenceKey === "string",
    realAeTransactionCommitted: false,
    automaticCorrectionObserved: false,
    analyzerFingerprint: case01.reference?.analyzerFingerprint ?? null,
  },
  {
    caseId: "m6.8:unknown-case02-directional-blur",
    proofRef: relative(CASE02),
    proofSha256: await sha256File(CASE02),
    referenceContentKey: case02.reference?.contentKey ?? "",
    family: case02.reconstruction?.graph?.family,
    provenance: "UNKNOWN_DECOMPOSITION_DIRECT",
    behaviorFirst: case02.evidenceClass === "REFERENCE_ONLY_UNKNOWN_EFFECT_RECONSTRUCTION"
      && case02.reconstruction?.graph?.family === "UNKNOWN",
    namedEffectFallbackUsed: case02.reconstruction?.graph?.family !== "UNKNOWN",
    finalCertified: case02.reconstructedRender?.gate?.certified === true,
    finalDefiningCoverage: Number(
      case02.reconstructedRender?.comparison?.definingCoverage,
    ),
    finalWeightedFidelity: Number(
      case02.reconstructedRender?.comparison?.weightedFidelity,
    ),
    degradedOrUnderDrivenRejected: case02.degradedControl?.gate?.certified === false
      && (case02.degradedControl?.gate?.underDrivenInvariantIds?.length ?? 0) > 0,
    renderedOutputVerified: typeof case02.reconstructedRender?.renderEvidenceKey === "string",
    realAeTransactionCommitted: case02.nativeSchemaProof?.transactionState === "COMMITTED",
    automaticCorrectionObserved: false,
    analyzerFingerprint: case02.reference?.analyzerFingerprint ?? null,
  },
  (() => {
    const finalPass = latestCertifiedPass(case03.passes ?? []);
    return {
      caseId: "m6.8:unknown-case03-optical-auto-correction",
      proofRef: relative(CASE03),
      proofSha256: null,
      referenceContentKey: case03Reference.contentKey ?? "",
      family: case03.family,
      provenance: "UNKNOWN_DECOMPOSITION_DIRECT",
      behaviorFirst: case03.schema === "editflow.m6.generic-native-auto-correction-proof.v1"
        && case03.family === "UNKNOWN",
      namedEffectFallbackUsed: case03.family !== "UNKNOWN",
      finalCertified: case03.certified === true && finalPass?.gate?.certified === true,
      finalDefiningCoverage: Number(case03.finalDefiningCoverage),
      finalWeightedFidelity: Number(case03.finalWeightedFidelity),
      degradedOrUnderDrivenRejected: (case03.passes ?? []).some(
        (item) => item?.gate?.certified === false
          && (item?.gate?.underDrivenInvariantIds?.length ?? 0) > 0,
      ),
      renderedOutputVerified: typeof finalPass?.video === "string"
        && typeof finalPass?.evidence === "string",
      realAeTransactionCommitted: finalPass?.transactionState === "COMMITTED",
      automaticCorrectionObserved: (case03.passes ?? []).some(
        (item) => item?.source === "bounded-actuator-probe",
      ),
      analyzerFingerprint: case03Reference.analyzerFingerprint ?? null,
    };
  })(),
];
normalized[2].proofSha256 = await sha256File(CASE03);
const gateInput = normalized.map((item) => ({
  caseId: item.caseId,
  proofRef: item.proofRef,
  proofSha256: item.proofSha256,
  referenceContentKey: item.referenceContentKey,
  family: item.family,
  provenance: item.provenance,
  behaviorFirst: item.behaviorFirst,
  namedEffectFallbackUsed: item.namedEffectFallbackUsed,
  finalCertified: item.finalCertified,
  finalDefiningCoverage: item.finalDefiningCoverage,
  finalWeightedFidelity: item.finalWeightedFidelity,
  degradedOrUnderDrivenRejected: item.degradedOrUnderDrivenRejected,
  renderedOutputVerified: item.renderedOutputVerified,
  realAeTransactionCommitted: item.realAeTransactionCommitted,
  automaticCorrectionObserved: item.automaticCorrectionObserved,
}));
const gate = evaluateUnknownEffectSynthesisMilestoneV1(gateInput);

const manifest = {
  schema: "editflow.m6.unknown-effect-synthesis-milestone-manifest.v1",
  generatedAt: new Date().toISOString(),
  milestone: "M6.8",
  status: gate.passed ? "PASS" : "FAIL",
  governance: {
    rule: "Unknown effects must be reconstructed from observed visual behavior, not nearest-known effect identity.",
    minimumDistinctUnknownCases: 3,
    fidelityAuthority: "RENDERED_SEMANTIC_COMPARISON",
    degradedBehaviorMustFail: true,
    noReproofPolicy: "Each retained case remains bound to its own analyzer/content identity.",
  },
  cases: normalized,
  gate,
  proofSources: {
    evaluator: "packages/visual-effects-intelligence/src/milestones.ts",
    evaluatorSha256: await sha256File(path.join(
      ROOT, "packages", "visual-effects-intelligence", "src", "milestones.ts",
    )),
    normalizer: relative(fileURLToPath(import.meta.url)),
    normalizerSha256: await sha256File(fileURLToPath(import.meta.url)),
    case03ReferenceRef: relative(case03ReferencePath),
    case03ReferenceSha256: await sha256File(case03ReferencePath),
  },
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  ok: gate.passed,
  output: OUT,
  caseCount: gate.caseCount,
  distinctReferenceCount: gate.distinctReferenceCount,
  renderedCaseCount: gate.renderedCaseCount,
  realAeCaseCount: gate.realAeCaseCount,
  automaticCorrectionCaseCount: gate.automaticCorrectionCaseCount,
  failures: gate.failures,
}));
if (!gate.passed) process.exitCode = 2;
