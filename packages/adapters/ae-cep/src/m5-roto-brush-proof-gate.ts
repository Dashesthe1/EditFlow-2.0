export const M5_ROTO_BRUSH_PROOF_PREFLIGHT_VERSION = "M5_ROTO_BRUSH_PREFLIGHT_V1" as const;

export type M5RotoBrushProofRefusalCodeV1 =
  | "NO_PROJECT"
  | "INVALID_ITEM_COUNT"
  | "SAVED_PROJECT"
  | "NONEMPTY_PROJECT"
  | "DIRTY_STATE_UNAVAILABLE"
  | "DIRTY_PROJECT"
  | "INVALID_PROJECT_REVISION";

export interface M5RotoBrushProofProjectStateV1 {
  readonly hasProject: boolean;
  readonly filePath: string | null;
  readonly itemCount: number;
  readonly dirty: boolean | null;
  readonly projectRevision: number | null;
}

export interface M5RotoBrushProofGateDecisionV1 {
  readonly version: typeof M5_ROTO_BRUSH_PROOF_PREFLIGHT_VERSION;
  readonly eligible: boolean;
  readonly refusalCode: M5RotoBrushProofRefusalCodeV1 | null;
  readonly safeToLoadDevelopmentHost: boolean;
  readonly safeToIssueInteractiveActions: boolean;
  readonly state: M5RotoBrushProofProjectStateV1;
}

const decision = (
  state: M5RotoBrushProofProjectStateV1,
  refusalCode: M5RotoBrushProofRefusalCodeV1 | null,
): M5RotoBrushProofGateDecisionV1 => {
  const eligible = refusalCode === null;
  return Object.freeze({
    version: M5_ROTO_BRUSH_PROOF_PREFLIGHT_VERSION,
    eligible,
    refusalCode,
    safeToLoadDevelopmentHost: eligible,
    safeToIssueInteractiveActions: eligible,
    state: Object.freeze({ ...state }),
  });
};

export const evaluateM5RotoBrushProofGateV1 = (
  state: M5RotoBrushProofProjectStateV1,
): M5RotoBrushProofGateDecisionV1 => {
  if (!state.hasProject) return decision(state, "NO_PROJECT");
  if (!Number.isInteger(state.itemCount) || state.itemCount < 0) return decision(state, "INVALID_ITEM_COUNT");
  if (state.filePath !== null) return decision(state, "SAVED_PROJECT");
  if (state.itemCount !== 0) return decision(state, "NONEMPTY_PROJECT");
  if (state.dirty === null) return decision(state, "DIRTY_STATE_UNAVAILABLE");
  if (state.dirty) return decision(state, "DIRTY_PROJECT");
  if (!Number.isInteger(state.projectRevision) || (state.projectRevision ?? 0) < 1) return decision(state, "INVALID_PROJECT_REVISION");
  return decision(state, null);
};

export const assertM5RotoBrushProofGateV1 = (state: M5RotoBrushProofProjectStateV1): M5RotoBrushProofGateDecisionV1 => {
  const result = evaluateM5RotoBrushProofGateV1(state);
  if (!result.eligible) throw new TypeError(`M5 Roto Brush proof preflight refused: ${String(result.refusalCode)}.`);
  return result;
};