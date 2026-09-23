import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EditTypeRegistryFileV1,
  EditTypeRegistryV1,
  GptOrchestrationStoreV1,
  compileGptTutorialResearchSourceV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";

const packet = () => ({
  schema: "editflow.tutorial-analysis.v1",
  tutorialId: "tutorial.impact-push.001",
  title: "Motion-aware impact push",
  sourceRef: "drive://tutorial/impact-push.mp4",
  durationMs: 5000,
  evidenceRefs: ["video:0-5s", "transcript:all"],
  skills: [{
    skillId: "tutorial-skill.impact-push",
    name: "Motion-aware impact push",
    what: {
      objective: "Create a brief scale-and-position accent while preserving subject readability.",
      components: [{
        componentId: "push",
        visibleResult: "The frame pushes toward the hero subject at the accent.",
        role: "Increase impact and direct attention.",
        interactions: ["Scale and position cooperate to preserve framing."],
      }],
    },    whenWhy: {
      creativeIntent: "Emphasize a meaningful motion or beat accent.",
      attentionGoal: "Pull attention toward the hero subject.",
      emotionalPurpose: "Increase impact without overstaying the moment.",
      pacingRole: "Short accent rather than persistent motion.",
      musicRelationship: "Prefer a strong transient when music supplies one.",
      dialogueRelationship: "Reduce intensity when dialogue readability is primary.",
      motionConditions: ["Subject motion remains readable during the push."],
      compositionConditions: ["There is enough framing margin for the push."],
      continuityConstraints: ["Do not create a positional jump across the cut."],
      useWhen: ["A clear visual or musical accent benefits from emphasis."],
      avoidWhen: ["The shot is already unstable or tightly cropped."],
      restraintRule: "Use the smallest push that clearly communicates the accent.",
    },
    how: {
      topology: ["single hero layer with semantic transform animation"],
      timingModel: "Anchor the push near the selected event and return quickly.",
      easingModel: "Fast ease into impact with a controlled recovery.",
      adaptationRules: ["Derive scale from crop margin and subject size."],
      mechanisms: [{
        mechanismId: "push",
        primitive: "TRANSFORM_ANIMATION",
        startMs: 1200,
        endMs: 1800,
        intent: "Push toward the subject while maintaining readable framing.",
        construction: "Animate scale and position around the semantic accent.",
        observableResult: "The hero grows briefly without leaving the safe framing region.",
        dependsOn: [],        parameters: [{
          name: "pushIntensity",
          intent: "Increase impact without clipping the subject.",
          derivedFrom: ["subjectScale", "cropMargin", "accentStrength"],
          normalizedRange: { min: 0.1, max: 0.8 },
        }],
        timing: { anchor: "EVENT", eventRef: "impact", durationMs: 600 },
        evidenceRefs: ["video:1.2-1.8s"],
      }],
    },
    access: {
      bindings: [{
        mechanismId: "push",
        capabilityRequirements: [{
          capabilityId: "ae.layer.transform.set",
          reason: "Animate the semantic subject transform.",
          minimumProofMaturity: "TRANSFER",
        }],
      }],
    },
    proof: {
      validationCriteria: ["Subject remains readable throughout the push."],
      invariants: ["Transform target remains the intended hero layer."],
      failureModes: [{
        condition: "The push crops the subject.",
        diagnosis: "Intensity exceeds available composition margin.",
        repairStrategy: "Reduce scale or compensate position before changing timing.",
      }],
      transferAxes: ["different subject scale", "different aspect ratio"],
      robustnessAxes: ["off-center subject", "short shot handles"],
    },    scenePrerequisites: ["A hero subject or framing target can be identified."],
    knowledgeDelta: {
      newConcepts: ["Push intensity should be bounded by crop margin."],
      reinforcedConcepts: [],
      newCombinations: [],
      refinements: [],
      contradictions: [],
    },
    compatibleTechniques: ["BEAT_ACCENT"],
    conflictingTechniques: [],
  }],
});

const compileSource = () => compileGptTutorialResearchSourceV1({
  packet: packet(),
  tutorialSkillId: "tutorial-skill.impact-push",
  targetSkillId: "skill:impact-push:v1",
  tutorialDriveUri: "https://drive.google.com/file/d/tutorial-impact-push/view",
});

