import assert from "node:assert/strict";
import test from "node:test";

import {
  EditTypeRegistryV1,
  classifyPracticeMasteryScopeV1,
  evaluatePracticeHeldOutBenchmarkV1,
  practicePerceptualSetOverlapsV1,
  practicePerceptualSignatureMatchesV1,
  practicePerceptualSignatureSimilarityV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

const signature = (hex) => Array.from({ length: 16 }, () => hex).join(",");
const original = signature("0000000000000000");
const reencoded = signature("0000000000000001");
const distinct = signature("ffffffffffffffff");

const masteryRecord = {
  sessionId: "practice:perceptual:training",
  scope: "REFERENCE_VERIFIED",
  proofRef: "proof:training",
  referenceId: "finish:training",
  sourceIndexId: "source:training",
  referenceFingerprint: "sha:finish:training",
  sourceFingerprint: "sha:source-set:training",
  sourceMediaSha256: ["sha:source:training"],
  referencePerceptualSignature: original,
  sourcePerceptualSignatures: [original],  finalRenderRef: "render:training",
  overallSimilarity: 0.99,
  definingEffectCoverage: 1,
  effectFamilyIds: ["MOTION_WARP"],
  verifiedAt: "2026-09-24T00:00:00.000Z",
};

const proof = (referenceSignature, sourceSignature) => ({
  referenceFingerprint: "sha:finish:new-bytes",
  sourceFingerprint: "sha:source-set:new-bytes",
  sourceMediaSha256: ["sha:source:new-bytes"],
  referencePerceptualSignature: referenceSignature,
  sourcePerceptualSignatures: [sourceSignature],
});

test("perceptual signatures tolerate tiny re-encode drift but reject unrelated frames", () => {
  const similarity = practicePerceptualSignatureSimilarityV1(original, reencoded);
  assert.ok(similarity !== null && similarity > 0.96);
  assert.equal(practicePerceptualSignatureMatchesV1(original, reencoded), true);
  assert.equal(practicePerceptualSignatureMatchesV1(original, distinct), false);
  assert.equal(practicePerceptualSetOverlapsV1([distinct, original], [reencoded]), true);
});
test("transfer scope rejects different bytes when Finish or Start is perceptually reused", () => {
  assert.equal(
    classifyPracticeMasteryScopeV1([masteryRecord], proof(reencoded, distinct)),
    "REFERENCE_VERIFIED",
  );
  assert.equal(
    classifyPracticeMasteryScopeV1([masteryRecord], proof(distinct, reencoded)),
    "REFERENCE_VERIFIED",
  );
  assert.equal(
    classifyPracticeMasteryScopeV1([masteryRecord], proof(distinct, distinct)),
    "TRANSFER_VERIFIED",
  );
});

test("held-out registry rejects perceptual reuse even when all exact hashes differ", () => {
  const registry = new EditTypeRegistryV1();
  registry.create({ editTypeId: "perceptual-held-out", title: "Perceptual Held Out" });
  registry.beginGptLearningSession("perceptual-held-out", masteryRecord.sessionId, "PRACTICE");
  registry.completeGptLearningSession({
    editTypeId: "perceptual-held-out",
    sessionId: masteryRecord.sessionId,
    mode: "PRACTICE",
    mastered: true,    masteryRecord,
  });
  assert.throws(() => registry.recordHeldOutCase("perceptual-held-out", {
    caseId: "held-out:reencoded",
    sessionId: "practice:held-out:reencoded",
    referenceFingerprint: "sha:finish:held-out-new-bytes",
    sourceFingerprint: "sha:source:held-out-new-bytes",
    sourceMediaSha256: ["sha:source:held-out-new-bytes"],
    referencePerceptualSignature: reencoded,
    sourcePerceptualSignatures: [distinct],
    effectFamilyIds: ["MOTION_WARP"],
    appliedSkillIds: [],
    verifiedSkillUseIds: [],
    skillUseAttestations: [],
    objectAwareVerified: false,
    overallSimilarity: 0.99,
    definingEffectCoverage: 1,
    passed: true,
    reasons: [],
    evidenceRefs: ["proof:held-out:reencoded"],
  }), /overlaps retained Practice training material/);
});
test("standalone benchmark evaluator fails closed on perceptual training reuse", () => {
  const report = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "perceptual-benchmark",
    priorMasteryRecords: [{ ...masteryRecord, scope: "TRANSFER_VERIFIED" }],
    cases: [{
      caseId: "held-out:benchmark-reencoded",
      sessionId: "practice:held-out:benchmark-reencoded",
      referenceFingerprint: "sha:finish:benchmark-new-bytes",
      sourceFingerprint: "sha:source:benchmark-new-bytes",
      sourceMediaSha256: ["sha:source:benchmark-new-bytes"],
      referencePerceptualSignature: reencoded,
      sourcePerceptualSignatures: [distinct],
      effectFamilyIds: ["MOTION_WARP"],
      appliedSkillIds: [],
      verifiedSkillUseIds: [],
      skillUseAttestations: [],
      objectAwareVerified: false,
      overallSimilarity: 0.99,
      definingEffectCoverage: 1,
      passed: true,
      reasons: [],
      evidenceRefs: ["proof:benchmark-reencoded"],
    }],
  });
  assert.equal(report.robust, false);
  assert.ok(report.reasons.some((reason) => /perceptually reuses a training reference/.test(reason)));
});
