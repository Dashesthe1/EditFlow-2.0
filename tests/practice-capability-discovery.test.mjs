import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EditTypeRegistryV1,
  GptOrchestrationStoreV1,
  ProCreationPreparationEngineV1,
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
  assert.match(assignment.chatMessage, /online research is required/);
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
      summary: "Internal evidence alone is not enough to discover a new Practice skill.",
      researchSources: [{
        sourceId: "internal:prior-recipe",
        kind: "INTERNAL_EVIDENCE",
        title: "Prior recipe evidence",
      }],
    }),
    /online source with a URI/,
  );

  const researchSources = [{
    sourceId: "adobe:time-remapping",
    kind: "ADOBE_DOCUMENTATION",
    title: "Time-stretching and time-remapping",
    uri: "https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/time-stretching-and-time-remapping/time-stretching-time-remapping.html",
    notes: "Time Remap can play footage forward, replay a bounded span backward, then resume forward when the reference requires it.",
  }, {
    sourceId: "adobe:timewarp",
    kind: "ADOBE_DOCUMENTATION",
    title: "Using time effects in After Effects",
    uri: "https://helpx.adobe.com/after-effects/desktop/apply-effects-and-animation-presets/list-of-effects/time-effects.html",
    notes: "Timewarp can animate source-frame or speed control when the reference needs higher-quality or more complex retiming than a basic remap.",
  }];
  const researchEvent = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "RESEARCH",
    outcome: "SUCCESS",
    summary: "Adobe-native Time Remap provides a construction path for the missing temporal rewind, with source-time direction controlled by keyframe values.",
    researchSources,
    evidenceRefs: ["research:adobe-time-remap", "research:adobe-timewarp"],
  });
  registry.recordGptLearningEvent(researchEvent);
  await assert.rejects(
    store.appendEvent({
      assignmentId: assignment.assignmentId,
      stage: "CAPABILITY_PROOF",
      outcome: "SUCCESS",
      summary: "A proof cannot skip implementation.",
      evidenceRefs: ["render:premature-proof"],
    }),
    /prior CAPABILITY_IMPLEMENTATION/,
  );
  const implementationEvent = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "CAPABILITY_IMPLEMENTATION",
    outcome: "SUCCESS",
    summary: "Built an AE Time Remap curve with a descending source-time segment over the measured rewind window.",
    detail: "Forward source time increases into the event, then decreases across the rewind span before the reference-defined exit.",
    evidenceRefs: ["construction:temporal-rewind:v1", "readback:time-remap-keyframes"],
  });
  registry.recordGptLearningEvent(implementationEvent);

  const proofEvent = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "CAPABILITY_PROOF",
    outcome: "SUCCESS",
    summary: "Rendered AE evidence shows the same source frames replay backward over the measured rewind span before the transition exits.",
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
  const commitEvent = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "SKILL_COMMIT",
    outcome: "SUCCESS",
    summary: "Committed the AE-proven temporal-rewind skill to microwave-edit.",
    capabilityGap: resolvedGap,
    learnedSkill,
    reusableLesson: "When the reference replays recently shown frames backward, reproduce actual reverse source-time motion; reversing effect parameters or merely decaying the transition is not equivalent.",
    developmentPattern: "Detect missing temporal behavior, research authoritative/native controls, prove source-time direction plus rendered appearance in AE, then retain the transferable construction.",
    evidenceRefs: learnedSkill.evidenceRefs,
  });
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
  assert.equal(pro.knowledge.gptLearning.learnedSkills[0].skillId, learnedSkill.skillId);

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
  assert.equal(events[1].researchSources.length, 2);
  assert.equal(events[4].learnedSkill.skillId, learnedSkill.skillId);
});
