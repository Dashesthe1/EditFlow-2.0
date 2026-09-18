export const TUTORIAL_001_TRANSFER_PROFILE = Object.freeze({
  id: "real-media-landscape-motion-v1",
  realSourceStableId: "M5_MOCHA_SOURCE",
  comp: Object.freeze({
    width: 1920,
    height: 1080,
    durationSeconds: 6.4,
    frameRate: 30,
  }),
  anchor: Object.freeze({
    timeMs: 3200,
    basis: "MOTION_DRIVEN",
  }),
  sourceWindows: Object.freeze({
    outgoing: Object.freeze({
      sourceStartSeconds: 6,
      sourceEndSeconds: 12.4,
      layerStartTimeSeconds: -6,
    }),
    incoming: Object.freeze({
      sourceStartSeconds: 20,
      sourceEndSeconds: 26.4,
      layerStartTimeSeconds: -20,
    }),
  }),
  targetTiming: Object.freeze({
    outgoingInSeconds: 0,
    outgoingOutSeconds: 3.2,
    incomingInSeconds: 3.2,
    incomingOutSeconds: 6.4,
  }),
  compileHandleTiming: Object.freeze({
    outgoingInSeconds: 0,
    outgoingOutSeconds: 4.4,
    incomingInSeconds: 2.0,
    incomingOutSeconds: 6.4,
  }),
  sourceTransform: Object.freeze({
    position: Object.freeze([960, 540]),
    scale: Object.freeze([178, 178]),
  }),
  recipe: Object.freeze({
    velocityPulseDuration: 0.42,
    velocityContrast: 0.28,
    temporalPeakPhase: 0.5,
    zoomPulseDuration: 0.34,
    zoomIntensity: 0.18,
    zoomCenter: Object.freeze([0.35, 0.58]),
    zoomTemporalPhase: 0.5,
  }),
  visual: Object.freeze({
    timesMs: Object.freeze([2800, 3100, 3200, 3300, 3600]),
    rules: Object.freeze({
      minAnchorToPeakRatio: 0.45,
      changeThreshold: 12,
      borderWidth: 12,
      maxBorderNearBlackRatio: 0.001,
      roi: Object.freeze({
        center: Object.freeze([0.35, 0.58]),
        radiusPx: 100,
      }),
      minRoiLumaStd: 15,
      tailTimesMs: Object.freeze([2800, 3600]),
      minAnchorToTailRatio: 1.05,
    }),
  }),
  motion: Object.freeze({
    timesMs: Object.freeze([
      2700, 2800, 2900, 3000, 3100,
      3300, 3400, 3500, 3600, 3700,
    ]),
    referenceMarkers: Object.freeze([
      Object.freeze({ id: "ref-left", rgb: Object.freeze([0, 255, 0]), sourceX: 288 }),
      Object.freeze({ id: "ref-right", rgb: Object.freeze([255, 0, 255]), sourceX: 1632 }),
    ]),
    movingMarker: Object.freeze({ id: "motion", rgb: Object.freeze([255, 128, 0]) }),
    segments: Object.freeze([
      Object.freeze({
        id: "outgoing",
        startTimeMs: 2700,
        endTimeMs: 3100,
        sourceStartX: 1248,
        sourceEndX: 96,
        expectedTrend: "ACCELERATE",
      }),
      Object.freeze({
        id: "incoming",
        startTimeMs: 3300,
        endTimeMs: 3700,
        sourceStartX: 96,
        sourceEndX: 1248,
        expectedTrend: "DECELERATE",
      }),
    ]),
    rules: Object.freeze({
      colorTolerance: 8,
      minMarkerPixels: 80,
      minPlaybackRate: 0.12,
      maxPlaybackRate: 2.5,
      minTrendRatio: 1.06,
      sourceTimeToleranceSeconds: 0.1,
    }),
  }),  transferAxes: Object.freeze([
    "different frame rate",
    "different shot duration and source-handle length",
    "different subject scale and off-center subject position",
    "different source motion speed and direction",
    "portrait versus landscape aspect ratio",
    "beat-driven versus motion-driven transition anchor",
  ]),
});

export const transferFramesFromCaptureV1 = (capture) => {
  if (!capture || !Array.isArray(capture.timesMs) || !Array.isArray(capture.files)
    || capture.timesMs.length === 0 || capture.timesMs.length !== capture.files.length) {
    throw new Error("Transfer capture must contain aligned timesMs/files arrays.");
  }
  return capture.timesMs.map((timeMs, index) => ({
    timeMs,
    path: capture.files[index],
  }));
};
