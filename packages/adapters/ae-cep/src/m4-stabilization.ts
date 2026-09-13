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
import {
  AE_STABILIZATION_ADAPTER_BUILD_V23,
  AE_STABILIZATION_COMMANDS_V23,
  AE_STABILIZATION_PROTOCOL_VERSION_V23,
  AE_STABILIZATION_ROUTE_ID_V23,
  capabilityForStabilizationCommandV23,
  isAeStabilizationCommandV23,
  type AeStabilizationCommandV23,
  type AeStabilizationReadbackV23,
  type AeStabilizationRequestV23,
  type AeStabilizationResponseV23,
  type AeStabilizationTransportV23,
} from "./protocol-v2_3.js";

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
    "The read-only solver remains separate from the guarded native runtime; native registration requires explicit protocol 2.3 availability plus a verified visual driver.",
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

// Guarded native AE stabilization runtime layered over the read-only solver above.
export interface CepEvalScriptStabilizationBridgeV23 {
  evalScript(script: string, callback: (result: string) => void): void;
}
const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const ensureResponseV23 = (value: unknown, request: AeStabilizationRequestV23): AeStabilizationResponseV23 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("AE stabilization adapter returned a non-object response.");
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_STABILIZATION_PROTOCOL_VERSION_V23) throw new TypeError("AE stabilization adapter protocol version mismatch.");
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) throw new TypeError("AE stabilization adapter response correlation mismatch.");
  if (candidate["command"] !== request.command || !isAeStabilizationCommandV23(String(candidate["command"]))) throw new TypeError("AE stabilization adapter returned an invalid command correlation.");
  const outcome = candidate["outcome"];
  if (outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED" && outcome !== "APPLIED") throw new TypeError("AE stabilization adapter returned an invalid operation outcome.");
  return candidate as unknown as AeStabilizationResponseV23;
};
export class CepEvalScriptStabilizationTransportV23 implements AeStabilizationTransportV23 {
  readonly bridge: CepEvalScriptStabilizationBridgeV23;
  constructor(bridge: CepEvalScriptStabilizationBridgeV23) { this.bridge = bridge; }
  async dispatch(request: AeStabilizationRequestV23): Promise<AeStabilizationResponseV23> {
    const script = `EditFlow2_dispatch(${escapeForEvalScript(JSON.stringify(request))})`;
    return await new Promise<AeStabilizationResponseV23>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try { resolve(ensureResponseV23(JSON.parse(rawResult) as unknown, request)); }
        catch (error) { reject(error); }
      });
    });
  }
}
export const buildStabilizationRequestV23 = (input: {
  readonly requestId: string; readonly transactionId: string; readonly operationId: string;
  readonly command: AeStabilizationCommandV23; readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeStabilizationRequestV23 => ({
  protocolVersion: AE_STABILIZATION_PROTOCOL_VERSION_V23,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForStabilizationCommandV23(input.command),
  command: input.command,
  expectedHostProjectRevision: null,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M4_STABILIZATION_STRUCTURAL",
});

export const M4_STABILIZATION_READBACK_CAPABILITIES_V23: readonly CapabilityRecord[] =
  AE_STABILIZATION_COMMANDS_V23.map((command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForStabilizationCommandV23(command)), domain: "tracking",
    description: "M4 read-only native motion-stabilization tracker and transform-keyframe readback.",
    status: "PARTIAL", proofMaturity: "STRUCTURAL",
    routes: [{ routeId: asRouteId(AE_STABILIZATION_ROUTE_ID_V23), kind: "HOST_ADAPTER", available: true, adapterVersion: AE_STABILIZATION_ADAPTER_BUILD_V23 }],
    readbackStrategy: "STABILIZATION_TRACKER_AND_TRANSFORM_KEYFRAME_READBACK", visualProofProfile: null,
    rollbackStrategy: "NONE_REQUIRED", riskClass: "R0_READ_ONLY", fallbackPolicy: "FORBID",
  }));

