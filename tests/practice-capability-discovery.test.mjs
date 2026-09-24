import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EditTypeRegistryV1,
  GptOrchestrationStoreV1,
  ProCreationPreparationEngineV1,
  attestPracticeSkillUseV1,
  buildGptOrchestrationChatMessageV1,
  normalizePracticeVerificationPolicyV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

const finish = {
  mediaId: "finish:1",
  role: "FINISH_REFERENCE",
  mediaKind: "VIDEO",
  uri: "C:\\Media\\finish.mp4",
};
const start = [{
  mediaId: "video:1",
  role: "START_SOURCE",
  mediaKind: "VIDEO",
  uri: "C:\\Media\\raw.mp4",
}];

const transferMasteryRecord = (sessionId, materialId = "transfer") => ({
  sessionId,
  scope: "TRANSFER_VERIFIED",
  proofRef: "proof:mastery:" + sessionId,
  referenceId: "finish:" + materialId,
  sourceIndexId: "practice-source-set:" + materialId,
  referenceFingerprint: "reference-sha:" + materialId,
  sourceFingerprint: "source-sha-set:" + materialId,
  sourceMediaSha256: ["source-media-sha:" + materialId],
  finalRenderRef: "render:mastered",
  overallSimilarity: 0.98,
  definingEffectCoverage: 1,
  verifiedAt: "2026-09-23T12:00:00.000Z",
});

test("Practice verification policy has non-weakenable product floors", () => {
  assert.deepEqual(normalizePracticeVerificationPolicyV1({
    minimumSimilarity: 0.2,
    exactSceneConfidence: 0.4,
    minimumAudioConfidence: 0.1,
  }), {
    minimumSimilarity: 0.95,
    exactSceneConfidence: 0.95,
    minimumAudioConfidence: 0.90,
  });
  assert.deepEqual(normalizePracticeVerificationPolicyV1({
    minimumSimilarity: 0.985,
    exactSceneConfidence: 0.975,
    minimumAudioConfidence: 0.96,
  }), {
    minimumSimilarity: 0.985,
    exactSceneConfidence: 0.975,
    minimumAudioConfidence: 0.96,
  });
});

test("legacy GPT assignments inherit the current Tutorial Drive-first research policy on read", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-research-policy-migration-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const storePath = path.join(root, "orchestration.json");
  const legacyPolicy = "- When existing EditFlow knowledge is insufficient or the reference behavior is not understood, online research is required before accepting a fallback: inspect the live Capability Registry and installed Adobe features/plugins, then use Adobe documentation, professional tutorials, and broader web sources as needed.";
  await writeFile(storePath, JSON.stringify({
    schema: "editflow.gpt-orchestration-store.v1",
    assignments: [{
      schema: "editflow.gpt-orchestration-assignment.v1",
      assignmentId: "gpt-assignment:legacy",
      sessionId: "practice:legacy",
      mode: "PRACTICE",
      editTypeId: "microwave-edit",
      status: "RUNNING",
      finish,
      start,
      artifactDir: path.join(root, "artifacts"),
      chatMessage: ["legacy assignment", legacyPolicy, "retained tail"].join("\n"),
      createdAt: "2026-09-22T00:00:00.000Z",
      claimedAt: "2026-09-22T00:00:01.000Z",
      claimedBy: "chatgpt",
      startedAt: "2026-09-22T00:00:01.000Z",
      completedAt: null,
      cancelRequestedAt: null,
      finalRenderRef: null,
      finalSummary: null,
      error: null,
    }],
    events: [],
  }, null, 2) + "\n", "utf8");

  const store = new GptOrchestrationStoreV1(storePath);
  const migrated = await store.getAssignment("gpt-assignment:legacy");
  assert.ok(migrated);
  assert.match(migrated.chatMessage, /Tutorial Drive is the mandatory first research source/);
  assert.deepEqual(migrated.practicePolicy, {
    minimumSimilarity: 0.95,
    exactSceneConfidence: 0.95,
    minimumAudioConfidence: 0.90,
  });
  assert.match(migrated.chatMessage, /Adobe Effect Tutorials/);
  assert.match(migrated.chatMessage, /GPT completion is not Practice mastery/);
  assert.match(migrated.chatMessage, /weighted\/effect\/transition fidelity >= 0\.950/);
  assert.match(migrated.chatMessage, /Second priority is official Adobe documentation\/resources/);
  assert.match(migrated.chatMessage, /tutorial causal compiler/);
  assert.doesNotMatch(migrated.chatMessage, /online research is required before accepting a fallback/);
});

