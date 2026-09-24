import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PracticeAeBaselineBuilderV1,
  PracticeLearningMemoryFileV1,
  compilePracticeAeBaselinePlanV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

const reference = {
  referenceId: "finish:fixture",
  styleFingerprint: "style:fixture",
  video: {
    fps: 24,
    frameCount: 60,
    width: 320,
    height: 180,
    durationMs: 2500,
  },
  shots: [
    {
      shotId: "shot:001",
      order: 0,
      referenceStartMs: 0,
      referenceEndMs: 1000,
      evidenceRefs: ["ref:001"],
    },
    {
      shotId: "shot:002",
      order: 1,
      referenceStartMs: 1000,
      referenceEndMs: 2500,
      evidenceRefs: ["ref:002"],
    },
  ],
  evidenceRefs: ["reference:evidence"],
};

const matches = [
  {
    shotId: "shot:001",
    sourceId: "movie:a",
    sourcePath: "C:\\Media\\movie-a.mp4",
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
    sourcePath: "C:\\Media\\movie-a.mp4",
    sourceStartMs: 7000,
    sourceEndMs: 8500,
    direction: "REVERSE",
    playbackRate: 1,
    appearanceSimilarity: 0.99,
    temporalSimilarity: 0.99,
    motionSimilarity: 0.99,
    confidence: 0.99,
    evidenceRefs: ["match:002"],
  },
];

test("AE baseline compiler maps forward and reverse source time into reference time", () => {
  const plan = compilePracticeAeBaselinePlanV1({ reference, matches });
  assert.equal(plan.frameRate, 24);
  assert.equal(plan.durationMs, 2500);
  assert.equal(plan.operations.filter((item) => item.command === "media.import").length, 1);
  const timings = plan.operations
    .filter((item) => item.command === "layer.set_timing")
    .map((item) => item.payload.timing);
  assert.deepEqual(timings[0], {
    startTime: -5,
    inPoint: 0,
    outPoint: 1,
    stretch: 100,
  });
  assert.deepEqual(timings[1], {
    startTime: 9.5,
    inPoint: 1,
    outPoint: 2.5,
    stretch: -100,
  });
});

test("AE baseline compiles a measured forward-then-rewind trajectory into Time Remap keys", () => {
  const rewindMatches = [
    matches[0],
    {
      ...matches[1],
      direction: "FORWARD",
      temporalBehavior: "FORWARD_THEN_REWIND",
      trajectory: [
        { referenceTimeMs: 1120, sourceTimeMs: 7120, similarity: 0.98 },
        { referenceTimeMs: 1450, sourceTimeMs: 7450, similarity: 0.99 },
        { referenceTimeMs: 1800, sourceTimeMs: 7800, similarity: 0.99 },
        { referenceTimeMs: 2150, sourceTimeMs: 7520, similarity: 0.98 },
        { referenceTimeMs: 2380, sourceTimeMs: 7290, similarity: 0.97 },
      ],
      rewind: {
        detected: true,
        referenceStartMs: 1800,
        referenceEndMs: 2380,
        sourceStartMs: 7800,
        sourceEndMs: 7290,
        rewindSpanMs: 510,
        confidence: 0.98,
      },
    },
  ];
  const plan = compilePracticeAeBaselinePlanV1({ reference, matches: rewindMatches });
  const timings = plan.operations
    .filter((item) => item.command === "layer.set_timing")
    .map((item) => item.payload.timing);
  assert.deepEqual(timings[1], {
    startTime: 1,
    inPoint: 1,
    outPoint: 2.5,
    stretch: 100,
  });
  const remap = plan.operations.find((item) =>
    item.command === "property.set_keyframes"
      && item.payload.layer?.stableId?.endsWith("_0002"));
  assert.ok(remap);
  const keyframes = remap.payload.keyframes;
  assert.ok(keyframes.length >= 5);
  const values = keyframes.map((item) => item.value);
  const peakIndex = values.indexOf(Math.max(...values));
  assert.ok(peakIndex > 0 && peakIndex < values.length - 1);
  assert.ok(values.at(-1) < values[peakIndex]);
});

test("AE baseline compiles a measured forward speed ramp into Time Remap keys", () => {
  const speedRampMatches = [
    matches[0],
    {
      ...matches[1],
      direction: "FORWARD",
      sourceStartMs: 7000,
      sourceEndMs: 9000,
      playbackRate: 1.25,
      temporalBehavior: "FORWARD",
      trajectory: [
        { referenceTimeMs: 1120, sourceTimeMs: 7100, similarity: 0.98 },
        { referenceTimeMs: 1450, sourceTimeMs: 7280, similarity: 0.99 },
        { referenceTimeMs: 1800, sourceTimeMs: 7700, similarity: 0.99 },
        { referenceTimeMs: 2150, sourceTimeMs: 8350, similarity: 0.98 },
        { referenceTimeMs: 2380, sourceTimeMs: 8850, similarity: 0.97 },
      ],
    },
  ];
  const plan = compilePracticeAeBaselinePlanV1({ reference, matches: speedRampMatches });
  const timings = plan.operations
    .filter((item) => item.command === "layer.set_timing")
    .map((item) => item.payload.timing);
  assert.deepEqual(timings[1], {
    startTime: 1,
    inPoint: 1,
    outPoint: 2.5,
    stretch: 100,
  });
  const remap = plan.operations.find((item) =>
    item.command === "property.set_keyframes"
      && item.payload.layer?.stableId?.endsWith("_0002"));
  assert.ok(remap);
  const keyframes = remap.payload.keyframes;
  assert.ok(keyframes.length >= 5);
  const segmentRates = keyframes.slice(1).map((item, index) =>
    Math.abs((item.value - keyframes[index].value) / (item.time - keyframes[index].time)));
  assert.ok(Math.max(...segmentRates) / Math.min(...segmentRates) > 1.3);
});

