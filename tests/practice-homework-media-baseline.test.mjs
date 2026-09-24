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

test("AE baseline preserves an intentional forward hold plateau inside a speed ramp", () => {
  const holdMatches = [
    matches[0],
    {
      ...matches[1],
      direction: "FORWARD",
      sourceStartMs: 7000,
      sourceEndMs: 9000,
      playbackRate: 1.25,
      temporalBehavior: "FORWARD",
      trajectory: [
        { referenceTimeMs: 1120, sourceTimeMs: 7100, similarity: 0.99 },
        { referenceTimeMs: 1400, sourceTimeMs: 7420, similarity: 0.99 },
        { referenceTimeMs: 1700, sourceTimeMs: 7420, similarity: 0.99 },
        { referenceTimeMs: 1980, sourceTimeMs: 7900, similarity: 0.98 },
        { referenceTimeMs: 2200, sourceTimeMs: 8320, similarity: 0.98 },
        { referenceTimeMs: 2380, sourceTimeMs: 8850, similarity: 0.99 },
      ],
    },
  ];
  const plan = compilePracticeAeBaselinePlanV1({ reference, matches: holdMatches });
  const remap = plan.operations.find((item) =>
    item.command === "property.set_keyframes"
      && item.payload.layer?.stableId?.endsWith("_0002"));
  assert.ok(remap);
  const keyframes = remap.payload.keyframes;
  const holdIndex = keyframes.findIndex((item, index) =>
    index > 0
      && Math.abs(item.value - keyframes[index - 1].value) < 1e-9
      && (item.time - keyframes[index - 1].time) >= 0.25);
  assert.ok(holdIndex > 0);
  assert.ok(Math.abs(keyframes[holdIndex].value - 7.42) < 1e-6);
});

test("AE baseline preserves an intentional reverse hold plateau inside a speed ramp", () => {
  const holdMatches = [
    matches[0],
    {
      ...matches[1],
      direction: "REVERSE",
      sourceStartMs: 7000,
      sourceEndMs: 9000,
      playbackRate: 1.25,
      temporalBehavior: "REVERSE",
      trajectory: [
        { referenceTimeMs: 1120, sourceTimeMs: 8880, similarity: 0.99 },
        { referenceTimeMs: 1400, sourceTimeMs: 8500, similarity: 0.99 },
        { referenceTimeMs: 1700, sourceTimeMs: 8500, similarity: 0.99 },
        { referenceTimeMs: 1980, sourceTimeMs: 8060, similarity: 0.98 },
        { referenceTimeMs: 2200, sourceTimeMs: 7650, similarity: 0.98 },
        { referenceTimeMs: 2380, sourceTimeMs: 7150, similarity: 0.99 },
      ],
    },
  ];
  const plan = compilePracticeAeBaselinePlanV1({ reference, matches: holdMatches });
  const remap = plan.operations.find((item) =>
    item.command === "property.set_keyframes"
      && item.payload.layer?.stableId?.endsWith("_0002"));
  assert.ok(remap);
  const keyframes = remap.payload.keyframes;
  const holdIndex = keyframes.findIndex((item, index) =>
    index > 0
      && Math.abs(item.value - keyframes[index - 1].value) < 1e-9
      && (item.time - keyframes[index - 1].time) >= 0.25);
  assert.ok(holdIndex > 0);
  assert.ok(Math.abs(keyframes[holdIndex].value - 8.5) < 1e-6);
});