test("deep Tutorial Drive analysis deterministically compiles causal Practice semantics", () => {
  const source = compileSource();
  const compiled = source.tutorialCompilation;
  assert.ok(compiled);
  assert.equal(compiled.targetSkillId, "skill:impact-push:v1");
  assert.match(compiled.analysisFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(compiled.capabilityIds, ["ae.layer.transform.set"]);
  assert.ok(compiled.causalModel.triggerConditions.some((item) =>
    /hero subject or framing target/i.test(item)));
  assert.ok(compiled.causalModel.invariants.some((item) =>
    /intended hero layer/i.test(item)));
  assert.ok(compiled.causalModel.adaptationAxes.includes("subjectScale"));  assert.ok(compiled.causalModel.failureSignals.some((item) =>
    /crops the subject/i.test(item)));
  assert.ok(compiled.causalModel.repairStrategies.some((item) =>
    /reduce scale/i.test(item)));
  assert.ok(compiled.causalModel.transferCriteria.every((item) => item.length > 0));
  assert.ok(compiled.evidenceRefs.some((item) =>
    item.startsWith("tutorial-analysis:sha256:")));
  assert.match(source.tutorialTechnique.what, /scale-and-position accent/i);
  assert.match(source.tutorialTechnique.transfer, /different subject scale/i);
});

test("SKILL_COMMIT replaces GPT placeholders with compiler-backed tutorial semantics", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-causal-compiler-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new GptOrchestrationStoreV1(path.join(root, "gpt.json"));
  const assignment = await store.createAssignment({
    sessionId: "practice:causal-compiler:001",
    mode: "PRACTICE",
    practiceRole: "LEARNING",
    editTypeId: "impact-edit",
    finish: {
      mediaId: "finish:1",
      role: "FINISH_REFERENCE",
      mediaKind: "VIDEO",
      uri: "C:\\media\\finish.mp4",
    },
    start: [{
      mediaId: "video:1",
      role: "START_SOURCE",
      mediaKind: "VIDEO",
      uri: "C:\\media\\raw.mp4",
    }],
    artifactDir: path.join(root, "artifacts"),
    knowledge: null,
  });
  await store.claim(assignment.assignmentId, "test");  const gapOpen = {
    gapId: "gap:impact-push",
    kind: "RECIPE_SKILL",
    requestedBehavior: "Reproduce the reference's motion-aware impact push.",
    missingCapabilityIds: [],
    status: "OPEN",
    evidenceRefs: ["reference:impact-push"],
  };
  await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "CAPABILITY_GAP",
    summary: "Impact-push construction is missing.",
    capabilityGap: gapOpen,
    evidenceRefs: gapOpen.evidenceRefs,
  });
  const source = compileSource();
  await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "RESEARCH",
    outcome: "SUCCESS",
    summary: "Deep-analyzed the matching Tutorial Drive technique.",
    researchSources: [source],
    evidenceRefs: source.tutorialCompilation.evidenceRefs,
  });
  await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "CAPABILITY_IMPLEMENTATION",
    outcome: "SUCCESS",
    summary: "Implemented the tutorial-derived impact-push construction in AE.",
    evidenceRefs: ["ae:implementation:impact-push"],
  });
  await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "CAPABILITY_PROOF",
    outcome: "SUCCESS",    summary: "AE render and readback prove the reconstructed behavior.",
    evidenceRefs: ["render:impact-push", "comparison:impact-push"],
  });
  const resolvedGap = {
    ...gapOpen,
    status: "RESOLVED",
    resolutionSkillId: "skill:impact-push:v1",
  };
  const committed = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    stage: "SKILL_COMMIT",
    outcome: "SUCCESS",
    summary: "Commit the AE-proven impact-push skill.",
    capabilityGap: resolvedGap,
    learnedSkill: {
      skillId: "skill:impact-push:v1",
      title: "Impact Push",
      requestedBehavior: gapOpen.requestedBehavior,
      maturity: "AE_PROVEN",
      constructionPattern: "GPT placeholder that must not survive.",
      capabilityIds: [],
      researchSources: [],
      evidenceRefs: ["render:impact-push", "comparison:impact-push"],
      learnedAt: "2026-09-23T23:00:00.000Z",
    },
    evidenceRefs: ["render:impact-push", "comparison:impact-push"],
  });
  assert.doesNotMatch(committed.learnedSkill.constructionPattern, /GPT placeholder/);
  assert.match(committed.learnedSkill.constructionPattern, /TRANSFORM_ANIMATION/);
  assert.deepEqual(committed.learnedSkill.capabilityIds, ["ae.layer.transform.set"]);
  assert.match(committed.learnedSkill.adaptationNotes, /different subject scale/);
  assert.ok(committed.learnedSkill.causalModel.triggerConditions.length > 0);
  assert.ok(committed.learnedSkill.causalModel.invariants.length > 0);
  assert.ok(committed.learnedSkill.causalModel.transferCriteria.length > 0);
  assert.equal(committed.learnedSkill.researchSources[0].sourceId, source.sourceId);
});

