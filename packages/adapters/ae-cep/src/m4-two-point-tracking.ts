import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import type {
  AeTrackerPointReadbackV21,
  AeTrackerReadbackV21,
  AeTrackerSampleV21,
} from "./protocol-v2_1.js";

export interface TwoPointTransformSampleV1 {
  readonly time: number;
  readonly centerNormalized: readonly [number, number];
  readonly scaleRatio: number;
  readonly rotationDeltaDegrees: number;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export interface TwoPointTransformTrackV1 {
  readonly trackerIndex: number;
  readonly pointAIndex: number;
  readonly pointBIndex: number;
  readonly baselineTime: number;
  readonly baselineDistancePx: number;
  readonly baselineAngleDegrees: number;
  readonly samples: readonly TwoPointTransformSampleV1[];
}
export const M4_TWO_POINT_TRACKING_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("ae.tracker.two_point_transform"),
  domain: "tracking",
  description: "Derive native two-point position/scale/rotation motion from protocol 2.1 tracker readback.",
  status: "PARTIAL",
  proofMaturity: "STRUCTURAL",
  routes: [{
    routeId: asRouteId("ae.m4.tracker.two-point-transform.v1"),
    kind: "HOST_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.1",
    limitations: ["Requires two native AE tracker points with synchronized keyed samples."],
  }],
  readbackStrategy: "PROTOCOL_2_1_TWO_POINT_GEOMETRY",
  visualProofProfile: null,
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Real-AE structural proof verifies synchronized two-point geometry and exact reversible cleanup; image analysis remains a separate guarded operation.",
    "Rotation and scale are derived only from synchronized native attach-point samples.",
  ],
  fallbackPolicy: "FORBID",
};

const finitePair = (value: readonly number[] | null): value is readonly [number, number] =>
  !!value && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const timeKey = (time: number): number => Math.round(time * 1_000_000);
const findPoint = (
  readback: AeTrackerReadbackV21,
  trackerIndex: number,
  pointIndex: number,
): AeTrackerPointReadbackV21 | null =>
  readback.trackers.find((tracker) => tracker.trackerIndex === trackerIndex)
    ?.points.find((point) => point.pointIndex === pointIndex) ?? null;

const normalizeDegrees = (value: number): number => {
  let normalized = value % 360;
  if (normalized <= -180) normalized += 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
};

const usableCompPoint = (sample: AeTrackerSampleV21): readonly [number, number] | null =>
  finitePair(sample.compPoint) ? sample.compPoint : null;

const synchronizedPairs = (
  pointA: AeTrackerPointReadbackV21,
  pointB: AeTrackerPointReadbackV21,
): readonly { readonly a: AeTrackerSampleV21; readonly b: AeTrackerSampleV21 }[] => {
  const byTimeB = new Map(pointB.samples.map((sample) => [timeKey(sample.time), sample] as const));
  return pointA.samples.flatMap((a) => {
    const b = byTimeB.get(timeKey(a.time));
    return b ? [{ a, b }] : [];
  });
};
export const twoPointTrackerReadbackToTransformTrackV1 = (
  readback: AeTrackerReadbackV21,
  trackerIndex = 1,
  pointAIndex = 1,
  pointBIndex = 2,
): TwoPointTransformTrackV1 | null => {
  const width = readback.comp.width;
  const height = readback.comp.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (pointAIndex === pointBIndex) return null;
  const pointA = findPoint(readback, trackerIndex, pointAIndex);
  const pointB = findPoint(readback, trackerIndex, pointBIndex);
  if (!pointA || !pointB || pointA.keyedSampleCount < 2 || pointB.keyedSampleCount < 2) return null;
  const pairs = synchronizedPairs(pointA, pointB).filter(({ a, b }) => usableCompPoint(a) && usableCompPoint(b));
  if (pairs.length < 2) return null;

  const baselinePair = pairs[0];
  if (!baselinePair) return null;
  const baselineA = usableCompPoint(baselinePair.a);
  const baselineB = usableCompPoint(baselinePair.b);
  if (!baselineA || !baselineB) return null;
  const baselineDx = baselineB[0] - baselineA[0];
  const baselineDy = baselineB[1] - baselineA[1];
  const baselineDistancePx = Math.hypot(baselineDx, baselineDy);
  if (!Number.isFinite(baselineDistancePx) || baselineDistancePx <= 1e-6) return null;
  const baselineAngleDegrees = Math.atan2(baselineDy, baselineDx) * 180 / Math.PI;

  const samples: TwoPointTransformSampleV1[] = [];
  for (const pair of pairs) {
    const a = usableCompPoint(pair.a);
    const b = usableCompPoint(pair.b);
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const distancePx = Math.hypot(dx, dy);
    if (!Number.isFinite(distancePx) || distancePx <= 1e-6) return null;
    const angleDegrees = Math.atan2(dy, dx) * 180 / Math.PI;
    samples.push({
      time: pair.a.time,
      centerNormalized: [((a[0] + b[0]) * 0.5) / width, ((a[1] + b[1]) * 0.5) / height],
      scaleRatio: distancePx / baselineDistancePx,
      rotationDeltaDegrees: normalizeDegrees(angleDegrees - baselineAngleDegrees),
      confidence: clamp01(Math.min(pair.a.confidence, pair.b.confidence)),
      evidenceIds: [
        `AE_TRACKER:${readback.layer.stableId ?? readback.layer.hostId}:${trackerIndex}:${pointAIndex}:${pair.a.time}`,
        `AE_TRACKER:${readback.layer.stableId ?? readback.layer.hostId}:${trackerIndex}:${pointBIndex}:${pair.b.time}`,
      ],
    });
  }
  if (samples.length < 2) return null;
  const firstSample = samples[0];
  if (!firstSample) return null;
  return {
    trackerIndex, pointAIndex, pointBIndex,
    baselineTime: firstSample.time,
    baselineDistancePx,
    baselineAngleDegrees,
    samples,
  };
};