test("AE baseline preserves multi-inflection speed ramps despite one contradictory scene sample", () => {
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
        { referenceTimeMs: 1120, sourceTimeMs: 7100, similarity: 0.99 },
        { referenceTimeMs: 1370, sourceTimeMs: 7220, similarity: 0.98 },
        { referenceTimeMs: 1620, sourceTimeMs: 7600, similarity: 0.99 },
        { referenceTimeMs: 1850, sourceTimeMs: 7480, similarity: 0.61 },
        { referenceTimeMs: 1950, sourceTimeMs: 8020, similarity: 0.99 },
        { referenceTimeMs: 2180, sourceTimeMs: 8210, similarity: 0.98 },
        { referenceTimeMs: 2380, sourceTimeMs: 8850, similarity: 0.99 },
      ],
    },
  ];
  const plan = compilePracticeAeBaselinePlanV1({ reference, matches: speedRampMatches });
  const timing = plan.operations
    .filter((item) => item.command === "layer.set_timing")
    .map((item) => item.payload.timing)[1];
  assert.deepEqual(timing, {
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
  assert.ok(keyframes.some((item) => Math.abs(item.value - 7.6) < 1e-6));
  assert.ok(keyframes.some((item) => Math.abs(item.value - 8.02) < 1e-6));
  assert.equal(keyframes.some((item) => Math.abs(item.value - 7.48) < 1e-6), false);
  const segmentRates = keyframes.slice(1).map((item, index) =>
    Math.abs((item.value - keyframes[index].value) / (item.time - keyframes[index].time)));
  const materialRateShifts = segmentRates.slice(1).filter((rate, index) => {
    const previousRate = segmentRates[index];
    const slower = Math.min(rate, previousRate);
    const faster = Math.max(rate, previousRate);
    return slower > 1e-6 && (faster / slower) >= 1.35;
  });
  assert.ok(materialRateShifts.length >= 2);
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

test("AE baseline applies only stable retained framing to matched video layers", () => {
  const framedMatches = [
    {
      ...matches[0],
      geometricProof: {
        anchorCount: 4,
        strongAnchorCount: 4,
        strongAnchorFraction: 1,
        meanSupport: 0.94,
        minimumSupport: 0.90,
        maximumInlierCount: 28,
        meanInlierRatio: 0.88,
        meanCoverage: 0.22,
        framing: {
          stable: true,
          anchorCount: 4,
          stableAnchorCount: 4,
          stableAnchorFraction: 1,
          positionX: 188,
          positionY: 95,
          scalePercent: 126,
          rotationDegrees: -3.5,
          maxPositionDriftPx: 4.2,
          maxScaleDeviationPercent: 1.8,
          maxRotationDeviationDegrees: 0.8,
          confidence: 0.94,
        },
      },
    },
    matches[1],
  ];
  const plan = compilePracticeAeBaselinePlanV1({ reference, matches: framedMatches });
  const transforms = plan.operations.filter((item) =>
    item.command === "property.set_keyframes"
      && item.payload.layer?.stableId?.endsWith("_0001")
      && item.payload.propertyPath?.[0] === "ADBE Transform Group");
  assert.equal(transforms.length, 3);
  const byLeaf = new Map(transforms.map((item) => [item.payload.propertyPath.at(-1), item]));
  assert.deepEqual(byLeaf.get("ADBE Position")?.payload.keyframes, [
    { time: 0, value: [188, 95] },
  ]);
  assert.deepEqual(byLeaf.get("ADBE Scale")?.payload.keyframes, [
    { time: 0, value: [126, 126] },
  ]);
  assert.deepEqual(byLeaf.get("ADBE Rotate Z")?.payload.keyframes, [
    { time: 0, value: -3.5 },
  ]);
});

test("AE baseline refuses unstable framing evidence", () => {
  const unstableMatches = [
    {
      ...matches[0],
      geometricProof: {
        anchorCount: 4,
        strongAnchorCount: 4,
        strongAnchorFraction: 1,
        meanSupport: 0.94,
        minimumSupport: 0.90,
        maximumInlierCount: 28,
        meanInlierRatio: 0.88,
        meanCoverage: 0.22,
        framing: {
          stable: false,
          anchorCount: 4,
          stableAnchorCount: 1,
          stableAnchorFraction: 0.25,
          positionX: 188,
          positionY: 95,
          scalePercent: 126,
          rotationDegrees: -3.5,
          maxPositionDriftPx: 120,
          maxScaleDeviationPercent: 35,
          maxRotationDeviationDegrees: 18,
          confidence: 0.91,
        },
      },
    },
    matches[1],
  ];
  const plan = compilePracticeAeBaselinePlanV1({ reference, matches: unstableMatches });
  const transforms = plan.operations.filter((item) =>
    item.command === "property.set_keyframes"
      && item.payload.layer?.stableId?.endsWith("_0001")
      && item.payload.propertyPath?.[0] === "ADBE Transform Group");
  assert.deepEqual(transforms, []);
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

test("AE baseline preserves a beat-aware multi-segment song arrangement", () => {
  const arrangedAudioMatch = {
    ...audioMatch,
    matchId: "audio-match:arranged-song",
    segments: [
      {
        ...audioMatch.segments[0],
        segmentId: "song-segment:arranged:001",
        referenceEndMs: 1250,
        sourceEndMs: 45750,
      },
      {
        ...audioMatch.segments[0],
        segmentId: "song-segment:arranged:002",
        referenceStartMs: 1250,
        referenceEndMs: 2000,
        sourceStartMs: 62000,
        sourceEndMs: 62750,
      },
    ],
    beatGrid: {
      beatTimesMs: [500, 1000, 1500, 2000],
      estimatedBpm: 120,
      confidence: 0.96,
      evidenceRefs: ["audio:beat-grid"],
    },
  };
  const plan = compilePracticeAeBaselinePlanV1({
    reference,
    matches,
    audioMatch: arrangedAudioMatch,
  });
  const timings = plan.operations
    .filter((item) => item.command === "layer.set_timing")
    .map((item) => item.payload.timing);
  assert.deepEqual(timings.slice(-2), [
    { startTime: -44.5, inPoint: 0.5, outPoint: 1.25, stretch: 100 },
    { startTime: -60.75, inPoint: 1.25, outPoint: 2, stretch: 100 },
  ]);
  const switches = plan.operations
    .filter((item) => item.command === "layer.switches.set")
    .map((item) => item.payload.switches);
  assert.deepEqual(switches.slice(-2), [
    { audioEnabled: true },
    { audioEnabled: true },
  ]);
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
