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

export interface FourPointCornerMappingV1 {
  readonly upperLeftIndex: number;
  readonly upperRightIndex: number;
  readonly lowerLeftIndex: number;
  readonly lowerRightIndex: number;
}

export interface FourPointCornersV1 {
  readonly upperLeft: readonly [number, number];
  readonly upperRight: readonly [number, number];
  readonly lowerLeft: readonly [number, number];
  readonly lowerRight: readonly [number, number];
}

export type PerspectiveHomographyV1 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export interface FourPointPerspectiveSampleV1 {
  readonly time: number;
  readonly cornersNormalized: FourPointCornersV1;
  readonly quadAreaNormalized: number;
  readonly homography: PerspectiveHomographyV1;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export interface FourPointPerspectiveTrackV1 {
  readonly trackerIndex: number;
  readonly mapping: FourPointCornerMappingV1;
  readonly baselineTime: number;
  readonly baselineCornersPx: FourPointCornersV1;
  readonly baselineAreaPx: number;
  readonly samples: readonly FourPointPerspectiveSampleV1[];
}

export const M4_FOUR_POINT_TRACKING_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("ae.tracker.four_point_perspective"),
  domain: "tracking",
  description: "Derive native four-point perspective/corner-pin motion and projective homographies from protocol 2.1 tracker readback.",
  status: "PARTIAL",
  proofMaturity: "STRUCTURAL",
  routes: [{
    routeId: asRouteId("ae.m4.tracker.four-point-perspective.v1"),
    kind: "HOST_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.1",
    limitations: ["Requires four explicitly mapped native AE tracker points with synchronized keyed samples and valid convex geometry."],
  }],
  readbackStrategy: "PROTOCOL_2_1_FOUR_POINT_PROJECTIVE_GEOMETRY",
  visualProofProfile: null,
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Real-AE structural proof verifies synchronized four-point geometry and reversible cleanup; image analysis remains a separate guarded operation.",
    "Corner semantics are caller-supplied and never inferred from screen position.",
    "Perspective samples fail closed on degenerate, concave, self-crossing, or winding-flipped quadrilaterals.",
  ],
  fallbackPolicy: "FORBID",
};

const EPSILON = 1e-7;
const REPROJECTION_EPSILON_PX = 1e-4;
const timeKey = (time: number): number => Math.round(time * 1_000_000);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const finitePair = (value: readonly number[] | null): value is readonly [number, number] =>
  !!value && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
const usableCompPoint = (sample: AeTrackerSampleV21): readonly [number, number] | null =>
  finitePair(sample.compPoint) ? [sample.compPoint[0], sample.compPoint[1]] : null;
const findPoint = (
  readback: AeTrackerReadbackV21,
  trackerIndex: number,
  pointIndex: number,
): AeTrackerPointReadbackV21 | null =>
  readback.trackers.find((tracker) => tracker.trackerIndex === trackerIndex)
    ?.points.find((point) => point.pointIndex === pointIndex) ?? null;

const mappingIndices = (mapping: FourPointCornerMappingV1): readonly number[] => [
  mapping.upperLeftIndex,
  mapping.upperRightIndex,
  mapping.lowerLeftIndex,
  mapping.lowerRightIndex,
];

const validMapping = (mapping: FourPointCornerMappingV1): boolean => {
  const indices = mappingIndices(mapping);
  return indices.every((value) => Number.isInteger(value) && value > 0) && new Set(indices).size === 4;
};

const polygonOrder = (corners: FourPointCornersV1): readonly (readonly [number, number])[] => [
  corners.upperLeft,
  corners.upperRight,
  corners.lowerRight,
  corners.lowerLeft,
];

const cross = (
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);

const signedArea = (corners: FourPointCornersV1): number => {
  const points = polygonOrder(corners);
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) return 0;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea * 0.5;
};

const convexWinding = (corners: FourPointCornersV1): -1 | 1 | null => {
  const points = polygonOrder(corners);
  const turns: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    if (!a || !b || !c) return null;
    turns.push(cross(a, b, c));
  }
  if (turns.some((value) => !Number.isFinite(value) || Math.abs(value) <= EPSILON)) return null;
  const sign = turns[0]! > 0 ? 1 : -1;
  if (!turns.every((value) => (value > 0 ? 1 : -1) === sign)) return null;
  const area = signedArea(corners);
  if (!Number.isFinite(area) || Math.abs(area) <= EPSILON || (area > 0 ? 1 : -1) !== sign) return null;
  return sign;
};

