export const NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1 =
  "editflow.native-ae.live-curve-intent.v1" as const;

export type NativeAeLiveCurveIntentV1 =
  | Readonly<{
      schema: typeof NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1;
      kind: "TIME_REMAP_PULSE";
      keyTimesSeconds: readonly [number, number, number];
      velocityContrast: number;
    }>
  | Readonly<{
      schema: typeof NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1;
      kind: "CAMERA_PUSH";
      component: "SCALE" | "POSITION";
      keyTimesSeconds: readonly [number, number, number];
      zoomIntensity: number;
      zoomCenter: readonly [number, number];
    }>;

export interface NativeAeTimeRemapBaselineV1 {
  readonly timeRemapEnabled: boolean;
  readonly propertyAvailable: boolean;
  readonly keys: readonly Readonly<{
    readonly index: number;
    readonly time: number;
    readonly value: number;
  }>[];
}
export interface NativeAeCameraPushBaselineV1 {
  readonly anchorPoint: readonly number[];
  readonly position: readonly number[];
  readonly scale: readonly number[];
  readonly compWidth: number;
  readonly compHeight: number;
}

export interface NativeAeMaterializedKeyframeV1 {
  readonly time: number;
  readonly value: unknown;
}

export interface NativeAeMaterializedEaseIntentV1 {
  readonly keyIndex: number;
  readonly inEase: Readonly<{ readonly speed: number; readonly influence: number }>;
  readonly outEase: Readonly<{ readonly speed: number; readonly influence: number }>;
}

export interface NativeAeMaterializedCurveV1 {
  readonly keyframes: readonly NativeAeMaterializedKeyframeV1[];
  readonly easeIntentByKey: readonly NativeAeMaterializedEaseIntentV1[];
}

export class NativeAeCurveMaterializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "NativeAeCurveMaterializationError";
    this.code = code;
  }
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const orderedTimes = (
  values: readonly number[],
  label: string,
): void => {
  if (
    values.length !== 3
    || values.some((value) => !finite(value) || value < 0)
    || !(values[0]! < values[1]! && values[1]! < values[2]!)
  ) {
    throw new NativeAeCurveMaterializationError(
      "INVALID_ADAPTED_TIME_WINDOW",
      `${label} requires three finite, non-negative, strictly increasing times.`,
    );
  }
};

const vector = (
  value: readonly number[],
  label: string,
): readonly number[] => {
  if (
    value.length < 2
    || value.some((component) => !finite(component))
  ) {
    throw new NativeAeCurveMaterializationError(
      "INVALID_TRANSFORM_BASELINE",
      `${label} requires at least two finite components.`,
    );
  }
  return value;
};

const linearValueAt = (
  first: Readonly<{ time: number; value: number }>,
  last: Readonly<{ time: number; value: number }>,
  time: number,
): number => {
  const duration = last.time - first.time;
  if (!(duration > 0)) {
    throw new NativeAeCurveMaterializationError(
      "INVALID_TIME_REMAP_BASELINE",
      "Native Time Remap boundary times must be strictly increasing.",
    );
  }
  const phase = (time - first.time) / duration;
  return first.value + (last.value - first.value) * phase;
};

export const materializeTimeRemapPulseV1 = (
  intent: Extract<NativeAeLiveCurveIntentV1, { readonly kind: "TIME_REMAP_PULSE" }>,
  baseline: NativeAeTimeRemapBaselineV1,
): NativeAeMaterializedCurveV1 => {
  orderedTimes(intent.keyTimesSeconds, "Time Remap pulse");
  if (
    !finite(intent.velocityContrast)
    || intent.velocityContrast < 0
    || intent.velocityContrast >= 1
  ) {
    throw new NativeAeCurveMaterializationError(
      "INVALID_VELOCITY_CONTRAST",
      "velocityContrast must stay inside [0, 1).",
    );
  }
  if (!baseline.timeRemapEnabled || !baseline.propertyAvailable) {
    throw new NativeAeCurveMaterializationError(
      "TIME_REMAP_NOT_READY",
      "Native Time Remap must be enabled and readable before materialization.",
    );
  }
  if (baseline.keys.length !== 2) {
    throw new NativeAeCurveMaterializationError(
      "PREAUTHORED_TIME_REMAP_REQUIRES_POLICY",
      "Adaptive pulse materialization refuses a pre-authored/custom Time Remap curve.",
    );
  }

  const first = baseline.keys[0]!;
  const last = baseline.keys[1]!;
  if (
    !finite(first.time) || !finite(first.value)
    || !finite(last.time) || !finite(last.value)
    || !(last.time > first.time)
    || !(last.value > first.value)
  ) {
    throw new NativeAeCurveMaterializationError(
      "NON_MONOTONIC_TIME_REMAP_BASELINE",
      "Adaptive pulse materialization requires a forward monotonic two-key baseline.",
    );
  }

  const [startTime, peakTime, endTime] = intent.keyTimesSeconds;
  if (startTime < first.time || endTime > last.time) {
    throw new NativeAeCurveMaterializationError(
      "TIME_REMAP_WINDOW_OUT_OF_SOURCE_RANGE",
      "The adapted pulse window exceeds the native Time Remap source range.",
    );
  }

  const startValue = linearValueAt(first, last, startTime);
  const baselinePeakValue = linearValueAt(first, last, peakTime);
  const endValue = linearValueAt(first, last, endTime);
  const leftSpan = baselinePeakValue - startValue;
  const rightSpan = endValue - baselinePeakValue;
  if (!(leftSpan > 0) || !(rightSpan > 0)) {
    throw new NativeAeCurveMaterializationError(
      "TIME_REMAP_WINDOW_DEGENERATE",
      "The adapted pulse needs positive source-time span on both sides of the peak.",
    );
  }

  // Keep source-time values on the live baseline and express the pulse in
  // playback-rate tangents. Shifting the middle source-time value makes one
  // entire side of the window fast and the other slow; it does not create a
  // velocity peak at the semantic anchor.
  const baselineSpeed = (last.value - first.value) / (last.time - first.time);
  const tailSpeed = baselineSpeed * (1 - intent.velocityContrast);
  const peakSpeed = baselineSpeed * (1 + intent.velocityContrast);
  const tailInfluence = Math.min(55, 30 + intent.velocityContrast * 20);
  const peakInfluence = Math.min(75, 45 + intent.velocityContrast * 30);
  const values = [
    { time: startTime, value: startValue, speed: tailSpeed, influence: tailInfluence },
    { time: peakTime, value: baselinePeakValue, speed: peakSpeed, influence: peakInfluence },
    { time: endTime, value: endValue, speed: tailSpeed, influence: tailInfluence },
  ] as const;

  return {
    keyframes: values.map(({ time, value }) => ({ time, value })),
    easeIntentByKey: values.map(({ speed, influence }, index) => ({
      keyIndex: index + 1,
      inEase: { speed, influence },
      outEase: { speed, influence },
    })),
  };
};