export type StabilizationDirectionV1 = "FORWARD" | "BACKWARD";
export type StabilizationEscalationV1 =
  | "VISUAL_DRIVER_UNAVAILABLE" | "STABILIZATION_TARGET_UNAVAILABLE" | "ANALYSIS_DIRECTION_UNPROVEN"
  | "VISUAL_ACTION_REFUSED" | "STABILIZATION_NOT_OBSERVED";
export interface StabilizationVisualRequestV1 {
  readonly direction: StabilizationDirectionV1;
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly expectedCompName: string;
  readonly expectedLayerName: string;
  readonly expectedControl: "STABILIZE_ANALYZE_APPLY_FORWARD" | "STABILIZE_ANALYZE_APPLY_BACKWARD";
}
export interface StabilizationVisualResultV1 {
  readonly status: "COMPLETED" | "REFUSED";
  readonly visualEvidenceId?: string | null;
  readonly detail?: string | null;
}
export interface StabilizationVisualDriverV1 {
  readonly driverId: string;
  readonly verifiedVision: boolean;
  readonly verifiedCursorControl: boolean;
  readonly supportedDirections: readonly StabilizationDirectionV1[];
  stabilize(input: StabilizationVisualRequestV1): Promise<StabilizationVisualResultV1>;
}
export interface StabilizationRunV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly direction: StabilizationDirectionV1;
  readonly escalationReason: StabilizationEscalationV1 | null;
  readonly baselineTrackerKeyCount: number;
  readonly finalTrackerKeyCount: number;
  readonly baselineAnchorKeyCount: number;
  readonly finalAnchorKeyCount: number;
  readonly visualEvidenceId: string | null;
}
export const M4_STABILIZATION_GUARDED_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("ae.stabilization.position.guarded_visual"), domain: "tracking",
  description: "Guarded native AE Stabilize Motion position workflow with protocol 2.3 tracker/Anchor Point truth.",
  status: "ADAPTER_REQUIRED", proofMaturity: "STRUCTURAL",
  routes: [{ routeId: asRouteId("ae.m4.stabilization.position.guarded_visual.v1"), kind: "GUARDED_UI", available: false, adapterVersion: "0.5.0-dev.1", limitations: ["Requires verified EditGPT vision+cursor control of AE's Tracker panel."] }],
  readbackStrategy: "PRE_POST_PROTOCOL_2_3_STABILIZATION_READBACK",
  visualProofProfile: "M4_NATIVE_POSITION_STABILIZATION_VISUAL_ACTION",
  rollbackStrategy: "FIXTURE_OR_PROJECT_TRANSACTION_OWNED_CLEANUP", riskClass: "R4_EXTERNAL_UI",
  limitations: ["Current retained proof covers native Position stabilization on X and Y with Analyze Forward + Apply.", "Rotation/scale stabilization and Analyze Backward are not yet registered."],
  fallbackPolicy: "EXPLICIT_ONLY",
};
export const capabilityForStabilizationDriverV1 = (driver: StabilizationVisualDriverV1 | null): CapabilityRecord => {
  const available = !!driver && driver.verifiedVision && driver.verifiedCursorControl && driver.supportedDirections.includes("FORWARD");
  if (!available) return M4_STABILIZATION_GUARDED_CAPABILITY_V1;
  return { ...M4_STABILIZATION_GUARDED_CAPABILITY_V1, status: "PARTIAL", proofMaturity: "VISUAL", routes: M4_STABILIZATION_GUARDED_CAPABILITY_V1.routes.map((route) => ({ ...route, available: true })) };
};

const trackerKeyCount = (readback: AeStabilizationReadbackV23 | null): number =>
  readback?.trackers.reduce((max, tracker) => Math.max(max, tracker.featureCenterKeyCount, tracker.confidenceKeyCount, tracker.attachPointKeyCount), 0) ?? -1;
