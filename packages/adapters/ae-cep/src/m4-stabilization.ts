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

export interface StabilizationSolveOptionsV1 {
  readonly trackerIndex?: number;
  readonly primaryPointIndex?: number;
  readonly secondaryPointIndex?: number;
  readonly stabilizePosition?: boolean;
  readonly stabilizeRotation?: boolean;
  readonly stabilizeScale?: boolean;
  readonly referenceTime?: number;
}

export interface StabilizationComponentSelectionV1 {
  readonly position: boolean;
  readonly rotation: boolean;
  readonly scale: boolean;
}

export interface StabilizationSampleV1 {
  readonly time: number;
  /** Composition-space translation that returns the primary tracked point to its reference location. */
  readonly counterTranslationCompPx: readonly [number, number] | null;
  /** Component-wise inverse rotation relative to the reference two-point vector. */
  readonly counterRotationDegrees: number | null;
  /** Component-wise reciprocal scale relative to the reference two-point distance. */
  readonly scaleMultiplier: number | null;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export interface StabilizationSolutionV1 {
  readonly trackerIndex: number;
  readonly primaryPointIndex: number;
  readonly secondaryPointIndex: number | null;
  readonly referenceTime: number;
  readonly components: StabilizationComponentSelectionV1;
  readonly samples: readonly StabilizationSampleV1[];
}

export const M4_STABILIZATION_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("ae.tracker.stabilization.solve"),
  domain: "tracking",
  description: "Derive deterministic composition-space counter-motion for position, rotation, and scale from protocol 2.1 native tracker readback.",
  status: "PARTIAL",
  proofMaturity: "DECLARED",
  routes: [{
    routeId: asRouteId("ae.m4.tracker.stabilization-solve.v1"),
    kind: "HOST_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.1",
    limitations: [
      "Read-only solver only; it does not write AE properties or invoke native Stabilize Motion.",
      "Rotation and scale require two distinct native AE tracker points with synchronized keyed samples.",
    ],
  }],
  readbackStrategy: "PROTOCOL_2_1_STABILIZATION_GEOMETRY",
  visualProofProfile: null,
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Outputs component-wise inverse geometry in composition space; these values are not direct Anchor Point, Rotation, or Scale keyframe payloads.",
    "Runtime capability registration is intentionally withheld until a real-AE stabilization proof is captured and accepted.",
  ],
  fallbackPolicy: "FORBID",
};

interface StabilizationFrameV1 {
  readonly primary: AeTrackerSampleV21;
  readonly secondary: AeTrackerSampleV21 | null;
}

const finitePair = (value: readonly number[] | null): value is readonly [number, number] =>
  !!value && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const timeKey = (time: number): number => Math.round(time * 1_000_000);
const usableCompPoint = (sample: AeTrackerSampleV21): readonly [number, number] | null =>
  finitePair(sample.compPoint) ? sample.compPoint : null;
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
  return Object.is(normalized, -0) ? 0 : normalized;
};

const synchronizedFrames = (
  primary: AeTrackerPointReadbackV21,
  secondary: AeTrackerPointReadbackV21 | null,
): readonly StabilizationFrameV1[] => {
  if (!secondary) {
    return primary.samples
      .filter((sample) => usableCompPoint(sample))
      .map((sample) => ({ primary: sample, secondary: null }))
      .sort((a, b) => a.primary.time - b.primary.time);
  }
  const secondaryByTime = new Map(secondary.samples.map((sample) => [timeKey(sample.time), sample] as const));
  return primary.samples
    .flatMap((sample) => {
      const peer = secondaryByTime.get(timeKey(sample.time));
      return peer && usableCompPoint(sample) && usableCompPoint(peer)
        ? [{ primary: sample, secondary: peer }]
        : [];
    })
    .sort((a, b) => a.primary.time - b.primary.time);
};

const trackerEvidenceId = (
  readback: AeTrackerReadbackV21,
  trackerIndex: number,
  pointIndex: number,
  time: number,
): string => {
  const layerRef = readback.layer.stableId ?? readback.layer.hostId ?? "UNKNOWN_LAYER";
  return `AE_TRACKER:${layerRef}:${trackerIndex}:${pointIndex}:${time}`;
};

/**
 * Derive a read-only stabilization solution from native tracker geometry.
 *
 * The returned translation is expressed in composition pixels, while rotation and scale are
 * component-wise inverse deltas relative to the selected reference frame. Applying those values
 * to arbitrary AE layer transforms requires a separate host adapter and live-AE proof.
 */