test("Practice Panel compiles deep tutorial analysis through the product API", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-causal-api-"));
  const token = "tutorial-causal-api-test-token-0123456789";
  const registryPath = path.join(root, "state", "edit-types.json");
  const gptPath = path.join(root, "state", "gpt.json");

  const editTypes = new EditTypeRegistryV1();
  editTypes.create({
    editTypeId: "impact-edit",
    title: "Impact Edit",
  });
  await new EditTypeRegistryFileV1(registryPath).save(editTypes);

  const store = new GptOrchestrationStoreV1(gptPath);
  const assignment = await store.createAssignment({
    sessionId: "practice:causal-api:001",
    mode: "PRACTICE",
    practiceRole: "LEARNING",
    editTypeId: "impact-edit",
    finish: {
      mediaId: "finish:1",
      role: "FINISH_REFERENCE",
      mediaKind: "VIDEO",
      uri: "C:\\media\\finish.mp4",
    },    start: [{
      mediaId: "video:1",
      role: "START_SOURCE",
      mediaKind: "VIDEO",
      uri: "C:\\media\\raw.mp4",
    }],
    artifactDir: path.join(root, "artifacts"),
    knowledge: null,
  });
  await store.claim(assignment.assignmentId, "test");

  const broker = new LoopbackCepBroker({ port: 0, token });
  await broker.start();
  const service = new PracticePanelServerV1({
    port: 0,
    token,
    repositoryRoot: process.cwd(),
    artifactDir: path.join(root, "artifacts"),
    learningMemoryFilePath: path.join(root, "state", "memory.json"),
    editTypeRegistryFilePath: registryPath,
    gptOrchestrationFilePath: gptPath,
    broker,
  });
  const port = await service.start();
  t.after(async () => {
    await service.stop();
    await broker.stop();
    await rm(root, { recursive: true, force: true });
  });

  const response = await fetch(
    "http://127.0.0.1:" + String(port)
      + "/v1/product/gpt/assignments/"
      + encodeURIComponent(assignment.assignmentId)
      + "/tutorial-compilations",    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-EditFlow-Token": token,
      },
      body: JSON.stringify({
        tutorialAnalysis: packet(),
        tutorialSkillId: "tutorial-skill.impact-push",
        targetSkillId: "skill:impact-push:v1",
        tutorialDriveUri: "https://drive.google.com/file/d/tutorial-impact-push/view",
        summary: "Compile the matched impact-push tutorial into causal Practice knowledge.",
      }),
    },
  );
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.researchSource.kind, "TUTORIAL_DRIVE");
  assert.equal(
    payload.researchSource.tutorialCompilation.targetSkillId,
    "skill:impact-push:v1",
  );
  assert.match(
    payload.researchSource.tutorialCompilation.analysisFingerprint,
    /^[0-9a-f]{64}$/,
  );

  const shapedSubmission = await fetch(
    "http://127.0.0.1:" + String(port)
      + "/v1/product/gpt/assignments/"
      + encodeURIComponent(assignment.assignmentId)
      + "/events",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-EditFlow-Token": token,
      },
      body: JSON.stringify({
        stage: "RESEARCH",
        outcome: "SUCCESS",
        summary: "A caller-shaped compiler record must not bypass the compiler endpoint.",
        researchSources: [payload.researchSource],
      }),
    },
  );
  assert.equal(shapedSubmission.status, 400);
  assert.match(
    (await shapedSubmission.json()).error,
    /tutorial-compilations endpoint/,
  );

  const events = await store.eventsForSession(assignment.sessionId);
  assert.equal(events.length, 1);
  assert.equal(events[0].stage, "RESEARCH");
  assert.equal(
    events[0].researchSources[0].tutorialCompilation.targetSkillId,
    "skill:impact-push:v1",
  );

  const reloaded = await new EditTypeRegistryFileV1(registryPath).load();
  const knowledge = reloaded.knowledge("impact-edit");
  assert.equal(knowledge.gptLearning.eventCount, 1);
});