test("AE baseline keeps near-linear measured trajectories on the stretch fast path", () => {
  const linearMatches = [
    matches[0],
    {
      ...matches[1],
      direction: "FORWARD",
      sourceStartMs: 7000,
      sourceEndMs: 8500,
      playbackRate: 1,
      temporalBehavior: "FORWARD",
      trajectory: [
        { referenceTimeMs: 1120, sourceTimeMs: 7122, similarity: 0.98 },
        { referenceTimeMs: 1450, sourceTimeMs: 7448, similarity: 0.99 },
        { referenceTimeMs: 1800, sourceTimeMs: 7804, similarity: 0.99 },
        { referenceTimeMs: 2150, sourceTimeMs: 8147, similarity: 0.98 },
        { referenceTimeMs: 2380, sourceTimeMs: 8382, similarity: 0.97 },
      ],
    },
  ];
  const plan = compilePracticeAeBaselinePlanV1({ reference, matches: linearMatches });
  const timings = plan.operations
    .filter((item) => item.command === "layer.set_timing")
    .map((item) => item.payload.timing);
  assert.deepEqual(timings[1], {
    startTime: -6,
    inPoint: 1,
    outPoint: 2.5,
    stretch: 100,
  });
  const remap = plan.operations.find((item) =>
    item.command === "property.set_keyframes"
      && item.payload.layer?.stableId?.endsWith("_0002"));
  assert.equal(remap, undefined);
});

test("AE baseline builder executes the deterministic plan in order", async () => {
  const executed = [];
  const builder = new PracticeAeBaselineBuilderV1({
    async execute(operation) {
      executed.push(operation);
      return { evidenceRefs: [`runner:${operation.operationId}`] };
    },
  });
  const baseline = await builder.buildContentBaseline({ reference, matches });
  const plan = builder.plan(baseline.baselineId);
  assert.ok(plan);
  assert.deepEqual(
    executed.map((item) => item.command),
    plan.operations.map((item) => item.command),
  );
  assert.equal(baseline.timelineRef, `ae:comp:${plan.compStableId}`);
  assert.ok(baseline.evidenceRefs.some((item) => item.startsWith("runner:")));
});

test("disk-backed Practice learning memory survives process-memory loss", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "editflow-practice-memory-"));
  try {
    const storePath = path.join(directory, "practice-memory.json");
    const store = new PracticeLearningMemoryFileV1(storePath);
    const episode = {
      sessionId: "practice:memory:001",
      styleFingerprint: "style:memory",
      baselineId: "baseline:memory",
      matches: [],
      attempts: [],
      mastered: false,
      bestAttempt: null,
    };
    await store.recordEpisode(episode);
    const reloaded = await store.load();
    assert.equal(reloaded.size, 1);
    assert.equal(reloaded.get("practice:memory:001")?.baselineId, "baseline:memory");

    await store.recordEpisode({
      ...episode,
      mastered: true,
    });
    const snapshot = await store.snapshot();
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].mastered, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
const audioMatch = {
  matchId: "audio-match:full-song",
  sourceId: "song:full",
  sourcePath: "C:\\Media\\full-song.wav",
  segments: [{
    segmentId: "song-segment:001",
    referenceStartMs: 500,
    referenceEndMs: 2000,
    sourceStartMs: 45000,
    sourceEndMs: 46500,
    playbackRate: 1,
    correlation: 0.998,
    confidence: 0.997,
    evidenceRefs: ["audio:segment:001"],
  }],
  overallConfidence: 0.997,
  evidenceRefs: ["audio:match"],
};

test("AE baseline cuts a full-song source to the matched Finish soundtrack range", async () => {
  const plan = compilePracticeAeBaselinePlanV1({
    reference,
    matches,
    audioMatch,
  });
  assert.equal(plan.audioMatchId, audioMatch.matchId);
  assert.equal(
    plan.operations.filter((item) => item.command === "media.import").length,
    2,
  );
  const timings = plan.operations
    .filter((item) => item.command === "layer.set_timing")
    .map((item) => item.payload.timing);
  assert.deepEqual(timings.at(-1), {
    startTime: -44.5,
    inPoint: 0.5,
    outPoint: 2,
    stretch: 100,
  });

  const switches = plan.operations
    .filter((item) => item.command === "layer.switches.set")
    .map((item) => item.payload.switches);
  assert.deepEqual(switches.slice(0, 2), [
    { audioEnabled: false },
    { audioEnabled: false },
  ]);
  assert.deepEqual(switches.at(-1), { audioEnabled: true });

  const builder = new PracticeAeBaselineBuilderV1({
    async execute() {
      return {};
    },
  });
  const baseline = await builder.buildContentBaseline({
    reference,
    matches,
    audioMatch,
  });
  assert.match(baseline.audioTimelineRef, /#audio:audio-match:full-song$/);
});

test("AE baseline builder prefers one atomic batch transaction when available", async () => {
  const executedPlans = [];
  const builder = new PracticeAeBaselineBuilderV1({
    async executePlan(plan) {
      executedPlans.push(plan);
      return { evidenceRefs: ["runner:atomic-baseline"] };
    },
  });
  const baseline = await builder.buildContentBaseline({ reference, matches, audioMatch });
  assert.equal(executedPlans.length, 1);
  assert.equal(executedPlans[0].baselineId, baseline.baselineId);
  assert.equal(executedPlans[0].operations.length > 0, true);
  assert.ok(baseline.evidenceRefs.includes("runner:atomic-baseline"));
  assert.ok(
    baseline.evidenceRefs.includes("practice-ae-plan:" + baseline.baselineId),
  );
});
