import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

const finite = (value) => Number.isFinite(value);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const loadPng = async (path) => PNG.sync.read(await readFile(path));

const colorCentroid = (image, marker, tolerance, minPixels) => {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const matches = marker.rgb.every(
        (target, channel) => Math.abs(image.data[offset + channel] - target) <= tolerance,
      );
      if (!matches) continue;
      count += 1;
      sumX += x;
      sumY += y;
    }
  }
  if (count < minPixels) return null;
  return { x: sumX / count, y: sumY / count, pixels: count };
};

const requireMarker = (value, label, issues) => {
  if (value !== null) return value;
  issues.push("MOTION_MARKER_MISSING:" + label);
  return { x: Number.NaN, y: Number.NaN, pixels: 0 };
};

const speedPairs = (samples) => {
  const values = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const dt = (current.timeMs - previous.timeMs) / 1000;
    values.push({
      startTimeMs: previous.timeMs,
      endTimeMs: current.timeMs,
      speed: (current.sourceTimeSeconds - previous.sourceTimeSeconds) / dt,
    });
  }
  return values;
};

export const evaluateMotionLandmarkProofV1 = async ({
  frames,
  referenceMarkers,
  movingMarker,
  segments,
  sourceDurationSeconds,
  rules = {},
}) => {
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new Error("Motion landmark proof requires at least two frames.");
  }
  if (!Array.isArray(referenceMarkers) || referenceMarkers.length !== 2) {
    throw new Error("Motion landmark proof requires exactly two stationary reference markers.");
  }
  if (!finite(sourceDurationSeconds) || sourceDurationSeconds <= 0) {
    throw new Error("sourceDurationSeconds must be positive.");
  }
  const tolerance = rules.colorTolerance ?? 10;
  const minPixels = rules.minMarkerPixels ?? 20;
  const issues = [];
  const observations = [];

  for (const frame of frames) {
    const image = await loadPng(frame.path);
    const left = requireMarker(
      colorCentroid(image, referenceMarkers[0], tolerance, minPixels),
      frame.timeMs + ":" + referenceMarkers[0].id,
      issues,
    );
    const right = requireMarker(
      colorCentroid(image, referenceMarkers[1], tolerance, minPixels),
      frame.timeMs + ":" + referenceMarkers[1].id,
      issues,
    );
    const moving = requireMarker(
      colorCentroid(image, movingMarker, tolerance, minPixels),
      frame.timeMs + ":" + movingMarker.id,
      issues,
    );
    const sourceSpan = referenceMarkers[1].sourceX - referenceMarkers[0].sourceX;
    const screenSpan = right.x - left.x;
    const scale = screenSpan / sourceSpan;
    if (!finite(scale) || scale <= 0) issues.push("MOTION_REFERENCE_AFFINE_INVALID:" + frame.timeMs);
    const sourceX = referenceMarkers[0].sourceX + (moving.x - left.x) / scale;
    observations.push({
      timeMs: frame.timeMs,
      width: image.width,
      height: image.height,
      referenceScale: scale,
      movingScreenX: moving.x,
      reconstructedSourceX: sourceX,
      markerPixels: {
        left: left.pixels,
        right: right.pixels,
        moving: moving.pixels,
      },
    });
  }

  const segmentResults = [];
  const minRate = rules.minPlaybackRate ?? 0.15;
  const maxRate = rules.maxPlaybackRate ?? 3;
  const trendRatio = rules.minTrendRatio ?? 1.05;
  const sourceTolerance = rules.sourceTimeToleranceSeconds ?? 0.05;

  for (const segment of segments) {
    const selected = observations
      .filter((item) => item.timeMs >= segment.startTimeMs && item.timeMs <= segment.endTimeMs)
      .sort((a, b) => a.timeMs - b.timeMs);
    if (selected.length < 3) {
      issues.push("MOTION_SEGMENT_TOO_SPARSE:" + segment.id);
      continue;
    }
    const sourceSpan = segment.sourceEndX - segment.sourceStartX;
    const samples = selected.map((item) => {
      const phase = (item.reconstructedSourceX - segment.sourceStartX) / sourceSpan;
      return {
        ...item,
        sourceTimeSeconds: phase * sourceDurationSeconds,
      };
    });
    for (const sample of samples) {
      if (sample.sourceTimeSeconds < -sourceTolerance
        || sample.sourceTimeSeconds > sourceDurationSeconds + sourceTolerance) {
        issues.push("MOTION_SOURCE_TIME_OUT_OF_RANGE:" + segment.id + ":" + sample.timeMs);
      }
    }
    const speeds = speedPairs(samples);
    if (speeds.some((item) => !finite(item.speed) || item.speed < minRate)) {
      issues.push("MOTION_FREEZE_OR_REVERSAL:" + segment.id);
    }
    if (speeds.some((item) => item.speed > maxRate)) {
      issues.push("MOTION_RATE_EXCESSIVE:" + segment.id);
    }
    const firstRate = mean(speeds.slice(0, Math.max(1, Math.floor(speeds.length / 2))).map((item) => item.speed));
    const lastRate = mean(speeds.slice(Math.floor(speeds.length / 2)).map((item) => item.speed));
    if (segment.expectedTrend === "ACCELERATE" && lastRate < firstRate * trendRatio) {
      issues.push("MOTION_EXPECTED_ACCELERATION_MISSING:" + segment.id);
    }
    if (segment.expectedTrend === "DECELERATE" && firstRate < lastRate * trendRatio) {
      issues.push("MOTION_EXPECTED_DECELERATION_MISSING:" + segment.id);
    }
    segmentResults.push({
      id: segment.id,
      expectedTrend: segment.expectedTrend,
      firstRate,
      lastRate,
      samples,
      speeds,
    });
  }

  return {
    schema: "editflow.motion-landmark-assessment.v1",
    passed: issues.length === 0,
    observations,
    segments: segmentResults,
    issues: [...new Set(issues)],
  };
};