test("earlier capability-discovery assignments also migrate to Tutorial Drive-first policy", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-research-policy-migration-v0-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const storePath = path.join(root, "orchestration.json");
  const legacyPolicy = "- For a missing skill/capability, research the live Capability Registry, installed Adobe features/plugins, Adobe documentation, professional tutorials, and the web when useful.";
  await writeFile(storePath, JSON.stringify({
    schema: "editflow.gpt-orchestration-store.v1",
    assignments: [{
      schema: "editflow.gpt-orchestration-assignment.v1",
      assignmentId: "gpt-assignment:legacy-v0",
      sessionId: "practice:legacy-v0",
      mode: "PRACTICE",
      editTypeId: "microwave-edit",
      status: "RUNNING",
      finish,
      start,
      artifactDir: path.join(root, "artifacts"),
      chatMessage: ["legacy assignment", legacyPolicy, "retained tail"].join("\n"),
      createdAt: "2026-09-22T00:00:00.000Z",
      claimedAt: "2026-09-22T00:00:01.000Z",
      claimedBy: "chatgpt",
      startedAt: "2026-09-22T00:00:01.000Z",
      completedAt: null,
      cancelRequestedAt: null,
      finalRenderRef: null,
      finalSummary: null,
      error: null,
    }],
    events: [],
  }, null, 2) + "\n", "utf8");

  const store = new GptOrchestrationStoreV1(storePath);
  const migrated = await store.getAssignment("gpt-assignment:legacy-v0");
  assert.ok(migrated);
  assert.match(migrated.chatMessage, /Tutorial Drive is the mandatory first research source/);
  assert.match(migrated.chatMessage, /broader web\/internet research is last/);
  assert.doesNotMatch(migrated.chatMessage, /For a missing skill\/capability, research the live Capability Registry/);
});

