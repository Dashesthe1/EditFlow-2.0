import assert from "node:assert/strict";
import test from "node:test";

import {
  EditFlowModeControllerV1,
  EditTypeRegistryV1,
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

test("practice similarity cannot pass while a retained semantic diagnosis remains", () => {
  const measured = report(0.999);
  const gated = finalizePracticeSimilarityReportV1({
    ...measured,
    reasons: ["Measured source-time rewind was not reproduced."],
  }, 0.95);
  assert.ok(gated.overallSimilarity > 0.99);
  assert.equal(gated.passed, false);
  assert.match(gated.reasons[0], /rewind was not reproduced/);
});
const exactGeometry = {
  anchorCount: 4,
  strongAnchorCount: 3,
  strongAnchorFraction: 0.75,
  meanSupport: 0.92,
  minimumSupport: 0.80,
  maximumInlierCount: 18,
  meanInlierRatio: 0.78,
  meanCoverage: 0.20,
};

const makeAdapters = (evaluations, options = {}) => {
  const recorded = [];
  const reconstructed = [];
  return {
    recorded,
    reconstructed,
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
          videoSourceIds: start
            .filter((item) => item.mediaKind === "VIDEO")
            .map((item) => item.mediaId),
          audioSourceIds: start
            .filter((item) => item.mediaKind === "AUDIO")
            .map((item) => item.mediaId),
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
            geometricProof: exactGeometry,
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
            geometricProof: exactGeometry,
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
            geometricProof: exactGeometry,
            confidence: 0.99,
            evidenceRefs: ["match:002"],
          },
        ];
      },
      async matchAudio() {
        return options.audioMatch ?? null;
      },
      async buildContentBaseline() {
        return {
          baselineId: "baseline:content-lock",
          timelineRef: "ae:comp:practice-baseline",
          evidenceRefs: ["baseline:assembled"],
        };
      },
      async reconstruct(input) {
        reconstructed.push(structuredClone(input));
        const { attempt } = input;
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
const makeEditTypes = () => {
  const editTypes = new EditTypeRegistryV1();
  editTypes.create({
    editTypeId: "high-potency-reference-edit",
    title: "High Potency Reference Edit",
    choiceWords: ["high potency", "reference faithful"],
  });
  return editTypes;
};

const request = {
  sessionId: "practice:001",
  mode: "PRACTICE",
  editTypeId: "high-potency-reference-edit",
  finish: {
    mediaId: "finish:pro-edit",
    role: "FINISH_REFERENCE",
    mediaKind: "VIDEO",
    uri: "file:///finish.mp4",
  },
  start: [{
    mediaId: "movie:a",
    role: "START_SOURCE",
    mediaKind: "VIDEO",
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
  const engine = new PracticeHomeworkEngineV1(fixtures.adapters, memory, makeEditTypes());
  const result = await engine.run(request);
  assert.equal(result.status, "MASTERED");
  assert.equal(result.attempts.length, 3);
  assert.equal(result.bestAttempt?.attempt, 3);
  assert.ok((result.bestAttempt?.report.overallSimilarity ?? 0) >= 0.95);
  assert.equal(memory.size, 1);
  assert.equal(memory.successfulExamples("style:pro-edit-a").length, 1);
  assert.equal(fixtures.recorded.length, 3);
});

test("Practice forwards the matched audio beat grid into reconstruction", async () => {
  const audioMatch = {
    matchId: "audio:beat-forwarding",
    sourceId: "song:a",
    segments: [{
      segmentId: "audio:beat-forwarding:segment:001",
      referenceStartMs: 0,
      referenceEndMs: 2000,
      sourceStartMs: 5000,
      sourceEndMs: 7000,
      playbackRate: 1,
      correlation: 0.99,
      confidence: 0.99,
      evidenceRefs: ["audio:segment:exact"],
    }],
    beatGrid: {
      beatTimesMs: [0, 500, 1000, 1500, 2000],
      estimatedBpm: 120,
      confidence: 0.97,
      evidenceRefs: ["audio:beat-grid:forwarded"],
    },
    overallConfidence: 0.99,
    evidenceRefs: ["audio:match:exact"],
  };
  const fixtures = makeAdapters([
    report(0.98, { breakdown: breakdown(0.98, { sceneIdentity: 0.999 }) }),
  ], { audioMatch });
  const engine = new PracticeHomeworkEngineV1(
    fixtures.adapters,
    new PracticeLearningMemoryV1(),
    makeEditTypes(),
  );
  const result = await engine.run({
    ...request,
    sessionId: "practice:beat-forwarding",
    start: [
      ...request.start,
      {
        mediaId: "song:a",
        role: "START_SOURCE",
        mediaKind: "AUDIO",
        uri: "file:///song-a.wav",
      },
    ],
  });
  assert.equal(result.status, "MASTERED");
  assert.equal(fixtures.reconstructed.length, 1);
  assert.equal(fixtures.reconstructed[0].audioMatch?.matchId, audioMatch.matchId);
  assert.deepEqual(
    fixtures.reconstructed[0].audioMatch?.beatGrid?.beatTimesMs,
    audioMatch.beatGrid.beatTimesMs,
  );
  assert.ok(
    fixtures.reconstructed[0].audioMatch?.beatGrid?.evidenceRefs
      .includes("audio:beat-grid:forwarded"),
  );
});

test("held-out execution uses frozen knowledge without retaining an episode", async () => {
  const fixtures = makeAdapters([
    report(0.98, { breakdown: breakdown(0.98, { sceneIdentity: 0.999 }) }),
  ]);
  const memory = new PracticeLearningMemoryV1();
  const editTypes = makeEditTypes();
  const retainedKnowledge = editTypes.knowledge(request.editTypeId);
  assert.ok(retainedKnowledge);
  const engine = new PracticeHomeworkEngineV1(fixtures.adapters, memory, editTypes);
  const result = await engine.run(
    { ...request, sessionId: "practice:held-out:001" },
    retainedKnowledge,
    { retainEpisode: false },
  );
  assert.equal(result.status, "MASTERED");
  assert.equal(result.allocationPrompt, null);
  assert.equal(memory.size, 0);
  assert.equal(fixtures.recorded.length, 0);
});

test("homework cannot begin reconstruction until every reference shot is source-matched", async () => {
  const fixtures = makeAdapters([report(0.99)], { missingMatch: true });
  const engine = new PracticeHomeworkEngineV1(
    fixtures.adapters,
    new PracticeLearningMemoryV1(),
    makeEditTypes(),
  );
  const result = await engine.run(request);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.attempts.length, 0);
  assert.ok(result.reasons.some((reason) => /No source scene match/.test(reason)));
});

test("Pro Creation requests do not accidentally execute the Practice homework loop", async () => {
  const fixtures = makeAdapters([report(0.99)]);
  const engine = new PracticeHomeworkEngineV1(
    fixtures.adapters,
    new PracticeLearningMemoryV1(),
    makeEditTypes(),
  );
  const result = await engine.run({ ...request, mode: "PRO_CREATION" });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reference, null);
  assert.equal(fixtures.recorded.length, 0);
});
