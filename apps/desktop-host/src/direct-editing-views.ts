import type { PracticeProductionJobV1 } from "../../../packages/practice-homework/src/production-worker.js";

// Receipts remain complete on disk and by job ID. Routine reads carry current work.
export const productionJobSummaryV1 = (job: PracticeProductionJobV1) => ({
  jobId: job.jobId, kind: job.kind, status: job.status, createdAt: job.createdAt,
  updatedAt: job.updatedAt, ...(job.heartbeatAt ? { heartbeatAt: job.heartbeatAt } : {}),
  ...(job.error ? { error: job.error } : {}),
  decisionId: job.payload.editorialDecision?.decisionId ?? null,
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

export const productionJobsViewV1 = (jobs: readonly PracticeProductionJobV1[], full = false) => ({
  jobs: full ? jobs : jobs.map(productionJobSummaryV1),
  totalJobs: jobs.length,
  unresolvedJobIds: jobs.filter(j => ["PENDING", "RUNNING", "FAILED", "REVIEW_REQUIRED", "RECONCILE_REQUIRED"].includes(j.status)).map(j => j.jobId),
  detail: full ? "FULL" : "SUMMARY",
  detailLookup: "Read a retained jobId for the complete immutable decision and receipt; never resubmit an uncertain write.",
});

export const productionSnapshotViewV1 = (snapshot: any, full = false) => {
  if (full || !snapshot?.workflow) return snapshot;
  const workflow = snapshot.workflow;
  const { stageElapsedMs, budgetBaselineMs, strategyChangedAt, strategyKey, ...current } = snapshot;
  return { ...current, workflow: { activeDecisionId: workflow.activeDecisionId ?? null,
    plans: workflow.plans?.filter((entry: any) => entry.plan?.decisionId === workflow.activeDecisionId) ?? [],
    reviews: workflow.reviews?.slice(-1) ?? [], milestones: workflow.milestones ?? [],
    retainedPlanCount: workflow.plans?.length ?? 0, retainedReviewCount: workflow.reviews?.length ?? 0,
    historyAvailable: true } };
};