export const materializeCameraPushV1 = (
  intent: Extract<NativeAeLiveCurveIntentV1, { readonly kind: "CAMERA_PUSH" }>,
  baseline: NativeAeCameraPushBaselineV1,
): NativeAeMaterializedCurveV1 => {
  orderedTimes(intent.keyTimesSeconds, "Camera push");
  if (
    !finite(intent.zoomIntensity)
    || intent.zoomIntensity < 0
    || intent.zoomIntensity >= 1
  ) {
    throw new NativeAeCurveMaterializationError(
      "INVALID_ZOOM_INTENSITY",
      "zoomIntensity must stay inside [0, 1).",
    );
  }
  if (
    intent.zoomCenter.length !== 2
    || intent.zoomCenter.some((value) => !finite(value) || value < 0 || value > 1)
  ) {
    throw new NativeAeCurveMaterializationError(
      "INVALID_ZOOM_CENTER",
      "zoomCenter must be a normalized [x, y] pair inside composition bounds.",
    );
  }
  if (
    !finite(baseline.compWidth)
    || !finite(baseline.compHeight)
    || baseline.compWidth <= 0
    || baseline.compHeight <= 0
  ) {
    throw new NativeAeCurveMaterializationError(
      "INVALID_COMPOSITION_BASELINE",
      "Camera push materialization requires positive live composition dimensions.",
    );
  }

  const anchor = vector(baseline.anchorPoint, "anchorPoint");
  const position = vector(baseline.position, "position");
  const scale = vector(baseline.scale, "scale");
  if (scale.some((component) => component <= 0)) {
    throw new NativeAeCurveMaterializationError(
      "INVALID_TRANSFORM_BASELINE",
      "Camera push materialization requires positive live scale components.",
    );
  }

  const factor = 1 + intent.zoomIntensity;
  const subjectPoint = [
    intent.zoomCenter[0] * baseline.compWidth,
    intent.zoomCenter[1] * baseline.compHeight,
  ] as const;
  const peakScale = scale.map((component) => component * factor);
  const peakPosition = position.map((component, index) => {
    if (index >= 2) return component;
    const baselineScaleFactor = scale[index]! / 100;
    const sourceOffset = (subjectPoint[index]! - anchor[index]!) * baselineScaleFactor;
    return component + (1 - factor) * sourceOffset;
  });
  const [startTime, peakTime, endTime] = intent.keyTimesSeconds;
  const values = intent.component === "SCALE"
    ? [
        { time: startTime, value: [...scale] },
        { time: peakTime, value: peakScale },
        { time: endTime, value: [...scale] },
      ]
    : [
        { time: startTime, value: [...position] },
        { time: peakTime, value: peakPosition },
        { time: endTime, value: [...position] },
      ];
  const influence = Math.min(70, 35 + intent.zoomIntensity * 50);

  return {
    keyframes: values,
    easeIntentByKey: values.map((_, index) => ({
      keyIndex: index + 1,
      inEase: { speed: 0, influence },
      outEase: { speed: 0, influence },
    })),
  };
};

export const isNativeAeLiveCurveIntentV1 = (
  value: unknown,
): value is NativeAeLiveCurveIntentV1 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record["schema"] === NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1
    && (record["kind"] === "TIME_REMAP_PULSE" || record["kind"] === "CAMERA_PUSH");
};