const readTruth = async (transport: AeStabilizationTransportV23, input: { compHostId: number; layerHostId: number }, suffix: string): Promise<AeStabilizationReadbackV23 | null> => {
  const request = buildStabilizationRequestV23({
    requestId: `M4_STABILIZE_${suffix}`, transactionId: `M4_STABILIZE_${suffix}`, operationId: `M4_STABILIZE_${suffix}`,
    command: "stabilization.readback", payload: { comp: { hostId: input.compHostId }, layer: { hostId: input.layerHostId } },
    readbackProfile: "M4_STABILIZATION_VERIFY",
  });
  const response = await transport.dispatch(request);
  return response.readback ?? null;
};
export class GuardedStabilizationControllerV1 {
  readonly transport: AeStabilizationTransportV23;
  readonly visualDriver: StabilizationVisualDriverV1 | null;
  constructor(transport: AeStabilizationTransportV23, visualDriver: StabilizationVisualDriverV1 | null = null) { this.transport = transport; this.visualDriver = visualDriver; }
  async run(input: { readonly compHostId: number; readonly layerHostId: number; readonly expectedCompName: string; readonly expectedLayerName: string; readonly direction: StabilizationDirectionV1 }): Promise<StabilizationRunV1> {
    const before = await readTruth(this.transport, input, "BEFORE");
    if (!before || before.comp.hostId !== input.compHostId || before.layer.hostId !== input.layerHostId) return this.#escalate(input.direction, "STABILIZATION_TARGET_UNAVAILABLE", before, before, null);
    const driver = this.visualDriver;
    if (!driver || !driver.verifiedVision || !driver.verifiedCursorControl) return this.#escalate(input.direction, "VISUAL_DRIVER_UNAVAILABLE", before, before, null);
    if (!driver.supportedDirections.includes(input.direction)) return this.#escalate(input.direction, "ANALYSIS_DIRECTION_UNPROVEN", before, before, null);
    const action = await driver.stabilize({
      direction: input.direction, compHostId: input.compHostId, layerHostId: input.layerHostId,
      expectedCompName: input.expectedCompName, expectedLayerName: input.expectedLayerName,
      expectedControl: input.direction === "FORWARD" ? "STABILIZE_ANALYZE_APPLY_FORWARD" : "STABILIZE_ANALYZE_APPLY_BACKWARD",
    });
    if (action.status !== "COMPLETED") return this.#escalate(input.direction, "VISUAL_ACTION_REFUSED", before, before, action.visualEvidenceId ?? null);
    const after = await readTruth(this.transport, input, "AFTER");
    const beforeTracker = trackerKeyCount(before), afterTracker = trackerKeyCount(after);
    const beforeAnchor = before.transform.anchorPoint.keyCount, afterAnchor = after?.transform.anchorPoint.keyCount ?? -1;
    const observed = !!after && afterTracker >= 2 && afterTracker > Math.max(0, beforeTracker) && afterAnchor >= 2 && afterAnchor > beforeAnchor;
    if (!observed) return this.#escalate(input.direction, "STABILIZATION_NOT_OBSERVED", before, after ?? before, action.visualEvidenceId ?? null);
    return { route: "LOCAL", direction: input.direction, escalationReason: null, baselineTrackerKeyCount: beforeTracker, finalTrackerKeyCount: afterTracker, baselineAnchorKeyCount: beforeAnchor, finalAnchorKeyCount: afterAnchor, visualEvidenceId: action.visualEvidenceId ?? null };
  }
  #escalate(direction: StabilizationDirectionV1, reason: StabilizationEscalationV1, before: AeStabilizationReadbackV23 | null, after: AeStabilizationReadbackV23 | null, visualEvidenceId: string | null): StabilizationRunV1 {
    return { route: "ESCALATE", direction, escalationReason: reason, baselineTrackerKeyCount: trackerKeyCount(before), finalTrackerKeyCount: trackerKeyCount(after), baselineAnchorKeyCount: before?.transform.anchorPoint.keyCount ?? -1, finalAnchorKeyCount: after?.transform.anchorPoint.keyCount ?? -1, visualEvidenceId };
  }
}
