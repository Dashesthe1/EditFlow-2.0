import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  assert.match(migrated.chatMessage, /Adobe Effect Tutorials/);
  assert.match(migrated.chatMessage, /Second priority is official Adobe documentation\/resources/);
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

  const researchSources = [{
    sourceId: "tutorial-drive:smoothest-reverse-edit",
    kind: "TUTORIAL_DRIVE",
    title: "How To Make The Smoothest Reverse Edit? | After Effects Tutorial",
    uri: "https://drive.google.com/file/d/1XDrENfZUf36F2MYvMn62e8gDDUA1IzS6/view?usp=drivesdk",
    notes: "Closest Tutorial Drive match for the reference's actual backward source-time replay. Use it to extract the reverse-edit construction and timing logic before consulting Adobe documentation.",
  }, {
    sourceId: "tutorial-drive:smooth-zoom-reverse",
    kind: "TUTORIAL_DRIVE",
    title: "Smooth Zoom + Reverse Effect Tutorial | After Effects",
    uri: "https://drive.google.com/file/d/18VN6VBc8Bsig2D5itq3_zfG4PTuc6vSq/view?usp=drivesdk",
    notes: "Secondary Tutorial Drive match for combining reverse playback with transition motion and recovery, relevant to the reference's reverse exit behavior.",
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
    developmentPattern: "Detect missing temporal behavior, search the Tutorial Drive for the closest matching construction first, escalate to Adobe only when needed, prove source-time direction plus rendered appearance in AE, then retain the transferable construction.",
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
  assert.equal(events[1].researchSources.length, 4);
  assert.equal(events[1].researchSources[0].kind, "TUTORIAL_DRIVE");
  assert.equal(events[1].researchSources[1].kind, "TUTORIAL_DRIVE");
  assert.match(events[1].researchSources[0].title, /Smoothest Reverse Edit/);
  assert.match(events[1].researchSources[1].title, /Smooth Zoom \+ Reverse Effect/);
  assert.equal(events[4].learnedSkill.skillId, learnedSkill.skillId);
});