export const trackerReadbackToStabilizationSolutionV1 = (
  readback: AeTrackerReadbackV21,
  options: StabilizationSolveOptionsV1 = {},
): StabilizationSolutionV1 | null => {
  const trackerIndex = options.trackerIndex ?? 1;
  const primaryPointIndex = options.primaryPointIndex ?? 1;
  const secondaryPointIndex = options.secondaryPointIndex ?? 2;
  const stabilizePosition = options.stabilizePosition ?? true;
  const stabilizeRotation = options.stabilizeRotation ?? false;
  const stabilizeScale = options.stabilizeScale ?? false;
  const needsSecondary = stabilizeRotation || stabilizeScale;

  if (!stabilizePosition && !stabilizeRotation && !stabilizeScale) return null;
  if (needsSecondary && primaryPointIndex === secondaryPointIndex) return null;
  if (options.referenceTime !== undefined && !Number.isFinite(options.referenceTime)) return null;

  const primary = findPoint(readback, trackerIndex, primaryPointIndex);
  if (!primary || primary.keyedSampleCount < 2) return null;
  const secondary = needsSecondary ? findPoint(readback, trackerIndex, secondaryPointIndex) : null;
  if (needsSecondary && (!secondary || secondary.keyedSampleCount < 2)) return null;

  const frames = synchronizedFrames(primary, secondary);
  if (frames.length < 2) return null;
  const referenceKey = options.referenceTime === undefined
    ? timeKey(frames[0]!.primary.time)
    : timeKey(options.referenceTime);
  const referenceFrame = frames.find((frame) => timeKey(frame.primary.time) === referenceKey);
  if (!referenceFrame) return null;
  const referencePrimary = usableCompPoint(referenceFrame.primary);
  if (!referencePrimary) return null;

  let referenceAngleDegrees = 0;
  let referenceDistancePx = 0;
  if (needsSecondary) {
    if (!referenceFrame.secondary) return null;
    const referenceSecondary = usableCompPoint(referenceFrame.secondary);
    if (!referenceSecondary) return null;
    const dx = referenceSecondary[0] - referencePrimary[0];
    const dy = referenceSecondary[1] - referencePrimary[1];
    referenceDistancePx = Math.hypot(dx, dy);
    if (!Number.isFinite(referenceDistancePx) || referenceDistancePx <= 1e-6) return null;
    referenceAngleDegrees = Math.atan2(dy, dx) * 180 / Math.PI;
  }

  const samples: StabilizationSampleV1[] = [];
  for (const frame of frames) {
    const primaryComp = usableCompPoint(frame.primary);
    if (!primaryComp) return null;

    let counterRotationDegrees: number | null = null;
    let scaleMultiplier: number | null = null;
    let confidence = clamp01(frame.primary.confidence);
    const evidenceIds = [trackerEvidenceId(readback, trackerIndex, primaryPointIndex, frame.primary.time)];

    if (needsSecondary) {
      if (!frame.secondary) return null;
      const secondaryComp = usableCompPoint(frame.secondary);
      if (!secondaryComp) return null;
      const dx = secondaryComp[0] - primaryComp[0];
      const dy = secondaryComp[1] - primaryComp[1];
      const distancePx = Math.hypot(dx, dy);
      if (!Number.isFinite(distancePx) || distancePx <= 1e-6) return null;
      const angleDegrees = Math.atan2(dy, dx) * 180 / Math.PI;
      if (stabilizeRotation) {
        counterRotationDegrees = normalizeDegrees(referenceAngleDegrees - angleDegrees);
      }
      if (stabilizeScale) {
        scaleMultiplier = referenceDistancePx / distancePx;
      }
      confidence = clamp01(Math.min(frame.primary.confidence, frame.secondary.confidence));
      evidenceIds.push(trackerEvidenceId(readback, trackerIndex, secondaryPointIndex, frame.secondary.time));
    }

    samples.push({
      time: frame.primary.time,
      counterTranslationCompPx: stabilizePosition
        ? [referencePrimary[0] - primaryComp[0], referencePrimary[1] - primaryComp[1]]
        : null,
      counterRotationDegrees,
      scaleMultiplier,
      confidence,
      evidenceIds,
    });
  }

  return {
    trackerIndex,
    primaryPointIndex,
    secondaryPointIndex: needsSecondary ? secondaryPointIndex : null,
    referenceTime: referenceFrame.primary.time,
    components: {
      position: stabilizePosition,
      rotation: stabilizeRotation,
      scale: stabilizeScale,
    },
    samples,
  };
};
