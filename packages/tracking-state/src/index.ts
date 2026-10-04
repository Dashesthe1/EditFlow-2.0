export * from "./semantic-attach.js";
export * from "./segmentation.js";
export * from "./segmentation-sequence.js";
export * from "./repair-resume.js";

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