test("Practice can discover, prove, and retain a previously missing editing skill", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-capability-discovery-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const registry = new EditTypeRegistryV1();
  registry.create({
    editTypeId: "microwave-edit",
    title: "Microwave Edit",
  });
  const sessionId = "practice:capability-discovery:001";
  registry.beginGptLearningSession("microwave-edit", sessionId, "PRACTICE");
  const store = new GptOrchestrationStoreV1(path.join(root, "orchestration.json"));
  const assignment = await store.createAssignment({
    sessionId,
    mode: "PRACTICE",
    editTypeId: "microwave-edit",
    finish,
    start,
    artifactDir: path.join(root, "artifacts"),
    knowledge: registry.knowledge("microwave-edit"),
  });

  assert.match(assignment.chatMessage, /CAPABILITY_GAP -> RESEARCH/);
  assert.match(assignment.chatMessage, /Tutorial Drive is the mandatory first research source/);
  assert.match(assignment.chatMessage, /Adobe Effect Tutorials/);
  assert.match(assignment.chatMessage, /Adobe Effect Music \+ Beat Tutorials/);
  assert.match(assignment.chatMessage, /Second priority is official Adobe documentation\/resources/);
  assert.match(assignment.chatMessage, /broader web\/internet research is last/);
  assert.match(assignment.chatMessage, /TEMPORAL_REWIND \/ REVERSE_PLAYBACK/);
  assert.match(assignment.chatMessage, /implement\/prove the missing EditFlow route/);
  await store.claim(assignment.assignmentId, "chatgpt-test");
  const gapOpen = {
    gapId: "gap:temporal-rewind",
    kind: "RECIPE_SKILL",
    requestedBehavior: "Replay the just-played source frames backward for a short rewind before the transition exits.",
    missingCapabilityIds: [],
    status: "OPEN",
    evidenceRefs: ["reference:cut-sheet"],
  };
  const gapEvent = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "CAPABILITY_GAP",
    outcome: "NEUTRAL",
    summary: "The reference contains an actual backward replay of recently shown frames that the current transition recipe omits.",
    capabilityGap: gapOpen,
    evidenceRefs: gapOpen.evidenceRefs,
  });
  registry.recordGptLearningEvent(gapEvent);
  assert.equal(
    registry.knowledge("microwave-edit").gptLearning.capabilityGaps[0].status,
    "OPEN",
  );
  await assert.rejects(
    store.appendEvent({
      assignmentId: assignment.assignmentId,
      stage: "RESEARCH",
      summary: "Adobe documentation cannot be consulted before the Tutorial Drive priority pass.",
      researchSources: [{
        sourceId: "adobe:time-remapping:premature",
        kind: "ADOBE_DOCUMENTATION",
        title: "Time-stretching and time-remapping",
        uri: "https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/time-stretching-and-time-remapping/time-stretching-time-remapping.html",
      }],
    }),
    /begin with Tutorial Drive provenance/,
  );
  await assert.rejects(
    store.appendEvent({
      assignmentId: assignment.assignmentId,
      stage: "RESEARCH",
      summary: "A Tutorial Drive label cannot point at a non-Drive source.",
      researchSources: [{
        sourceId: "tutorial-drive:spoofed",
        kind: "TUTORIAL_DRIVE",
        title: "Spoofed tutorial source",
        uri: "https://example.com/reverse-tutorial",
      }],
    }),
    /Google Drive tutorial\/file or recorded folder search/,
  );
  await assert.rejects(
    store.appendEvent({
      assignmentId: assignment.assignmentId,
      stage: "RESEARCH",
      summary: "Broader web research cannot jump ahead of Adobe and then return to Adobe.",
      researchSources: [{
        sourceId: "tutorial-drive:reverse",
        kind: "TUTORIAL_DRIVE",
        title: "Reverse tutorial",
        uri: "https://drive.google.com/file/d/tutorial-reverse/view",
      }, {
        sourceId: "web:reverse",
        kind: "WEB",
        title: "Broader web reverse article",
        uri: "https://example.com/reverse",
      }, {
        sourceId: "adobe:time-remapping:late",
        kind: "ADOBE_DOCUMENTATION",
        title: "Time-stretching and time-remapping",
        uri: "https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/time-stretching-and-time-remapping/time-stretching-time-remapping.html",
      }],
    }),
    /preserve priority order/,
  );

  await assert.rejects(
    store.appendEvent({
      assignmentId: assignment.assignmentId,
      stage: "RESEARCH",
      summary: "A matched Tutorial Drive file cannot become learning evidence without structured technique semantics.",
      researchSources: [{
        sourceId: "tutorial-drive:unstructured-match",
        kind: "TUTORIAL_DRIVE",
        title: "Unstructured reverse tutorial",
        uri: "https://drive.google.com/file/d/unstructured-reverse/view",
      }],
    }),
    /WHAT, WHEN\/WHY, HOW, ACCESS, PROOF, and TRANSFER/,
  );
  await assert.rejects(
    store.appendEvent({
      assignmentId: assignment.assignmentId,
      stage: "RESEARCH",
      summary: "Structured prose without the deep compiler cannot become matched tutorial evidence.",
      researchSources: [{
        sourceId: "tutorial-drive:manual-lookalike",
        kind: "TUTORIAL_DRIVE",
        title: "Manual lookalike",
        uri: "https://drive.google.com/file/d/manual-lookalike/view",
        tutorialTechnique: {
          what: "Reverse recent frames.",
          whenWhy: "Use on a visible rewind.",
          how: "Use Time Remap.",
          access: "Use native time controls.",
          proof: "Verify backward source time.",
          transfer: "Adapt the rewind span.",
        },
      }],
    }),
    /deep-analyzed and compiled by EditFlow/,
  );

  const reverseCompilation = (tutorialId, tutorialSkillId, fingerprintChar) => ({
    schema: "editflow.gpt-tutorial-causal-compilation.v1",
    compilerVersion: 1,
    targetSkillId: "skill:temporal-rewind:v1",
    tutorialId,
    tutorialSkillId,
    sourceRef: "drive://tutorial/" + tutorialId,
    analysisFingerprint: fingerprintChar.repeat(64),
    constructionPattern: "Enable Time Remap, preserve the forward source-time path, add a bounded descending source-time segment that replays the just-shown frames backward, then cut or resume according to the reference.",
    capabilityIds: ["ae.layer.time_remap.enable", "ae.keyframe.set", "ae.keyframe.temporal_ease"],
    adaptationNotes: "Adapt rewind duration, source-frame span, playback rate, interpolation, and whether playback resumes forward or cuts directly into the next shot.",
    causalModel: {
      triggerConditions: [
        "The reference visibly replays source frames that were just shown before the transition exits.",
      ],
      invariants: [
        "Source time descends during the rewind phase while the replayed frame sequence remains temporally coherent.",
      ],
      adaptationAxes: [
        "Rewind duration, source-frame span, playback rate, interpolation, and exit behavior.",
      ],
      failureSignals: [
        "Source time remains monotonic forward, or the construction replays the wrong source-frame span.",
      ],
      repairStrategies: [
        "Re-measure the reference source-time trajectory and retime the descending Time Remap keys to the observed span and duration.",
      ],
      transferCriteria: [
        "On materially different footage, preserve the negative source-time replay invariant while adapting span, duration, and exit behavior to the new reference.",
      ],
    },
    evidenceRefs: ["tutorial-analysis:sha256:" + fingerprintChar.repeat(64)],
  });

  const researchSources = [{
    sourceId: "tutorial-drive:smoothest-reverse-edit",
    kind: "TUTORIAL_DRIVE",
    title: "How To Make The Smoothest Reverse Edit? | After Effects Tutorial",
    uri: "https://drive.google.com/file/d/1XDrENfZUf36F2MYvMn62e8gDDUA1IzS6/view?usp=drivesdk",
    notes: "Closest Tutorial Drive match for the reference's actual backward source-time replay. Use it to extract the reverse-edit construction and timing logic before consulting Adobe documentation.",
    tutorialTechnique: {
      what: "A short backward replay of the source frames that were just shown, integrated into the transition rather than merely reversing parameter animation.",
      whenWhy: "Use when the reference visibly rewinds recent source-time motion to create a recoil/return beat before the transition exits.",
      how: "Enable Time Remap and shape a descending source-time segment over the measured rewind span, then combine it with the reference-defined transition motion.",
      access: "Requires source handles plus AE Time Remap/keyframe control; optional higher-order retiming can use a proven alternative only when native remap is insufficient.",
      proof: "Verify source-time direction from AE readback and rendered frame correspondence showing the same recently played frames moving backward.",
      transfer: "Adapt rewind span, speed, interpolation, and exit behavior to new footage from measured source motion and available handles instead of copying tutorial constants.",
    },
    tutorialCompilation: reverseCompilation(
      "tutorial.smoothest-reverse",
      "tutorial-skill.reverse-playback",
      "a",
    ),
  }, {
    sourceId: "tutorial-drive:smooth-zoom-reverse",
    kind: "TUTORIAL_DRIVE",
    title: "Smooth Zoom + Reverse Effect Tutorial | After Effects",
    uri: "https://drive.google.com/file/d/18VN6VBc8Bsig2D5itq3_zfG4PTuc6vSq/view?usp=drivesdk",
    notes: "Secondary Tutorial Drive match for combining reverse playback with transition motion and recovery, relevant to the reference's reverse exit behavior.",
    tutorialTechnique: {
      what: "A zoom/motion transition layered with reverse playback so the temporal rewind and spatial transition read as one gesture.",
      whenWhy: "Use when a reference couples a rewind beat to a camera-like push/pull and the spatial motion must recover with the temporal event.",
      how: "Bind the reverse source-time segment and the zoom/reframe envelope to the same measured transition anchor, using shot-specific transform values.",
      access: "Requires proven Time Remap plus transform/easing controls; plugin-specific warp is optional and cannot be assumed.",
      proof: "Compare temporal direction, transition anchor, scale/position trajectory, and rendered recovery against the reference window.",
      transfer: "Scale the motion envelope and rewind timing to the new shot's duration, motion energy, subject framing, and usable source handles.",
    },
    tutorialCompilation: reverseCompilation(
      "tutorial.smooth-zoom-reverse",
      "tutorial-skill.smooth-zoom-reverse",
      "b",
    ),
  }, {
    sourceId: "adobe:time-remapping",
    kind: "ADOBE_DOCUMENTATION",
    title: "Time-stretching and time-remapping",
    uri: "https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/time-stretching-and-time-remapping/time-stretching-time-remapping.html",
    notes: "Second-priority official semantics for implementing the tutorial-derived reverse construction with native Time Remap.",
  }, {
    sourceId: "adobe:timewarp",
    kind: "ADOBE_DOCUMENTATION",
    title: "Using time effects in After Effects",
    uri: "https://helpx.adobe.com/after-effects/desktop/apply-effects-and-animation-presets/list-of-effects/time-effects.html",
    notes: "Second-priority official fallback when the tutorial-derived construction needs higher-quality or more complex retiming than a basic remap.",
  }];
  const researchEvent = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "RESEARCH",
    outcome: "SUCCESS",
    summary: "Tutorial Drive was searched first and produced direct reverse-edit matches; Adobe documentation was then used only to confirm native Time Remap semantics for implementing the tutorial-derived construction.",
    researchSources,
    evidenceRefs: ["research:tutorial-drive-smoothest-reverse", "research:tutorial-drive-smooth-zoom-reverse", "research:adobe-time-remap", "research:adobe-timewarp"],
  });
  registry.recordGptLearningEvent(researchEvent);
  await assert.rejects(
    store.appendEvent({
      assignmentId: assignment.assignmentId,
      stage: "CAPABILITY_PROOF",
      outcome: "SUCCESS",
      summary: "A proof cannot skip implementation.",
      capabilityGap: gapOpen,
      evidenceRefs: ["render:premature-proof"],
    }),
    /prior CAPABILITY_IMPLEMENTATION/,
  );
  const implementationEvent = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "CAPABILITY_IMPLEMENTATION",
    outcome: "SUCCESS",
    summary: "Built an AE Time Remap curve with a descending source-time segment over the measured rewind window.",
    capabilityGap: gapOpen,
    detail: "Forward source time increases into the event, then decreases across the rewind span before the reference-defined exit.",
    evidenceRefs: ["construction:temporal-rewind:v1", "readback:time-remap-keyframes"],
  });
  registry.recordGptLearningEvent(implementationEvent);

  const proofEvent = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "CAPABILITY_PROOF",
    outcome: "SUCCESS",
    summary: "Rendered AE evidence shows the same source frames replay backward over the measured rewind span before the transition exits.",
    capabilityGap: gapOpen,
    evidenceRefs: ["render:temporal-rewind-proof", "comparison:temporal-rewind-source-time-proof"],
  });
  registry.recordGptLearningEvent(proofEvent);
  const learnedSkill = {
    skillId: "skill:temporal-rewind:v1",
    title: "Temporal Rewind / Reverse Playback",
    requestedBehavior: gapOpen.requestedBehavior,
    maturity: "AE_PROVEN",
    constructionPattern: "Enable Time Remap, preserve the forward source-time path, add a bounded descending source-time segment that replays the just-shown frames backward, then cut or resume according to the reference.",
    capabilityIds: ["ae.layer.time_remap.enable", "ae.keyframe.set", "ae.keyframe.temporal_ease"],
    adaptationNotes: "Adapt rewind duration, source-frame span, playback rate, interpolation, and whether playback resumes forward or cuts directly into the next shot.",
    causalModel: {
      triggerConditions: [
        "The reference visibly replays source frames that were just shown before the transition exits.",
      ],
      invariants: [
        "Source time descends during the rewind phase while the replayed frame sequence remains temporally coherent.",
      ],
      adaptationAxes: [
        "Rewind duration, source-frame span, playback rate, interpolation, and exit behavior.",
      ],
      failureSignals: [
        "Source time remains monotonic forward, or the construction replays the wrong source-frame span.",
      ],
      repairStrategies: [
        "Re-measure the reference source-time trajectory and retime the descending Time Remap keys to the observed span and duration.",
      ],
      transferCriteria: [
        "On materially different footage, preserve the negative source-time replay invariant while adapting span, duration, and exit behavior to the new reference.",
      ],
    },
    machineUseSignature: {
      schema: "editflow.gpt-skill-machine-use-signature.v1",
      invariantRules: [{
        invariant: "Source time descends during the rewind phase while the replayed frame sequence remains temporally coherent.",
        evidence: [
          { source: "RATIONALE_CODE", match: "EXACT", value: "REFERENCE_REWIND_MEASURED" },
          { source: "CUE_ID", match: "PREFIX", value: "rewind-span-ms:" },
          { source: "CONSTRUCTION_ID", match: "PREFIX", value: "construction:temporal-rewind:" },
        ],
      }],
    },
    researchSources,
    evidenceRefs: ["render:temporal-rewind-proof", "comparison:temporal-rewind-source-time-proof"],
    learnedAt: new Date().toISOString(),
  };
  const resolvedGap = {
    ...gapOpen,
    status: "RESOLVED",
    resolutionSkillId: learnedSkill.skillId,
    evidenceRefs: [...gapOpen.evidenceRefs, ...learnedSkill.evidenceRefs],
  };
  await assert.rejects(
    store.appendEvent({
      assignmentId: assignment.assignmentId,
      stage: "SKILL_COMMIT",
      outcome: "SUCCESS",
      summary: "A single Practice session cannot self-assign transfer maturity.",
      capabilityGap: resolvedGap,
      learnedSkill: { ...learnedSkill, maturity: "TRANSFER_VERIFIED" },
      evidenceRefs: learnedSkill.evidenceRefs,
    }),
    /TRANSFER_VERIFIED is assigned only after a machine-verified transfer Practice completion/,
  );
  await assert.rejects(
    store.appendEvent({
      assignmentId: assignment.assignmentId,
      stage: "SKILL_COMMIT",
      outcome: "SUCCESS",
      summary: "A reusable skill without invariant-to-machine-evidence bindings is not certifiable.",
      capabilityGap: resolvedGap,
      learnedSkill: { ...learnedSkill, machineUseSignature: undefined },
      evidenceRefs: learnedSkill.evidenceRefs,
    }),
    /machineUseSignature/,
  );
  const commitEvent = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "SKILL_COMMIT",
    outcome: "SUCCESS",
    summary: "Committed the AE-proven temporal-rewind skill to microwave-edit.",
    capabilityGap: resolvedGap,
    learnedSkill: {
      ...learnedSkill,
      constructionPattern: "GPT placeholder that must be replaced by compiled tutorial semantics.",
      capabilityIds: [],
      adaptationNotes: undefined,
      causalModel: undefined,
      researchSources: [],
    },
    reusableLesson: "When the reference replays recently shown frames backward, reproduce actual reverse source-time motion; reversing effect parameters or merely decaying the transition is not equivalent.",
    developmentPattern: "Detect missing temporal behavior, search the Tutorial Drive for the closest matching construction first, escalate to Adobe only when needed, prove source-time direction plus rendered appearance in AE, then retain the transferable construction.",
    evidenceRefs: learnedSkill.evidenceRefs,
  });
  assert.doesNotMatch(commitEvent.learnedSkill.constructionPattern, /GPT placeholder/);
  assert.deepEqual(commitEvent.learnedSkill.capabilityIds, learnedSkill.capabilityIds);
  assert.equal(commitEvent.learnedSkill.causalModel.transferCriteria.length, 1);
  assert.equal(commitEvent.learnedSkill.researchSources[0].kind, "TUTORIAL_DRIVE");
  registry.recordGptLearningEvent(commitEvent);

  const completed = await store.complete(assignment.assignmentId, {
    success: true,
    finalRenderRef: "render:mastered",
    finalSummary: "Reference reconstructed with the newly learned temporal-rewind skill.",
  });
  registry.completeGptLearningSession({
    editTypeId: "microwave-edit",
    sessionId,
    mode: "PRACTICE",
    mastered: completed.status === "COMPLETED",
    masteryRecord: transferMasteryRecord(sessionId, "skill-base"),
  });

  const knowledge = registry.knowledge("microwave-edit");
  assert.equal(knowledge.gptLearning.learnedSkills.length, 1);
  assert.equal(knowledge.gptLearning.learnedSkills[0].maturity, "AE_PROVEN");
  assert.equal(knowledge.gptLearning.capabilityGaps[0].status, "RESOLVED");
  assert.equal(
    knowledge.gptLearning.capabilityGaps[0].resolutionSkillId,
    learnedSkill.skillId,
  );
  const pro = new ProCreationPreparationEngineV1(registry).prepare({
    sessionId: "pro:capability-discovery:001",
    mode: "PRO_CREATION",
    editTypeId: "microwave-edit",
    start,
  });
  assert.equal(pro.status, "READY");
  assert.equal(pro.knowledge.knowledgeScope, "TRANSFER_VERIFIED_ONLY");
  assert.equal(pro.knowledge.gptLearning.learnedSkills.length, 0);

  const proMessage = buildGptOrchestrationChatMessageV1({
    sessionId: "pro:capability-discovery:chat:001",
    mode: "PRO_CREATION",
    editTypeId: "microwave-edit",
    finish: null,
    start,
    practicePolicy: null,
    artifactDir: "C:\\EditFlow\\artifacts\\pro-capability-discovery",
    knowledge,
  });
  assert.doesNotMatch(proMessage, /skill:temporal-rewind:v1/);
  assert.match(proMessage, /only TRANSFER_VERIFIED learned skills/i);

  const [transferSkillUseAttestation] = attestPracticeSkillUseV1({
    skills: [learnedSkill],
    acceptedMaturities: ["AE_PROVEN", "TRANSFER_VERIFIED"],
    attempt: {
      renderRef: "render:mastered",
      decisionTraces: [{
        cueIds: ["rewind-span-ms:420"],
        rationaleCodes: ["REFERENCE_REWIND_MEASURED"],
        constructionIds: ["construction:temporal-rewind:transfer-proof"],
      }],
      evidenceRefs: [
        "render:temporal-rewind-transfer-proof",
        "comparison:temporal-rewind-transfer-proof",
      ],
    },
    proof: {
      finalRenderRef: "render:mastered",
      effectFamilyIds: [],
      evidenceRefs: ["proof:temporal-rewind-transfer-proof"],
    },
  });
  assert.equal(transferSkillUseAttestation.verified, true);

  const referenceOnlySkillSession = "practice:skill-reference-only:002";
  registry.beginGptLearningSession("microwave-edit", referenceOnlySkillSession, "PRACTICE");
  assert.throws(
    () => registry.completeGptLearningSession({
      editTypeId: "microwave-edit",
      sessionId: referenceOnlySkillSession,
      mode: "PRACTICE",
      mastered: true,
      masteryRecord: {
        ...transferMasteryRecord(referenceOnlySkillSession),
        scope: "REFERENCE_VERIFIED",
      },
      transferSkillUseAttestations: [transferSkillUseAttestation],
    }),
    /only after a machine-verified transfer Practice completion/,
  );

  const transferSkillSession = "practice:skill-transfer:003";
  registry.beginGptLearningSession("microwave-edit", transferSkillSession, "PRACTICE");
  assert.throws(
    () => registry.completeGptLearningSession({
      editTypeId: "microwave-edit",
      sessionId: transferSkillSession,
      mode: "PRACTICE",
      mastered: true,
      masteryRecord: transferMasteryRecord(transferSkillSession),
      transferVerifiedSkillIds: [learnedSkill.skillId],
    }),
    /machine-attested reconstruction evidence/,
  );
  assert.throws(
    () => registry.completeGptLearningSession({
      editTypeId: "microwave-edit",
      sessionId: transferSkillSession,
      mode: "PRACTICE",
      mastered: true,
      masteryRecord: transferMasteryRecord(transferSkillSession, "skill-base"),
      transferSkillUseAttestations: [transferSkillUseAttestation],
    }),
    /prior machine-verified AE proof for the same learned skill on materially different Finish and Start footage/,
  );
  registry.completeGptLearningSession({
    editTypeId: "microwave-edit",
    sessionId: transferSkillSession,
    mode: "PRACTICE",
    mastered: true,
    masteryRecord: transferMasteryRecord(transferSkillSession, "skill-transfer"),
    transferSkillUseAttestations: [transferSkillUseAttestation],
  });
  const transferKnowledge = registry.knowledge("microwave-edit");
  assert.equal(transferKnowledge.gptLearning.learnedSkills[0].maturity, "TRANSFER_VERIFIED");
  assert.deepEqual(
    transferKnowledge.gptLearning.learnedSkills[0].provenSessionIds,
    [sessionId, transferSkillSession],
  );
  assert.equal(
    transferKnowledge.gptLearning.learnedSkills[0].causalModel.transferCriteria.length,
    1,
  );
  const promotedPro = new ProCreationPreparationEngineV1(registry).prepare({
    sessionId: "pro:capability-discovery:002",
    mode: "PRO_CREATION",
    editTypeId: "microwave-edit",
    start,
  });
  assert.equal(promotedPro.status, "READY");
  assert.equal(promotedPro.knowledge.knowledgeScope, "TRANSFER_VERIFIED_ONLY");
  assert.equal(promotedPro.knowledge.gptLearning.learnedSkills[0].skillId, learnedSkill.skillId);
  const transferredMessage = buildGptOrchestrationChatMessageV1({
    sessionId: "pro:capability-discovery:chat:002",
    mode: "PRO_CREATION",
    editTypeId: "microwave-edit",
    finish: null,
    start,
    practicePolicy: null,
    artifactDir: "C:\\EditFlow\\artifacts\\pro-capability-discovery",
    knowledge: transferKnowledge,
  });
  assert.match(transferredMessage, /skill:temporal-rewind:v1/);

  const events = await store.eventsForSession(sessionId);
  assert.deepEqual(
    events.map((event) => event.stage),
    [
      "CAPABILITY_GAP",
      "RESEARCH",
      "CAPABILITY_IMPLEMENTATION",
      "CAPABILITY_PROOF",
      "SKILL_COMMIT",
    ],
  );
  assert.equal(events[1].researchSources.length, 4);
  assert.equal(events[1].researchSources[0].kind, "TUTORIAL_DRIVE");
  assert.equal(events[1].researchSources[1].kind, "TUTORIAL_DRIVE");
  assert.match(events[1].researchSources[0].title, /Smoothest Reverse Edit/);
  assert.match(events[1].researchSources[1].title, /Smooth Zoom \+ Reverse Effect/);
  assert.equal(events[4].learnedSkill.skillId, learnedSkill.skillId);
});