const synchronizedSamples = (
  upperLeft: AeTrackerPointReadbackV21,
  upperRight: AeTrackerPointReadbackV21,
  lowerLeft: AeTrackerPointReadbackV21,
  lowerRight: AeTrackerPointReadbackV21,
): readonly {
  readonly upperLeft: AeTrackerSampleV21;
  readonly upperRight: AeTrackerSampleV21;
  readonly lowerLeft: AeTrackerSampleV21;
  readonly lowerRight: AeTrackerSampleV21;
}[] => {
  const upperRightByTime = new Map(upperRight.samples.map((sample) => [timeKey(sample.time), sample] as const));
  const lowerLeftByTime = new Map(lowerLeft.samples.map((sample) => [timeKey(sample.time), sample] as const));
  const lowerRightByTime = new Map(lowerRight.samples.map((sample) => [timeKey(sample.time), sample] as const));
  return upperLeft.samples.flatMap((sample) => {
    const key = timeKey(sample.time);
    const ur = upperRightByTime.get(key);
    const ll = lowerLeftByTime.get(key);
    const lr = lowerRightByTime.get(key);
    return ur && ll && lr ? [{ upperLeft: sample, upperRight: ur, lowerLeft: ll, lowerRight: lr }] : [];
  });
};

const cornersFromSamples = (samples: {
  readonly upperLeft: AeTrackerSampleV21;
  readonly upperRight: AeTrackerSampleV21;
  readonly lowerLeft: AeTrackerSampleV21;
  readonly lowerRight: AeTrackerSampleV21;
}): FourPointCornersV1 | null => {
  const upperLeft = usableCompPoint(samples.upperLeft);
  const upperRight = usableCompPoint(samples.upperRight);
  const lowerLeft = usableCompPoint(samples.lowerLeft);
  const lowerRight = usableCompPoint(samples.lowerRight);
  if (!upperLeft || !upperRight || !lowerLeft || !lowerRight) return null;
  return { upperLeft, upperRight, lowerLeft, lowerRight };
};

const solveLinearSystem = (matrix: number[][], rhs: number[]): number[] | null => {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    let pivotMagnitude = Math.abs(augmented[pivotRow]?.[column] ?? 0);
    for (let row = column + 1; row < size; row += 1) {
      const magnitude = Math.abs(augmented[row]?.[column] ?? 0);
      if (magnitude > pivotMagnitude) { pivotRow = row; pivotMagnitude = magnitude; }
    }
    if (!Number.isFinite(pivotMagnitude) || pivotMagnitude <= EPSILON) return null;
    if (pivotRow !== column) {
      const swap = augmented[column];
      augmented[column] = augmented[pivotRow]!;
      augmented[pivotRow] = swap!;
    }
    const pivot = augmented[column]?.[column] ?? Number.NaN;
    if (!Number.isFinite(pivot) || Math.abs(pivot) <= EPSILON) return null;
    for (let valueColumn = column; valueColumn <= size; valueColumn += 1) {
      augmented[column]![valueColumn] = augmented[column]![valueColumn]! / pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]?.[column] ?? 0;
      if (Math.abs(factor) <= EPSILON) continue;
      for (let valueColumn = column; valueColumn <= size; valueColumn += 1) {
        augmented[row]![valueColumn] = augmented[row]![valueColumn]! - factor * augmented[column]![valueColumn]!;
      }
    }
  }
  const solution = augmented.map((row) => row[size] ?? Number.NaN);
  return solution.every(Number.isFinite) ? solution : null;
};

const projectPoint = (
  homography: PerspectiveHomographyV1,
  point: readonly [number, number],
): readonly [number, number] | null => {
  const denominator = homography[6] * point[0] + homography[7] * point[1] + homography[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= EPSILON) return null;
  const x = (homography[0] * point[0] + homography[1] * point[1] + homography[2]) / denominator;
  const y = (homography[3] * point[0] + homography[4] * point[1] + homography[5]) / denominator;
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

const solveHomography = (
  source: FourPointCornersV1,
  destination: FourPointCornersV1,
): PerspectiveHomographyV1 | null => {
  const sourcePoints = polygonOrder(source);
  const destinationPoints = polygonOrder(destination);
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const from = sourcePoints[index];
    const to = destinationPoints[index];
    if (!from || !to) return null;
    const [x, y] = from;
    const [u, v] = to;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.push(v);
  }
  const solved = solveLinearSystem(matrix, rhs);
  if (!solved || solved.length !== 8) return null;
  const homography: PerspectiveHomographyV1 = [
    solved[0]!, solved[1]!, solved[2]!,
    solved[3]!, solved[4]!, solved[5]!,
    solved[6]!, solved[7]!, 1,
  ];
  for (let index = 0; index < 4; index += 1) {
    const projected = projectPoint(homography, sourcePoints[index]!);
    const expected = destinationPoints[index]!;
    if (!projected || Math.hypot(projected[0] - expected[0], projected[1] - expected[1]) > REPROJECTION_EPSILON_PX) return null;
  }
  return homography;
};

