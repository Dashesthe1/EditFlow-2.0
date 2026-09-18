import assert from "node:assert/strict";
import test from "node:test";
import { EditorKnowledgeBase, evaluateEdit } from "../.tmp/runtime/packages/editor-learning/src/index.js";

const skill = {
  id: "skill.impact_speed_ramp",
  name: "Impact Speed Ramp",
  summary: "Compresses motion into an impact using temporal acceleration and a clean landing.",
  domains: ["timing", "motion"],
  tags: ["speed ramp", "impact", "high energy"],
  intents: ["build anticipation", "hit accent"],
  prerequisites: [],
  whenToUse: ["Action has a clear acceleration or impact point."],
  whenNotToUse: ["The shot has no readable motion."],
  whyItWorks: ["Acceleration creates anticipation and contrast around the impact."],
  procedure: [{
    id: "1",
    intent: "shape timing",
    action: "accelerate into impact",
    expectedOutcome: "impact lands sharply",
    requiredCapabilities: ["time_remap"],
  }],
  parameterGuidance: [],
  visualTargets: ["Subject remains readable through the impact."],
  failureModes: ["Over-compression makes the action unreadable."],
  adaptationRules: ["Align the timing peak to the actual motion apex."],
  variants: [],
  sourceIds: ["tutorial.01"],
  confidence: 0.9,
  mastery: "OBSERVED",
};

const extraction = {
  source: {
    sourceId: "tutorial.01",
    title: "Speed Ramp Tutorial",
    sourceRef: "tutorial-01.mp4",
    durationSeconds: 60,
    tags: ["speed ramp"],
  },
  demonstrations: [{
    demonstrationId: "demo.01",
    sourceId: "tutorial.01",
    title: "Impact ramp",
    objective: "Hit action accent",
    contextTags: ["impact"],
    actions: [],
    observations: [],
    inferredPrinciples: [],
    candidateSkillIds: [skill.id],
  }],
  skills: [skill],
  edges: [],
};

const goodMetrics = [
  ["intent_match", 0.9],
  ["timing", 0.9],
  ["pacing", 0.85],
  ["continuity", 0.8],
  ["readability", 0.9],
  ["motion_quality", 0.85],
  ["color_consistency", 0.8],
  ["sound_sync", 0.9],
  ["effect_restraint", 0.85],
  ["technical_integrity", 0.95],
].map(([dimension, score]) => ({ dimension, score, note: "ok" }));

test("ingests tutorial knowledge and retrieves the relevant skill with failure memory", () => {
  const kb = new EditorKnowledgeBase();
  kb.ingestTutorial(extraction);
  const evaluation = evaluateEdit(goodMetrics);
  kb.recordExperience({
    id: "exp.fail",
    createdAt: "2026-09-08T00:00:00Z",
    outcome: "FAILURE",
    practiceKind: "TRANSFER",
    skillIds: [skill.id],
    contextSignature: "clip-b",
    contextTags: ["impact", "fast motion"],
    decision: "Use aggressive speed ramp",
    result: "Subject became unreadable",
    lessons: ["Reduce compression around the face."],
    evaluation: { ...evaluation, passed: false, overallScore: 0.55 },
  });

  const result = kb.retrieve({
    goal: "make a high energy impact transition",
    tags: ["speed ramp"],
    energy: "high",
    shotMotion: ["fast motion"],
    audioEvents: ["impact beat"],
    constraints: [],
  }, 1);

  assert.equal(result.skills[0]?.skill.id, skill.id);
  assert.equal(result.skills[0]?.warningExperiences[0]?.id, "exp.fail");
});

test("critical evaluation failures block a pass even with otherwise good scores", () => {
  const metrics = goodMetrics.map((metric) => metric.dimension === "readability" ? { ...metric, score: 0.2 } : metric);
  const result = evaluateEdit(metrics);
  assert.equal(result.passed, false);
  assert.ok(result.failedCriticalDimensions.includes("readability"));
});

test("curriculum starts with reconstruction and then creates transfer exercises", () => {
  const kb = new EditorKnowledgeBase();
  kb.ingestTutorial(extraction);
  const contexts = [
    {
      goal: "apply to a slow push-in",
      tags: ["dramatic"],
      energy: "medium",
      shotMotion: ["push in"],
      audioEvents: ["bass hit"],
      constraints: [],
    },
    {
      goal: "apply to lateral action",
      tags: ["action"],
      energy: "high",
      shotMotion: ["left to right"],
      audioEvents: ["snare"],
      constraints: [],
    },
  ];
  const exercises = kb.generateTransferCurriculum(skill.id, contexts, 3);
  assert.equal(exercises.length, 3);
  assert.equal(exercises[0]?.practiceKind, "RECONSTRUCTION");
  assert.equal(exercises[1]?.practiceKind, "TRANSFER");
});

test("mastery is derived from successful reconstruction, transfer, and object-aware evidence", () => {
  const kb = new EditorKnowledgeBase();
  kb.ingestTutorial(extraction);
  const add = (id, practiceKind, contextSignature, score = 0.9) => kb.recordExperience({
    id,
    createdAt: `2026-09-08T00:00:0${id.length}Z`,
    outcome: "SUCCESS",
    practiceKind,
    skillIds: [skill.id],
    contextSignature,
    contextTags: ["impact"],
    decision: "apply",
    result: "good",
    lessons: [],
    evaluation: { ...evaluateEdit(goodMetrics), overallScore: score, passed: true },
  });

  add("r1", "RECONSTRUCTION", "base");
  add("t1", "TRANSFER", "clip-a");
  add("t2", "TRANSFER", "clip-b");
  assert.equal(kb.deriveMastery(skill.id), "TRANSFER_VERIFIED");
  add("o1", "OBJECT_AWARE", "clip-c");
  add("p1", "PRODUCTION", "clip-d");
  assert.equal(kb.deriveMastery(skill.id), "ROBUST");
});
