import assert from "node:assert/strict";
import test from "node:test";

import {
  EditFlowModeControllerV1,
  PracticeHomeworkEngineV1,
  PracticeLearningMemoryV1,
  finalizePracticeSimilarityReportV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

const breakdown = (value, overrides = {}) => ({
  sceneIdentity: value,
  temporalAlignment: value,
  cutTiming: value,
  framing: value,
  motion: value,
  effectFidelity: value,
  transitionFidelity: value,
  colorFinish: value,
  pixelStructure: value,
  ...overrides,
});

const report = (value, overrides = {}) => ({
  schema: "editflow.practice-similarity.v1",
  breakdown: breakdown(value),
  definingEffectCoverage: 1,
  wrongSceneCount: 0,
  unmatchedSceneCount: 0,
  overallSimilarity: 0,
  passed: false,
  reasons: [],
  evidenceRefs: ["fixture:comparison"],
  ...overrides,
});
test("Practice mode and Pro Creation mode are explicit controller settings", () => {
  const controller = new EditFlowModeControllerV1();
  assert.equal(controller.mode, "PRACTICE");
  controller.setMode("PRO_CREATION");
  assert.equal(controller.mode, "PRO_CREATION");
});

test("practice similarity refuses a high cosmetic score with the wrong source scene", () => {
  const gated = finalizePracticeSimilarityReportV1(report(0.995, {
    wrongSceneCount: 1,
  }), 0.95);
  assert.ok(gated.overallSimilarity > 0.99);
  assert.equal(gated.passed, false);
  assert.ok(gated.reasons.some((reason) => /Wrong source scene/.test(reason)));
});

test("practice similarity refuses missing defining effect behavior", () => {
  const gated = finalizePracticeSimilarityReportV1(report(0.99, {
    definingEffectCoverage: 0.8,
  }), 0.95);
  assert.equal(gated.passed, false);
  assert.ok(gated.reasons.some((reason) => /defining effect/.test(reason)));
});
const makeAdapters = (evaluations, options = {}) => {
  const recorded = [];
  return {
    recorded,
    adapters: {
      async analyzeFinish(finish) {
        return {
          referenceId: finish.mediaId,
          styleFingerprint: "style:pro-edit-a",
          shots: [
            {
              shotId: "shot:001",
              order: 0,
              referenceStartMs: 0,
              referenceEndMs: 1000,
              evidenceRefs: ["finish:shot:001"],
            },
            {
              shotId: "shot:002",
              order: 1,
              referenceStartMs: 1000,
              referenceEndMs: 2000,
              evidenceRefs: ["finish:shot:002"],
            },
          ],
          evidenceRefs: ["finish:analysis"],
        };
      },
      async indexStart(start) {
        return {
          indexId: "index:start",
          sourceIds: start.map((item) => item.mediaId),
          evidenceRefs: ["start:index"],
        };
      },
      async matchScenes() {
        if (options.missingMatch === true) {
          return [{
            shotId: "shot:001",
            sourceId: "movie:a",
            sourceStartMs: 5000,
            sourceEndMs: 6000,
            direction: "FORWARD",
            playbackRate: 1,
            appearanceSimilarity: 0.99,
            temporalSimilarity: 0.99,
            motionSimilarity: 0.99,
            confidence: 0.99,
            evidenceRefs: ["match:001"],
          }];
        }
        return [
          {
            shotId: "shot:001",
            sourceId: "movie:a",
            sourceStartMs: 5000,
            sourceEndMs: 6000,
            direction: "FORWARD",
            playbackRate: 1,
            appearanceSimilarity: 0.99,
            temporalSimilarity: 0.99,
            motionSimilarity: 0.99,
            confidence: 0.99,
            evidenceRefs: ["match:001"],
          },
          {
            shotId: "shot:002",
            sourceId: "movie:a",
            sourceStartMs: 21000,
            sourceEndMs: 22000,
            direction: "FORWARD",
            playbackRate: 1,
            appearanceSimilarity: 0.99,
            temporalSimilarity: 0.99,
            motionSimilarity: 0.99,
            confidence: 0.99,
            evidenceRefs: ["match:002"],
          },
        ];
      },
      async buildContentBaseline() {
        return {
          baselineId: "baseline:content-lock",
          timelineRef: "ae:comp:practice-baseline",
          evidenceRefs: ["baseline:assembled"],
        };
      },
      async reconstruct({ attempt }) {
        return {
          renderRef: `render:attempt:${attempt}`,
          decisionTraces: [{
            decisionId: `decision:${attempt}`,
            cueIds: ["reference:cue"],
            constructionIds: [`construction:${attempt}`],
            rationaleCodes: ["REFERENCE_SUPERVISED"],
          }],
          evidenceRefs: [`reconstruct:${attempt}`],
        };
      },
      async evaluate({ renderRef }) {
        const attempt = Number(renderRef.split(":").at(-1));
        return evaluations[attempt - 1] ?? evaluations.at(-1);
      },
      async recordEpisode(episode) {
        recorded.push(structuredClone(episode));
      },
    },
  };
};
const request = {
  sessionId: "practice:001",
  mode: "PRACTICE",
  finish: {
    mediaId: "finish:pro-edit",
    role: "FINISH_REFERENCE",
    uri: "file:///finish.mp4",
  },
  start: [{
    mediaId: "movie:a",
    role: "START_SOURCE",
    uri: "file:///movie-a.mp4",
  }],
  minimumSimilarity: 0.95,
  stretchSimilarity: 0.99,
  maxAttempts: 8,
};

test("homework loop repeats until the reconstruction satisfies the supervised gate", async () => {
  const fixtures = makeAdapters([
    report(0.90, { definingEffectCoverage: 0.5 }),
    report(0.97, { breakdown: breakdown(0.97, { effectFidelity: 0.93 }) }),
    report(0.98, { breakdown: breakdown(0.98, { sceneIdentity: 0.999 }) }),
  ]);
  const memory = new PracticeLearningMemoryV1();
  const engine = new PracticeHomeworkEngineV1(fixtures.adapters, memory);
  const result = await engine.run(request);
  assert.equal(result.status, "MASTERED");
  assert.equal(result.attempts.length, 3);
  assert.equal(result.bestAttempt?.attempt, 3);
  assert.ok((result.bestAttempt?.report.overallSimilarity ?? 0) >= 0.95);
  assert.equal(memory.size, 1);
  assert.equal(memory.successfulExamples("style:pro-edit-a").length, 1);
  assert.equal(fixtures.recorded.length, 3);
});

test("homework cannot begin reconstruction until every reference shot is source-matched", async () => {
  const fixtures = makeAdapters([report(0.99)], { missingMatch: true });
  const engine = new PracticeHomeworkEngineV1(fixtures.adapters);
  const result = await engine.run(request);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.attempts.length, 0);
  assert.ok(result.reasons.some((reason) => /No source scene match/.test(reason)));
});

test("Pro Creation requests do not accidentally execute the Practice homework loop", async () => {
  const fixtures = makeAdapters([report(0.99)]);
  const engine = new PracticeHomeworkEngineV1(fixtures.adapters);
  const result = await engine.run({ ...request, mode: "PRO_CREATION" });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reference, null);
  assert.equal(fixtures.recorded.length, 0);
});
