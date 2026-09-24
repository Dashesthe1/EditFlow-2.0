import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EditTypeRegistryV1,
  GptOrchestrationStoreV1,
  PracticeHomeworkEngineV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";
import {
  M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1,
  defaultM6ProfessionalBenchmarkEvidencePathV1,
} from "../.tmp/runtime/apps/desktop-host/src/index.js";
import {
  recordPracticeHeldOutCertificationV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-held-out-certification.js";
import {
  createCanonicalProfessionalBenchmarkV1,
} from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const report = {
  schema: "editflow.practice-similarity.v1",
  breakdown: {
    sceneIdentity: 0.98,
    temporalAlignment: 0.98,
    cutTiming: 0.98,
    framing: 0.98,
    motion: 0.98,
    effectFidelity: 0.98,
    transitionFidelity: 0.98,
    colorFinish: 0.98,
    pixelStructure: 0.98,
  },
  definingEffectCoverage: 1,
  wrongSceneCount: 0,
  unmatchedSceneCount: 0,
  overallSimilarity: 0.98,
  passed: true,
  reasons: [],
  evidenceRefs: ["comparison:held-out"],
};

const masteryRecord = (sessionId) => ({
  sessionId,
  scope: "TRANSFER_VERIFIED",
  proofRef: "proof:training",
  referenceId: "finish:training",
  sourceIndexId: "source-index:training",
  referenceFingerprint: "reference:training",
  sourceFingerprint: "source:training",
  sourceMediaSha256: ["sha256:training-source"],
  finalRenderRef: "render:training",
  overallSimilarity: 0.98,
  definingEffectCoverage: 1,
  effectFamilyIds: ["SHUTTER_FRAGMENTATION"],
  verifiedAt: "2026-09-23T12:00:00.000Z",
});
const proof = (sessionId, editTypeId) => ({
  schema: "editflow.practice-mastery-proof.v1",
  sessionId,
  editTypeId,
  referenceId: "finish:held-out",
  sourceIndexId: "source-index:held-out",
  referenceFingerprint: "reference:held-out",
  sourceFingerprint: "source:held-out",
  sourceMediaSha256: ["sha256:held-out-source"],
  finalRenderRef: "render:held-out",
  minimumSimilarity: 0.95,
  exactSceneConfidence: 0.95,
  effectFamilyIds: ["MOTION_WARP"],
  report,
  matches: [],
  audioMatch: null,
  evidenceRefs: ["proof:held-out:machine"],
  verifiedAt: "2026-09-23T13:00:00.000Z",
});

const professionalEvidenceForShutter = () =>
  createCanonicalProfessionalBenchmarkV1()
    .filter((item) => item.family === "SHUTTER_FRAGMENTATION")
    .map((item) => ({
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
    }));

const transferVerifiedRegistry = (editTypeId) => {
  const registry = new EditTypeRegistryV1();
  registry.create({ editTypeId, title: "Held Out Test" });
  const trainingSession = "practice:training:transfer";
  registry.beginGptLearningSession(editTypeId, trainingSession, "PRACTICE");
  registry.completeGptLearningSession({
    editTypeId,
    sessionId: trainingSession,
    mode: "PRACTICE",
    mastered: true,
    masteryRecord: masteryRecord(trainingSession),
  });
  return registry;
};

const transferVerifiedSkillRegistry = (editTypeId, skillId, machineUseSignature) => {
  const registry = transferVerifiedRegistry(editTypeId);
  registry.recordGptLearningEvent({
    schema: "editflow.gpt-learning-event.v1",
    eventId: "gpt-learning-event:retained-transfer-skill",
    sessionId: "practice:training:transfer",
    editTypeId,
    mode: "PRACTICE",
    stage: "RESULT",
    outcome: "SUCCESS",
    summary: "Retain a previously transfer-verified learned skill for certification.",
    learnedSkill: {
      skillId,
      title: "Retained Transfer Skill",
      requestedBehavior: "Apply the retained professional construction when its trigger is present.",
      maturity: "TRANSFER_VERIFIED",
      constructionPattern: "Use the retained causal construction and adapt it to the current shot.",
      capabilityIds: ["ae.keyframe.set"],
      adaptationNotes: "Adapt timing and magnitude to the measured reference behavior.",
      causalModel: {
        triggerConditions: ["The held-out reference contains the learned behavior."],
        invariants: ["Preserve the defining visible behavior."],
        adaptationAxes: ["Timing and magnitude."],
        failureSignals: ["The defining behavior is absent or mismatched."],
        repairStrategies: ["Re-measure and correct the construction."],
        transferCriteria: ["Pass on materially different held-out media."],
      },
      ...(machineUseSignature === undefined ? {} : { machineUseSignature }),
      provenSessionIds: ["practice:training:transfer", "practice:training:transfer-2"],
      researchSources: [],
      evidenceRefs: ["proof:retained-transfer-skill"],
      learnedAt: "2026-09-23T12:00:00.000Z",
    },
    evidenceRefs: ["proof:retained-transfer-skill"],
    createdAt: "2026-09-23T12:00:00.000Z",
  });
  return registry;
};

const machineAttestedAttempt = (renderRef = "render:held-out") => ({
  attempt: 1,
  renderRef,
  report,
  decisionTraces: [{
    decisionId: "held-out:machine-attestation",
    cueIds: ["effect-family:MOTION_WARP"],
    constructionIds: ["graph:retained:motion-warp"],
    rationaleCodes: ["EDIT_TYPE_TRANSFER_APPLIED"],
  }],
  elapsedMs: 1000,
  evidenceRefs: ["readback:held-out:machine"],
});

test("shared held-out recorder retains machine proof and benchmark evidence", () => {
  const editTypeId = "held-out-live";
  const sessionId = "practice:held-out:001";
  const registry = transferVerifiedRegistry(editTypeId);
  const recorded = recordPracticeHeldOutCertificationV1({
    registry,
    editTypeId,
    sessionId,
    proof: proof(sessionId, editTypeId),
    proofRef: "proof:held-out:bundle",
  });
  assert.equal(recorded.heldOutCase.passed, true);
  assert.equal(recorded.benchmark.caseCount, 1);
  assert.equal(recorded.benchmark.passedCaseCount, 1);
  assert.equal(recorded.benchmark.robust, false);
  assert.ok(recorded.benchmark.reasons.some((reason) => /fewer than 20 cases/.test(reason)));
  const retained = registry.knowledge(editTypeId);
  assert.equal(retained.gptLearning.heldOutCases.length, 1);
  assert.equal(retained.gptLearning.heldOutBenchmarks.length, 1);
});

test("shared held-out recorder loads persisted M6 benchmark authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-held-out-m6-"));
  try {
    const evidenceFile = defaultM6ProfessionalBenchmarkEvidencePathV1(root);
    await mkdir(path.dirname(evidenceFile), { recursive: true });
    await writeFile(evidenceFile, JSON.stringify({
      schema: M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1,
      evidence: professionalEvidenceForShutter(),
    }), "utf8");

    const editTypeId = "held-out-persisted-m6";
    const sessionId = "practice:held-out:persisted-m6";
    const recorded = recordPracticeHeldOutCertificationV1({
      registry: transferVerifiedRegistry(editTypeId),
      editTypeId,
      sessionId,
      proof: proof(sessionId, editTypeId),
      proofRef: "proof:held-out:persisted-m6",
      repositoryRoot: root,
    });
    assert.equal(recorded.benchmark.professionalBenchmarkCoverageVerified, true);
    assert.deepEqual(
      recorded.benchmark.professionalBenchmarkVerifiedEffectFamilyIds,
      ["SHUTTER_FRAGMENTATION"],
    );
    assert.equal(recorded.benchmark.robust, false);
    assert.ok(recorded.benchmark.reasons.some((reason) => /fewer than 20 cases/.test(reason)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shared held-out recorder rejects unverified or mismatched certification", () => {
  const editTypeId = "held-out-blocked";
  const sessionId = "practice:held-out:blocked";
  const unverified = new EditTypeRegistryV1();
  unverified.create({ editTypeId, title: "Blocked" });
  assert.throws(
    () => recordPracticeHeldOutCertificationV1({
      registry: unverified,
      editTypeId,
      sessionId,
      proof: proof(sessionId, editTypeId),
      proofRef: "proof:blocked",
    }),
    /TRANSFER_VERIFIED/,
  );

  const registry = transferVerifiedRegistry(editTypeId);
  assert.throws(
    () => recordPracticeHeldOutCertificationV1({
      registry,
      editTypeId,
      sessionId,
      proof: proof("practice:wrong-session", editTypeId),
      proofRef: "proof:wrong-session",
    }),
    /proof session/,
  );
});

test("held-out certification rejects training and repeated material fingerprints", () => {
  const editTypeId = "held-out-novelty";
  const registry = transferVerifiedRegistry(editTypeId);
  const overlapSession = "practice:held-out:training-overlap";
  assert.throws(
    () => recordPracticeHeldOutCertificationV1({
      registry,
      editTypeId,
      sessionId: overlapSession,
      proof: {
        ...proof(overlapSession, editTypeId),
        referenceFingerprint: "reference:training",
      },
      proofRef: "proof:training-overlap",
    }),
    /overlaps retained Practice training material/,
  );

  const sourceOverlapSession = "practice:held-out:source-overlap";
  assert.throws(
    () => recordPracticeHeldOutCertificationV1({
      registry,
      editTypeId,
      sessionId: sourceOverlapSession,
      proof: {
        ...proof(sourceOverlapSession, editTypeId),
        sourceFingerprint: "source:different-aggregate",
        sourceMediaSha256: ["sha256:training-source", "sha256:extra-source"],
      },
      proofRef: "proof:source-overlap",
    }),
    /overlaps retained Practice training material/,
  );

  const firstSession = "practice:held-out:novel-001";
  recordPracticeHeldOutCertificationV1({
    registry,
    editTypeId,
    sessionId: firstSession,
    proof: proof(firstSession, editTypeId),
    proofRef: "proof:novel-001",
  });

  const repeatedSession = "practice:held-out:novel-002";
  assert.throws(
    () => recordPracticeHeldOutCertificationV1({
      registry,
      editTypeId,
      sessionId: repeatedSession,
      proof: proof(repeatedSession, editTypeId),
      proofRef: "proof:novel-002",
    }),
    /novel reference and source fingerprints/,
  );
});


test("held-out benchmark requires exact learned-skill coverage beyond effect-family coverage", () => {
  const editTypeId = "held-out-skill-coverage";
  const skillId = "skill:retained:shutter";
  const sessionId = "practice:held-out:skill-missing";
  const recorded = recordPracticeHeldOutCertificationV1({
    registry: transferVerifiedSkillRegistry(editTypeId, skillId),
    editTypeId,
    sessionId,
    proof: proof(sessionId, editTypeId),
    proofRef: "proof:held-out:skill-missing",
    professionalBenchmarkEvidence: professionalEvidenceForShutter(),
  });
  assert.deepEqual(recorded.benchmark.requiredLearnedSkillIds, [skillId]);
  assert.deepEqual(recorded.benchmark.verifiedLearnedSkillIds, []);
  assert.deepEqual(recorded.benchmark.missingLearnedSkillIds, [skillId]);
  assert.equal(recorded.benchmark.learnedSkillCoverageVerified, false);
  assert.ok(recorded.benchmark.reasons.some((reason) => /learned skills/.test(reason)));
});

test("held-out certification does not credit an explicit skill claim without machine attestation", () => {
  const editTypeId = "held-out-skill-applied";
  const skillId = "skill:retained:shutter";
  const sessionId = "practice:held-out:skill-applied";
  const recorded = recordPracticeHeldOutCertificationV1({
    registry: transferVerifiedSkillRegistry(editTypeId, skillId),
    editTypeId,
    sessionId,
    proof: proof(sessionId, editTypeId),
    proofRef: "proof:held-out:skill-applied",
    appliedSkillIds: [skillId],
    professionalBenchmarkEvidence: professionalEvidenceForShutter(),
  });
  assert.deepEqual(recorded.heldOutCase.appliedSkillIds, [skillId]);
  assert.deepEqual(recorded.heldOutCase.verifiedSkillUseIds, []);
  assert.equal(recorded.heldOutCase.passed, false);
  assert.deepEqual(recorded.benchmark.verifiedLearnedSkillIds, []);
  assert.deepEqual(recorded.benchmark.missingLearnedSkillIds, [skillId]);
  assert.equal(recorded.benchmark.learnedSkillCoverageVerified, false);
  assert.ok(recorded.heldOutCase.reasons.some((reason) => /lacks machine attestation/.test(reason)));

  assert.throws(() => recordPracticeHeldOutCertificationV1({
    registry: transferVerifiedSkillRegistry("held-out-skill-unknown", skillId),
    editTypeId: "held-out-skill-unknown",
    sessionId: "practice:held-out:skill-unknown",
    proof: proof("practice:held-out:skill-unknown", "held-out-skill-unknown"),
    proofRef: "proof:held-out:skill-unknown",
    appliedSkillIds: ["skill:not-retained"],
  }), /not retained as TRANSFER_VERIFIED/);
});

test("held-out certification credits a retained skill only from matching machine proof", () => {
  const editTypeId = "held-out-skill-machine-attested";
  const skillId = "skill:retained:motion-warp";
  const sessionId = "practice:held-out:skill-machine-attested";
  const machineUseSignature = {
    schema: "editflow.gpt-skill-machine-use-signature.v1",
    invariantRules: [{
      invariant: "Preserve the defining visible behavior.",
      evidence: [{
        source: "PROOF_EFFECT_FAMILY",
        match: "EXACT",
        value: "MOTION_WARP",
      }, {
        source: "CONSTRUCTION_ID",
        match: "PREFIX",
        value: "construction:motion-warp:",
      }],
    }],
  };
  const certifiedAttempt = {
    attempt: 1,
    renderRef: "render:held-out",
    report,
    decisionTraces: [{
      decisionId: "decision:machine-attested",
      cueIds: ["effect-family:MOTION_WARP"],
      constructionIds: [
        "construction:motion-warp:held-out",
        "construction:unrelated:held-out",
      ],
      rationaleCodes: ["M6_FAMILY_MOTION_WARP"],
      semanticPatches: [],
    }],
    elapsedMs: 1200,
    evidenceRefs: ["ae-readback:motion-warp:held-out"],
  };
  const recorded = recordPracticeHeldOutCertificationV1({
    registry: transferVerifiedSkillRegistry(editTypeId, skillId, machineUseSignature),
    editTypeId,
    sessionId,
    proof: proof(sessionId, editTypeId),
    proofRef: "proof:held-out:skill-machine-attested",
    appliedSkillIds: [skillId],
    attempt: certifiedAttempt,
    professionalBenchmarkEvidence: professionalEvidenceForShutter(),
  });
  assert.deepEqual(recorded.heldOutCase.appliedSkillIds, [skillId]);
  assert.deepEqual(recorded.heldOutCase.verifiedSkillUseIds, [skillId]);
  assert.equal(recorded.heldOutCase.skillUseAttestations[0].verified, true);
  assert.deepEqual(
    recorded.heldOutCase.skillUseAttestations[0].matchedConstructionIds,
    ["construction:motion-warp:held-out"],
  );
  assert.deepEqual(recorded.benchmark.verifiedLearnedSkillIds, [skillId]);
  assert.deepEqual(recorded.benchmark.missingLearnedSkillIds, []);
  assert.equal(recorded.benchmark.learnedSkillCoverageVerified, true);
});

test("held-out audit binds applied skill claims to evidence-bearing inference events", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-held-out-skill-audit-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const editTypeId = "held-out-skill-audit";
  const skillId = "skill:retained:audit";
  const registry = transferVerifiedSkillRegistry(editTypeId, skillId);
  const store = new GptOrchestrationStoreV1(path.join(root, "orchestration.json"));
  const assignment = await store.createAssignment({
    sessionId: "practice:held-out:skill-audit",
    mode: "PRACTICE",
    practiceRole: "HELD_OUT_CERTIFICATION",
    editTypeId,
    finish: { mediaId: "finish:audit", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: "C:\\Media\\finish-audit.mp4" },
    start: [{ mediaId: "start:audit", role: "START_SOURCE", mediaKind: "VIDEO", uri: "C:\\Media\\raw-audit.mp4" }],
    artifactDir: path.join(root, "artifacts"),
    knowledge: registry.transferableKnowledge(editTypeId),
  });
  assert.match(assignment.chatMessage, /appliedSkillIds/);
  await store.claim(assignment.assignmentId, "skill-audit-test");
  await assert.rejects(store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "OBSERVATION",
    summary: "Skill claims cannot live on an observation-only event.",
    appliedSkillIds: [skillId],
    evidenceRefs: ["proof:observation"],
  }), /only on AE_ACTION or RESULT/);
  await assert.rejects(store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "AE_ACTION",
    summary: "A neutral applied-skill claim cannot earn certification credit.",
    appliedSkillIds: [skillId],
    evidenceRefs: ["readback:neutral-skill-claim"],
  }), /require SUCCESS or IMPROVED/);
  await assert.rejects(store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "AE_ACTION",
    outcome: "SUCCESS",
    summary: "An applied skill claim without machine evidence must fail closed.",
    appliedSkillIds: [skillId],
  }), /require retained evidenceRefs/);
  const event = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "AE_ACTION",
    outcome: "SUCCESS",
    summary: "Applied the retained skill in AE and retained readback evidence.",
    appliedSkillIds: [skillId],
    evidenceRefs: ["readback:held-out-skill-audit"],
  });
  assert.deepEqual(event.appliedSkillIds, [skillId]);
});