const normalizeCorners = (corners: FourPointCornersV1, width: number, height: number): FourPointCornersV1 => ({
  upperLeft: [corners.upperLeft[0] / width, corners.upperLeft[1] / height],
  upperRight: [corners.upperRight[0] / width, corners.upperRight[1] / height],
  lowerLeft: [corners.lowerLeft[0] / width, corners.lowerLeft[1] / height],
  lowerRight: [corners.lowerRight[0] / width, corners.lowerRight[1] / height],
});

export const fourPointTrackerReadbackToPerspectiveTrackV1 = (
  readback: AeTrackerReadbackV21,
  mapping: FourPointCornerMappingV1,
  trackerIndex = 1,
): FourPointPerspectiveTrackV1 | null => {
  const width = readback.comp.width;
  const height = readback.comp.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !validMapping(mapping)) return null;
  const upperLeft = findPoint(readback, trackerIndex, mapping.upperLeftIndex);
  const upperRight = findPoint(readback, trackerIndex, mapping.upperRightIndex);
  const lowerLeft = findPoint(readback, trackerIndex, mapping.lowerLeftIndex);
  const lowerRight = findPoint(readback, trackerIndex, mapping.lowerRightIndex);
  const points = [upperLeft, upperRight, lowerLeft, lowerRight];
  if (points.some((point) => !point || point.keyedSampleCount < 2)) return null;

  const synchronized = synchronizedSamples(upperLeft!, upperRight!, lowerLeft!, lowerRight!);
  if (synchronized.length < 2) return null;
  const baselineCorners = cornersFromSamples(synchronized[0]!);
  if (!baselineCorners) return null;
  const baselineWinding = convexWinding(baselineCorners);
  if (baselineWinding === null) return null;
  const baselineAreaPx = Math.abs(signedArea(baselineCorners));

  const samples: FourPointPerspectiveSampleV1[] = [];
  for (const synchronizedSample of synchronized) {
    const corners = cornersFromSamples(synchronizedSample);
    if (!corners || convexWinding(corners) !== baselineWinding) return null;
    const homography = solveHomography(baselineCorners, corners);
    if (!homography) return null;
    const areaPx = Math.abs(signedArea(corners));
    samples.push({
      time: synchronizedSample.upperLeft.time,
      cornersNormalized: normalizeCorners(corners, width, height),
      quadAreaNormalized: areaPx / (width * height),
      homography,
      confidence: clamp01(Math.min(
        synchronizedSample.upperLeft.confidence,
        synchronizedSample.upperRight.confidence,
        synchronizedSample.lowerLeft.confidence,
        synchronizedSample.lowerRight.confidence,
      )),
      evidenceIds: [
        `AE_TRACKER:${readback.layer.stableId ?? readback.layer.hostId}:${trackerIndex}:${mapping.upperLeftIndex}:${synchronizedSample.upperLeft.time}`,
        `AE_TRACKER:${readback.layer.stableId ?? readback.layer.hostId}:${trackerIndex}:${mapping.upperRightIndex}:${synchronizedSample.upperRight.time}`,
        `AE_TRACKER:${readback.layer.stableId ?? readback.layer.hostId}:${trackerIndex}:${mapping.lowerLeftIndex}:${synchronizedSample.lowerLeft.time}`,
        `AE_TRACKER:${readback.layer.stableId ?? readback.layer.hostId}:${trackerIndex}:${mapping.lowerRightIndex}:${synchronizedSample.lowerRight.time}`,
      ],
    });
  }
  if (samples.length < 2) return null;
  return {
    trackerIndex,
    mapping: { ...mapping },
    baselineTime: samples[0]!.time,
    baselineCornersPx: baselineCorners,
    baselineAreaPx,
    samples,
  };
};
