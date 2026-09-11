export interface SubjectObservationV1 {
  readonly semanticId: string;
  readonly timestampMs: number;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly confidence: number;
  readonly residualError: number;
  readonly occlusion: number;
  readonly isolationAvailable: boolean;
  readonly evidenceIds?: readonly string[];
}

export interface TrackedSubjectEstimateV1 {
  readonly semanticId: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly accelerationX: number;
  readonly accelerationY: number;
  readonly trackConfidence: number;
  readonly driftRisk: number;
  readonly occlusion: number;
  readonly framingQuality: number;
  readonly isolationAvailable: boolean;
  readonly evidenceIds: readonly string[];
}

export interface TrackingStateReducerOptionsV1 {
  readonly maxReasonableSpeed?: number;
  readonly maxReasonableAcceleration?: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const finite01 = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;

const validObservation = (value: SubjectObservationV1): boolean =>
  value.semanticId.length > 0
  && Number.isFinite(value.timestampMs)
  && value.timestampMs >= 0
  && [value.x, value.y, value.scale, value.confidence, value.residualError,
    value.occlusion].every(finite01);

const framingQuality = (x: number, y: number): number => {
  const edgeRisk = Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) * 2;
  return clamp01(1 - edgeRisk);
};

export class TrackingStateReducerV1 {
  readonly maxReasonableSpeed: number;
  readonly maxReasonableAcceleration: number;
  #previous = new Map<string, TrackedSubjectEstimateV1 & { timestampMs: number }>();

  constructor(options: TrackingStateReducerOptionsV1 = {}) {
    this.maxReasonableSpeed = options.maxReasonableSpeed ?? 2;
    this.maxReasonableAcceleration = options.maxReasonableAcceleration ?? 6;
  }
  update(observation: SubjectObservationV1): TrackedSubjectEstimateV1 | null {
    if (!validObservation(observation)) return null;
    const previous = this.#previous.get(observation.semanticId);
    let velocityX = 0;
    let velocityY = 0;
    let accelerationX = 0;
    let accelerationY = 0;

    if (previous) {
      const dtSeconds = (observation.timestampMs - previous.timestampMs) / 1000;
      if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return null;
      velocityX = (observation.x - previous.x) / dtSeconds;
      velocityY = (observation.y - previous.y) / dtSeconds;
      accelerationX = (velocityX - previous.velocityX) / dtSeconds;
      accelerationY = (velocityY - previous.velocityY) / dtSeconds;
    }

    const speed = Math.hypot(velocityX, velocityY);
    const acceleration = Math.hypot(accelerationX, accelerationY);
    const speedExcess = clamp01(speed / this.maxReasonableSpeed);
    const accelerationExcess = clamp01(acceleration / this.maxReasonableAcceleration);
    const driftRisk = clamp01(
      (observation.residualError * 0.55)
      + ((1 - observation.confidence) * 0.25)
      + (speedExcess * 0.10)
      + (accelerationExcess * 0.10),
    );
    const estimate: TrackedSubjectEstimateV1 = {
      semanticId: observation.semanticId,
      x: observation.x,
      y: observation.y,
      scale: observation.scale,
      velocityX,
      velocityY,
      accelerationX,
      accelerationY,
      trackConfidence: observation.confidence,
      driftRisk,
      occlusion: observation.occlusion,
      framingQuality: framingQuality(observation.x, observation.y),
      isolationAvailable: observation.isolationAvailable,
      evidenceIds: [...new Set(observation.evidenceIds ?? [])],
    };
    this.#previous.set(observation.semanticId, { ...estimate, timestampMs: observation.timestampMs });
    return estimate;
  }

  reset(semanticId?: string): void {
    if (semanticId) this.#previous.delete(semanticId);
    else this.#previous.clear();
  }
}
