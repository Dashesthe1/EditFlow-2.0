/** Stores only ChatGPT's explicit pixel judgments. Never selects, scores or edits. */
export const VISUAL_DIMENSIONS_V1 = ["source", "timing", "framing", "effects", "transitions", "color", "text", "audio"] as const;
export type VisualDimensionV1 = typeof VISUAL_DIMENSIONS_V1[number];
export interface VisualComparisonV1 {
  renderTimeMs: number; renderEvidenceId: string;
  referenceTimeMs?: number; referenceEvidenceId?: string;
}
export interface VisualObservationV1 {
  clipId: string; dimensions: VisualDimensionV1[]; verdict: "PASS" | "REVISE" | "REJECTED";
  observation: string; hypothesis?: string; settings?: Record<string, unknown>;
  comparisons: VisualComparisonV1[];
}
export interface VisualReviewV1 {
  authority: "CHATGPT_DIRECT"; reviewId: string; renderJobId: string;
  sourceRevision: number; renderIdentity?: string; reviewedAt: string; observations: VisualObservationV1[];
}
export interface VisualDecisionV1 extends VisualObservationV1 {
  reviewId: string; renderJobId: string; sourceRevision: number; reviewedAt: string;
  status: "ACCEPTED" | "UNFINISHED" | "NEEDS_REVIEW";
  failedRenderIds: string[]; changedBy?: string;
}
export interface VisualContinuityV1 {
  schema: "editflow.visual-continuity.v1";
  decisions: Record<string, VisualDecisionV1>;
  mutations: Record<string, { revision: number | null; jobId: string }>;
  reviews: VisualReviewV1[];
}
export const emptyVisualContinuityV1 = (): VisualContinuityV1 => ({ schema: "editflow.visual-continuity.v1", decisions: {}, mutations: {}, reviews: [] });
const text = (value: unknown, max = 1600): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
export function parseVisualReviewV1(input: Record<string, any>, sourceRevision: number, renderIdentity?: string): VisualReviewV1 {
  if (input?.authority !== "CHATGPT_DIRECT" || !text(input.reviewId, 200) || !text(input.renderJobId, 200)
    || !Number.isFinite(sourceRevision) || !Array.isArray(input.observations) || !input.observations.length || input.observations.length > 64) throw new TypeError("VISUAL_REVIEW_INVALID: provide a direct review of a retained render.");
  for (const o of input.observations) {
    if (!text(o?.clipId, 200) || !["PASS", "REVISE", "REJECTED"].includes(o.verdict) || !text(o.observation)
      || !Array.isArray(o.dimensions) || !o.dimensions.length || o.dimensions.some((d: any) => !VISUAL_DIMENSIONS_V1.includes(d))
      || new Set(o.dimensions).size !== o.dimensions.length || !Array.isArray(o.comparisons) || !o.comparisons.length || o.comparisons.length > 48
      || o.hypothesis !== undefined && !text(o.hypothesis)
      || o.settings !== undefined && (!o.settings || typeof o.settings !== "object" || Array.isArray(o.settings) || JSON.stringify(o.settings).length > 6000)) throw new TypeError("VISUAL_OBSERVATION_INVALID: declare dimensions, judgment, settings and issued pixel comparisons.");
    if (o.comparisons.some((c: any) => !Number.isFinite(c.renderTimeMs) || c.renderTimeMs < 0 || !text(c.renderEvidenceId, 200)
      || c.referenceTimeMs !== undefined && (!Number.isFinite(c.referenceTimeMs) || c.referenceTimeMs < 0 || !text(c.referenceEvidenceId, 200)))) throw new TypeError("VISUAL_COMPARISON_INVALID");
    if (o.verdict === "PASS" && o.dimensions.some((d: string) => ["source", "timing"].includes(d))
      && new Set(o.comparisons.map((c: any) => c.renderTimeMs)).size < 3) throw new TypeError("TEMPORAL_REVIEW_REQUIRES_THREE_TIMESTAMPS: one pose does not establish traversal.");
  }
  return { authority: "CHATGPT_DIRECT", reviewId: input.reviewId, renderJobId: input.renderJobId,
    sourceRevision, ...(renderIdentity ? { renderIdentity } : {}), reviewedAt: new Date().toISOString(), observations: structuredClone(input.observations) };
}
/** Render inspections use file time; reference inspections use composition time. */
export function validateVisualComparisonTimesV1(observation: VisualObservationV1, startMs: number, endMs: number,
  bounds?: { referenceStartMs: number; referenceEndMs: number }): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new TypeError("VISUAL_REVIEW_REQUIRES_VIDEO_INTERVAL");
  const times = observation.comparisons.map(c => c.renderTimeMs + startMs);
  if (times.some(t => t < startMs || t >= endMs)) throw new TypeError("VISUAL_REVIEW_RENDER_TIME_OUTSIDE_INTERVAL");
  if (!bounds) return;
  if (observation.comparisons.some((c, i) => times[i]! < bounds.referenceStartMs || times[i]! >= bounds.referenceEndMs
    || c.referenceTimeMs === undefined || !c.referenceEvidenceId || Math.abs(times[i]! - c.referenceTimeMs) > 1)) throw new TypeError("VISUAL_REVIEW_SHOT_TIME_MISMATCH: compare synchronized composition times; renderTimeMs is local file time.");
  if (observation.verdict === "PASS" && observation.dimensions.some(d => d === "source" || d === "timing")) {
    const span = bounds.referenceEndMs - bounds.referenceStartMs;
    if (Math.min(...times) > bounds.referenceStartMs + span * .2 || Math.max(...times) < bounds.referenceStartMs + span * .8)
      throw new TypeError("TEMPORAL_REVIEW_MUST_SPAN_SHOT: inspect beginning, middle and end.");
  }
}
export function retainVisualReviewV1(state: VisualContinuityV1, review: VisualReviewV1): VisualContinuityV1 {
  const prior = state.reviews.find(r => r.reviewId === review.reviewId);
  if (prior) {
    const identity = (r: VisualReviewV1) => JSON.stringify({ ...r, reviewedAt: undefined });
    if (identity(prior) !== identity(review)) throw new TypeError("VISUAL_REVIEW_ID_REUSED: changed judgments need a new reviewId.");
    return state;
  }
  const next = structuredClone(state);
  next.reviews.push(review);
  for (const o of review.observations) {
    if (o.verdict === "REJECTED") continue; // Keep rejected settings/evidence without replacing an acceptance.
    for (const dimension of o.dimensions) {
      const key = o.clipId + ":" + dimension, old = next.decisions[key], change = next.mutations[key];
      // An older render stays in history but cannot overrule a newer reviewed state.
      if (old && old.sourceRevision > review.sourceRevision) continue;
      const stale = !!change && (change.revision === null || change.revision > review.sourceRevision);
      const failedRenderIds = o.verdict === "PASS" ? [] : [...new Set([...(old?.failedRenderIds ?? []), review.renderIdentity ?? review.renderJobId])];
      next.decisions[key] = { ...o, dimensions: [dimension], reviewId: review.reviewId, renderJobId: review.renderJobId,
        sourceRevision: review.sourceRevision, reviewedAt: review.reviewedAt,
        status: stale ? "NEEDS_REVIEW" : o.verdict === "PASS" ? "ACCEPTED" : "UNFINISHED", failedRenderIds,
        ...(stale ? { changedBy: change!.jobId } : {}) };
    }
  }
  return next;
}
export function invalidateVisualDecisionsV1(state: VisualContinuityV1, clipIds: readonly string[], dimensions: readonly VisualDimensionV1[], revision: number | null, jobId: string): VisualContinuityV1 {
  const next = structuredClone(state);
  for (const clipId of clipIds) for (const dimension of dimensions) {
    const key = clipId + ":" + dimension;
    next.mutations[key] = { revision, jobId };
    const old = next.decisions[key];
    if (old) next.decisions[key] = { ...old, status: "NEEDS_REVIEW", changedBy: jobId };
  }
  return next;
}
/** Conservative mechanical impact, not an editorial choice. Unknown writes affect all declared targets. */
export function visualMutationDimensionsV1(body: Record<string, any>): VisualDimensionV1[] {
  const commands = (body.intents ?? body.goal?.intents)?.map((i: any) => i.kind) ?? body.plan?.operations?.map((o: any) => o.input?.command) ?? [];
  if (!commands.length) return [...VISUAL_DIMENSIONS_V1];
  const dimensions = new Set<VisualDimensionV1>();
  for (const command of commands) {
    if (/^(READ_|readback\.)/.test(command ?? "")) continue;
    if (/^(SET_LAYER_TRANSFORM|layer\.set_transform)$/.test(command)) ["framing", "effects", "transitions", "text"].forEach(d => dimensions.add(d as VisualDimensionV1));
    else if (/^(SET_TEXT_DOCUMENT|CREATE_TEXT_LAYER|text\.)/.test(command)) ["text", "effects", "transitions"].forEach(d => dimensions.add(d as VisualDimensionV1));
    else VISUAL_DIMENSIONS_V1.forEach(d => dimensions.add(d));
  }
  return [...dimensions];
}
export function visualContinuityViewV1(state = emptyVisualContinuityV1()) {
  const decisions = Object.values(state.decisions);
  const group = (items: VisualDecisionV1[]) => {
    const groups = new Map<string, VisualDecisionV1>();
    for (const item of items) {
      const key = JSON.stringify({ ...item, dimensions: [] }), prior = groups.get(key);
      if (prior) prior.dimensions.push(...item.dimensions);
      else groups.set(key, { ...item, dimensions: [...item.dimensions] });
    }
    return [...groups.values()];
  };
  return { schema: state.schema, authority: "CHATGPT_DIRECT", advisory: true,
    accepted: group(decisions.filter(d => d.status === "ACCEPTED")),
    unfinished: group(decisions.filter(d => d.status !== "ACCEPTED")),
    rejectedAlternatives: state.reviews.flatMap(r => r.observations.filter(o => o.verdict === "REJECTED").map(o => ({ ...o, renderJobId: r.renderJobId, reviewId: r.reviewId }))).slice(-12),
    repeatedIssues: decisions.filter(d => d.status !== "ACCEPTED" && d.failedRenderIds.length >= 2).map(d => ({ clipId: d.clipId, dimension: d.dimensions[0], failedReviewCount: d.failedRenderIds.length, hypothesis: d.hypothesis ?? null })),
    latestReview: state.reviews.at(-1) ? { reviewId: state.reviews.at(-1)!.reviewId, renderJobId: state.reviews.at(-1)!.renderJobId, sourceRevision: state.reviews.at(-1)!.sourceRevision } : null,
    retainedReviewCount: state.reviews.length,
    instruction: "Preserve accepted dimensions unless current pixels prove a defect. Settle source traversal across synchronized times before crop/grade. After repeated failed reviews, reassess the cause or compare deliberately different alternatives. These are observations for ChatGPT, never a stop/approval gate. Full history is available on request." };
}
