export const TUTORIAL_001_VISUAL_ANCHOR_MS = 2000;

export const TUTORIAL_001_VISUAL_RULES = Object.freeze({
  minAnchorToPeakRatio: 0.85,
  changeThreshold: 12,
  borderWidth: 12,
  maxBorderNearBlackRatio: 0.001,
  roi: Object.freeze({
    center: Object.freeze([0.62, 0.44]),
    radiusPx: 120,
  }),
  minRoiLumaStd: 40,
  tailTimesMs: Object.freeze([1800, 2200]),
  minPeakToTailRatio: 1.5,
  minAnchorToTailRatio: 1.5,
});

export const framesFromSparseCaptureV1 = (capture) => {
  if (!capture || !Array.isArray(capture.timesMs) || !Array.isArray(capture.files)
    || capture.timesMs.length === 0 || capture.timesMs.length !== capture.files.length) {
    throw new Error("Sparse visual capture must contain aligned timesMs/files arrays.");
  }
  return capture.timesMs.map((timeMs, index) => ({
    timeMs,
    path: capture.files[index],
  }));
};
