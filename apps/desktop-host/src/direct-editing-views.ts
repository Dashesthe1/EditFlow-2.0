import type { PracticeProductionJobV1 } from "../../../packages/practice-homework/src/production-worker.js";
import { visualContinuityViewV1 } from "../../../packages/practice-homework/src/visual-continuity.js";

export const assignmentViewV1 = (assignment: any, full = false) => {
  if (full || !assignment) return assignment;
  const { chatMessage, practiceSceneMatches, preflight, ...current } = assignment;
  return { ...current, detail: "CURRENT", historyAvailable: true,
    instruction: "Resume current AE and visualContinuity; historical plans are not unfinished tasks. Complete methods and full assignment history are available on demand.",
    ...(preflight ? { preflight: { stage: preflight.stage, updatedAt: preflight.updatedAt, totalShotIds: preflight.totalShotIds,
      completedShotIds: preflight.completedShotIds, unresolvedShotIds: preflight.unresolvedShotIds } } : {}),
    practiceSceneMatches: (practiceSceneMatches ?? []).map((m: any) => ({ shotId: m.shotId, sourceId: m.sourceId,
      sourcePath: m.sourcePath, sourceStartMs: m.sourceStartMs, sourceEndMs: m.sourceEndMs, direction: m.direction,
      playbackRate: m.playbackRate, selectionMode: m.selectionMode,
      chatgptSelection: m.chatgptSelection ? { decisionId: m.chatgptSelection.decisionId, reviewedAt: m.chatgptSelection.reviewedAt, rationale: m.chatgptSelection.rationale } : null,
      workingMedia: m.workingMedia ? { workingSourceId: m.workingMedia.workingSourceId, sourcePath: m.workingMedia.sourcePath,
        originalSourceId: m.workingMedia.originalSourceId, originalStartMs: m.workingMedia.originalStartMs, originalEndMs: m.workingMedia.originalEndMs } : null })) };
};

// Receipts remain complete on disk and by job ID. Routine reads carry current work.
export const productionJobSummaryV1 = (job: PracticeProductionJobV1) => ({
  jobId: job.jobId, kind: job.kind, status: job.status, createdAt: job.createdAt,
  updatedAt: job.updatedAt, ...(job.heartbeatAt ? { heartbeatAt: job.heartbeatAt } : {}),
  ...(job.error ? { error: job.error } : {}),
  decisionId: job.payload.editorialDecision?.decisionId ?? null,
  clipIds: job.payload.researchContext?.clipIds ?? [],
  rationale: job.payload.editorialDecision?.rationale ?? null,
  ...(job.kind === "LOCAL_RENDER" ? { renderRequest: { compStableId: job.payload.compStableId, startMs: job.payload.startMs,
    endMs: job.payload.endMs, frameTimesMs: job.payload.frameTimesMs, resolutionScale: job.payload.resolutionScale ?? 1 } } : {}),
  ...(job.result === undefined ? {} : { result: compactEditResultV1(job.result) }),
});

export const compactEditResultV1 = (value: any): any => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { projectSnapshot, environmentProbe, project, environment, ...rest } = value;
  return { ...rest,
    ...(projectSnapshot ? { projectRevision: projectSnapshot.hostRevision } : {}),
    ...(project ? { projectRevision: project.hostRevision } : {}),
    ...(rest.finalState ? { finalState: projectStateSummaryV1(rest.finalState) } : {}),
  };
};

export const projectStateSummaryV1 = (state: any) => {
  if (!state) return state;
  const observed = state.observed ?? state;
  return { projectId: observed.projectId, projectRevision: observed.projectRevision,
    projectFingerprint: observed.projectFingerprint, environmentFingerprint: observed.environmentFingerprint,
    ...(state.project ? { filePath: state.project.filePath, itemCount: state.project.itemCount,
      activeItemHostId: state.project.activeItemHostId } : {}) };
};

export const productionJobsViewV1 = (jobs: readonly PracticeProductionJobV1[], full = false) => {
  const unresolved = jobs.filter(j => ["PENDING", "RUNNING", "FAILED", "REVIEW_REQUIRED", "RECONCILE_REQUIRED"].includes(j.status));
  const latestWholeRender = [...jobs].reverse().find(j => j.kind === "LOCAL_RENDER" && j.status === "SUCCEEDED" && j.payload.startMs === 0 && (j.payload.resolutionScale ?? 1) === 1);
  const retained = new Set([...unresolved.map(j => j.jobId), ...jobs.slice(-8).map(j => j.jobId), ...(latestWholeRender ? [latestWholeRender.jobId] : [])]);
  return {
  jobs: full ? jobs : jobs.filter(j => retained.has(j.jobId)).map(productionJobSummaryV1),
  totalJobs: jobs.length,
  unresolvedJobIds: unresolved.map(j => j.jobId),
  latestWholeRenderJobId: latestWholeRender?.jobId ?? null,
  historyAvailable: true,
  detail: full ? "FULL" : "SUMMARY",
  detailLookup: "Read a retained jobId for the complete immutable decision and receipt; never resubmit an uncertain write.",
}; };

export const productionSnapshotViewV1 = (snapshot: any, full = false) => {
  if (full || !snapshot) return snapshot;
  const workflow = snapshot.workflow ?? {};
  const { stageElapsedMs, budgetBaselineMs, strategyChangedAt, strategyKey, visualContinuity, ...current } = snapshot;
  return { ...current, visualContinuity: visualContinuityViewV1(visualContinuity), workflow: { activeDecisionId: workflow.activeDecisionId ?? null,
    plans: [], reviews: [], milestones: workflow.milestones ?? [],
    retainedPlanCount: workflow.plans?.length ?? 0, retainedReviewCount: workflow.reviews?.length ?? 0,
    historyAvailable: true } };
};
