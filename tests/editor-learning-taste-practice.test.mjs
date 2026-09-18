import assert from "node:assert/strict";
import test from "node:test";
import { EditorialTasteLibrary, assertCriticEvidenceGrounded, selectRefinementFocus } from "../.tmp/runtime/packages/editor-learning/src/reference-learning.js";
import { createPracticeProgram, nextPracticeStage } from "../.tmp/runtime/packages/editor-learning/src/practice.js";

const context = {
  goal: "build a high energy action climax while keeping the face readable",
  tags: ["action", "climax", "subject readability"],
  energy: "high",
  shotMotion: ["fast lateral motion"],
  audioEvents: ["impact beat"],
  constraints: ["do not obscure the face"],
};

const readabilityPrinciple = {
  id: "principle.preserve_subject_readability",
  name: "Preserve subject readability under effect density",
  summary: "Layered treatment should keep the subject silhouette or face as the visual anchor.",
  origin: "PROFESSIONAL_REFERENCE",
  domains: ["visual hierarchy", "effects"],
  tags: ["subject readability", "face", "layered effects"],
  whenToApply: ["High-energy treatment adds blur, glitch, shake, or color breakup."],
  whenNotToApply: [],
  rationale: ["Effects only support the edit when the viewer can still read the intended subject/action."],
  positiveSignals: ["Face and silhouette remain immediately legible."],
  negativeSignals: ["Effect texture becomes more salient than the subject."],
  sourceIds: ["reference.pro.01"],
  confidence: 0.94,
};

test("professional reference principles are retrievable by edit context", () => {
  const taste = new EditorialTasteLibrary();
  taste.ingestReference({
    source: {
      sourceId: "reference.pro.01",
      title: "Professional action reference",
      sourceRef: "reference.mp4",
      durationSeconds: 15,
      tags: ["action"],
    },
    overallIntent: "Escalate into a readable climax.",
    structure: [{
      id: "phase.climax",
      startSeconds: 8,
      endSeconds: 12,
      function: "climax",
      energy: "high",
      observations: ["Effects intensify while the face remains readable."],
      audioRelationship: ["Major motion peak aligns near the impact beat."],
      visualHierarchy: ["Subject remains primary."],
    }],
    moments: [{
      id: "moment.impact",
      timeSeconds: 10,
      function: "impact",
      observations: ["Effect density peaks without hiding the subject."],
      principleIds: [readabilityPrinciple.id],
    }],
    principles: [readabilityPrinciple],
    shotSelectionObservations: [],
    pacingObservations: [],
    soundObservations: [],
    restraintObservations: [],
    compositionObservations: [],
    effectDensityObservations: [],
  });

  const result = taste.retrieve(context, 1);
  assert.equal(result.principles[0]?.principle.id, readabilityPrinciple.id);
  assert.equal(result.principles[0]?.supportingReferenceMoments[0]?.id, "moment.impact");
});

test("editor feedback becomes reusable taste rather than disappearing as a chat correction", () => {
  const taste = new EditorialTasteLibrary();
  taste.recordEditorFeedback({
    id: "feedback.01",
    createdAt: "2026-09-09T00:00:00Z",
    contextTags: ["action", "layered effects", "face"],
    feedback: "The effects are advanced but the face disappears; preserve the subject anchor.",
    polarity: "NEGATIVE",
    derivedPrinciples: [{
      ...readabilityPrinciple,
      origin: "EDITOR_FEEDBACK",
      sourceIds: ["feedback.01"],
    }],
  });

  const result = taste.retrieve(context, 1);
  assert.equal(result.principles[0]?.principle.origin, "EDITOR_FEEDBACK");
  assert.equal(result.principles[0]?.matchingFeedback[0]?.id, "feedback.01");
});

test("critic requires real preview and technical evidence for critical scores", () => {
  const evidence = {
    previewRefs: ["preview://candidate-01"],
    audioEvidenceRefs: ["audio://impact-map"],
    technicalReadbackRefs: ["ae://project-state-after"],
    referenceComparisonRefs: ["reference://pro-01"],
    metrics: [
      { dimension: "intent_match", score: 0.9, note: "matches goal", evidenceRefs: ["preview://candidate-01"] },
      { dimension: "timing", score: 0.62, note: "impact lands late", evidenceRefs: ["preview://candidate-01", "audio://impact-map"] },
      { dimension: "readability", score: 0.55, note: "face obscured", evidenceRefs: ["preview://candidate-01"] },
      { dimension: "technical_integrity", score: 0.95, note: "clean state", evidenceRefs: ["ae://project-state-after"] },
      { dimension: "effect_restraint", score: 0.6, note: "too dense", evidenceRefs: ["preview://candidate-01"] },
    ],
    tasteSignals: [],
  };

  assert.doesNotThrow(() => assertCriticEvidenceGrounded(evidence));
  const focus = selectRefinementFocus(evidence, { timing: 0.7, readability: 0.72, effect_restraint: 0.7 }, 2);
  assert.deepEqual(focus.map((metric) => metric.dimension), ["readability", "effect_restraint"]);

  const missingEvidence = {
    ...evidence,
    metrics: evidence.metrics.map((metric) => metric.dimension === "readability" ? { ...metric, evidenceRefs: [] } : metric),
  };
  assert.throws(() => assertCriticEvidenceGrounded(missingEvidence), /readability.*no evidence/i);
});

const makeSkill = (id, name, tag) => ({
  id,
  name,
  summary: `${name} summary`,
  domains: ["motion"],
  tags: [tag],
  intents: ["accent"],
  prerequisites: [],
  whenToUse: ["A readable accent exists."],
  whenNotToUse: ["The subject becomes unreadable."],
  whyItWorks: ["Creates controlled contrast."],
  procedure: [],
  parameterGuidance: [],
  visualTargets: ["Subject remains readable."],
  failureModes: [],
  adaptationRules: ["Adapt to the new motion."],
  variants: [],
  sourceIds: ["tutorial.01"],
  confidence: 0.8,
  mastery: "OBSERVED",
});

test("practice planner enforces imitate, transfer, compose, then invent", () => {
  const skills = [
    makeSkill("skill.a", "Speed Ramp", "speed ramp"),
    makeSkill("skill.b", "Glitch Accent", "glitch"),
  ];
  const program = createPracticeProgram(skills, [context, { ...context, goal: "apply to a slow push-in", shotMotion: ["slow push in"] }]);
  const stages = new Set(program.assignments.map((assignment) => assignment.stage));
  assert.ok(stages.has("IMITATE"));
  assert.ok(stages.has("TRANSFER"));
  assert.ok(stages.has("COMPOSE"));
  assert.ok(stages.has("INVENT"));
  assert.equal(nextPracticeStage({ imitationPassed: false, distinctTransferPasses: 0, compositionPasses: 0 }), "IMITATE");
  assert.equal(nextPracticeStage({ imitationPassed: true, distinctTransferPasses: 1, compositionPasses: 0 }), "TRANSFER");
  assert.equal(nextPracticeStage({ imitationPassed: true, distinctTransferPasses: 2, compositionPasses: 0 }), "COMPOSE");
  assert.equal(nextPracticeStage({ imitationPassed: true, distinctTransferPasses: 2, compositionPasses: 1 }), "INVENT");
});
