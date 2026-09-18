export const TUTORIAL_001_MOTION_TIMES_MS = Object.freeze([
  1600, 1700, 1800, 1900,
  2100, 2200, 2300, 2400,
]);

export const TUTORIAL_001_MOTION_MARKERS = Object.freeze({
  references: Object.freeze([
    Object.freeze({ id: "ref-left", rgb: Object.freeze([0, 255, 0]), sourceX: 324 }),
    Object.freeze({ id: "ref-right", rgb: Object.freeze([255, 0, 255]), sourceX: 756 }),
  ]),
  moving: Object.freeze({ id: "motion", rgb: Object.freeze([255, 128, 0]) }),
});

export const TUTORIAL_001_MOTION_SEGMENTS = Object.freeze([
  Object.freeze({
    id: "outgoing",
    startTimeMs: 1600,
    endTimeMs: 1900,
    sourceStartX: 194.4,
    sourceEndX: 885.6,
    expectedTrend: "ACCELERATE",
  }),
  Object.freeze({
    id: "incoming",
    startTimeMs: 2100,
    endTimeMs: 2400,
    sourceStartX: 885.6,
    sourceEndX: 194.4,
    expectedTrend: "DECELERATE",
  }),
]);

export const TUTORIAL_001_MOTION_RULES = Object.freeze({
  colorTolerance: 8,
  minMarkerPixels: 100,
  minPlaybackRate: 0.15,
  maxPlaybackRate: 2.5,
  minTrendRatio: 1.08,
  sourceTimeToleranceSeconds: 0.08,
});

export const framesFromMotionCaptureV1 = (capture) => {
  if (!capture || !Array.isArray(capture.timesMs) || !Array.isArray(capture.files)
    || capture.timesMs.length === 0 || capture.timesMs.length !== capture.files.length) {
    throw new Error("Motion capture must contain aligned timesMs/files arrays.");
  }
  return capture.timesMs.map((timeMs, index) => ({
    timeMs,
    path: capture.files[index],
  }));
};
