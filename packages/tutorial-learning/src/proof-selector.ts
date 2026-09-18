import {
  decideIncrementalProof,
  type IncrementalProofNodeV1,
  type IncrementalProofTokenV1,
  type ProofDependencyDigestV1,
  type ProofStrategy,
  type TestImpactAnalysisV1,
} from "../../incremental-proof-engine/src/index.js";
import type {
  TutorialProofPlanV1,
  TutorialProofStageV1,
} from "./proof-compiler.js";

export type TutorialProofStageActionV1 =
  | "SKIP_NOT_REQUIRED"
  | "REUSE_PASS"
  | "RUN_STAGE"
  | "RUN_FULL"
  | "BLOCKED";

export interface TutorialStageProofContextV1 {
  readonly environmentFingerprint: string;
  readonly checkpointKey?: string | null;
  readonly dependencies: readonly ProofDependencyDigestV1[];
  readonly token?: IncrementalProofTokenV1 | null;
  readonly allowEvidenceReuse?: boolean;
}
export interface TutorialProofSelectionInputV1 {
  readonly plan: TutorialProofPlanV1;
  readonly stageContexts?: Readonly<Record<string, TutorialStageProofContextV1>>;
  readonly impact?: TestImpactAnalysisV1 | null;
  readonly strategy?: ProofStrategy;
}

export interface TutorialProofStageDecisionV1 {
  readonly stageId: string;
  readonly proofId: string;
  readonly level: TutorialProofStageV1["level"];
  readonly required: boolean;
  readonly liveAeRequired: boolean;
  readonly impactAffected: boolean;
  readonly action: TutorialProofStageActionV1;
  readonly reason: string;
  readonly contentKey: string | null;
  readonly proofNode: IncrementalProofNodeV1 | null;
}

export interface TutorialProofSelectionV1 {
  readonly schema: "editflow.tutorial-proof-selection.v1";
  readonly skillId: string;
  readonly strategy: ProofStrategy;
  readonly broadValidationRequired: boolean;
  readonly decisions: readonly TutorialProofStageDecisionV1[];
  readonly plannedRunStageIds: readonly string[];
  readonly reusableStageIds: readonly string[];
  readonly blockedStageIds: readonly string[];
  readonly nextStageId: string | null;
  readonly completeFromCache: boolean;
  readonly evidenceStopSatisfied: boolean;
}

export const tutorialProofIdForStageV1 = (
  plan: TutorialProofPlanV1,
  stage: TutorialProofStageV1,
): string => "proof:tutorial:" + plan.skillId + ":" + stage.level;

const contextProblem = (context: TutorialStageProofContextV1): string | null => {
  if (context.environmentFingerprint.trim().length === 0) {
    return "Stage proof environmentFingerprint must not be empty.";
  }
  const seen = new Set<string>();
  for (const dependency of context.dependencies) {
    if (dependency.id.trim().length === 0 || dependency.sha256.trim().length === 0) {
      return "Stage proof dependencies must have non-empty id and sha256 fields.";
    }
    if (seen.has(dependency.id)) {
      return "Stage proof dependency '" + dependency.id + "' is duplicated.";
    }
    seen.add(dependency.id);
  }
  return null;
};
const nodeForStage = (
  proofId: string,
  stage: TutorialProofStageV1,
  context: TutorialStageProofContextV1,
  strategy: ProofStrategy,
): IncrementalProofNodeV1 => ({
  proofId,
  nodeId: stage.stageId,
  strategy,
  environmentFingerprint: context.environmentFingerprint,
  checkpointKey: context.checkpointKey ?? null,
  dependencies: structuredClone(context.dependencies),
  allowEvidenceReuse: context.allowEvidenceReuse ?? true,
});

const decisionBase = (
  stage: TutorialProofStageV1,
  proofId: string,
  impactAffected: boolean,
) => ({
  stageId: stage.stageId,
  proofId,
  level: stage.level,
  required: stage.required,
  liveAeRequired: stage.liveAeRequired,
  impactAffected,
});

const runAction = (strategy: ProofStrategy): "RUN_STAGE" | "RUN_FULL" =>
  strategy === "FULL_ACCEPTANCE" ? "RUN_FULL" : "RUN_STAGE";

export const selectTutorialProofStagesV1 = (
  input: TutorialProofSelectionInputV1,
): TutorialProofSelectionV1 => {
  const { plan } = input;
  const strategy = input.strategy ?? "INCREMENTAL_FIRST";
  const impact = input.impact ?? null;
  const broadValidationRequired = impact?.requiresBroadValidation ?? false;
  const affectedProofIds = new Set(impact?.affectedProofIds ?? []);
  const blockedByCapability = plan.blockedByCapabilities.length > 0;
  const decisions: TutorialProofStageDecisionV1[] = [];

  for (const stage of [...plan.stages].sort((a, b) => a.level - b.level)) {
    const proofId = tutorialProofIdForStageV1(plan, stage);
    const impactAffected = affectedProofIds.has(proofId);
    const base = decisionBase(stage, proofId, impactAffected);

    if (!stage.required) {
      decisions.push({
        ...base,
        action: "SKIP_NOT_REQUIRED",
        reason: "The compiled proof plan does not require this stage for the target maturity.",
        contentKey: null,
        proofNode: null,
      });
      continue;
    }

    if (blockedByCapability && stage.liveAeRequired) {
      decisions.push({
        ...base,
        action: "BLOCKED",
        reason: "Live proof is blocked by missing capabilities: "
          + plan.blockedByCapabilities.join(", ") + ".",
        contentKey: null,
        proofNode: null,
      });
      continue;
    }
    const context = input.stageContexts?.[stage.stageId];
    if (context === undefined) {
      decisions.push({
        ...base,
        action: runAction(strategy),
        reason: "No reusable proof identity context exists for this stage yet; run it once and declare dependencies before caching.",
        contentKey: null,
        proofNode: null,
      });
      continue;
    }

    const invalidContext = contextProblem(context);
    if (invalidContext !== null) {
      decisions.push({
        ...base,
        action: "BLOCKED",
        reason: invalidContext,
        contentKey: null,
        proofNode: null,
      });
      continue;
    }

    const proofNode = nodeForStage(proofId, stage, context, strategy);
    const cacheDecision = decideIncrementalProof(proofNode, context.token ?? null);

    if (broadValidationRequired) {
      decisions.push({
        ...base,
        action: runAction(strategy),
        reason: "Unmapped changed nodes require broad validation: "
          + (impact?.unmappedChangedIds.join(", ") ?? "unknown change") + ".",
        contentKey: cacheDecision.contentKey,
        proofNode,
      });
      continue;
    }
    if (impactAffected && cacheDecision.action === "REUSE_PASS") {
      decisions.push({
        ...base,
        action: runAction(strategy),
        reason: "The impact graph marks this stage as affected even though its declared cache dependencies still match; rerun to fail closed on dependency-map drift.",
        contentKey: cacheDecision.contentKey,
        proofNode,
      });
      continue;
    }

    decisions.push({
      ...base,
      action: cacheDecision.action === "REUSE_PASS"
        ? "REUSE_PASS"
        : cacheDecision.action === "RUN_FULL"
          ? "RUN_FULL"
          : "RUN_STAGE",
      reason: cacheDecision.reason,
      contentKey: cacheDecision.contentKey,
      proofNode,
    });
  }

  const plannedRunStageIds = decisions
    .filter((decision) => decision.action === "RUN_STAGE" || decision.action === "RUN_FULL")
    .map((decision) => decision.stageId);
  const reusableStageIds = decisions
    .filter((decision) => decision.action === "REUSE_PASS")
    .map((decision) => decision.stageId);
  const blockedStageIds = decisions
    .filter((decision) => decision.action === "BLOCKED")
    .map((decision) => decision.stageId);
  const requiredDecisions = decisions.filter((decision) => decision.required);
  const completeFromCache = requiredDecisions.length > 0
    && requiredDecisions.every((decision) => decision.action === "REUSE_PASS");
  const evidenceStopSatisfied = requiredDecisions.length > 0
    && requiredDecisions.every((decision) => decision.action === "REUSE_PASS");

  return {
    schema: "editflow.tutorial-proof-selection.v1",
    skillId: plan.skillId,
    strategy,
    broadValidationRequired,
    decisions,
    plannedRunStageIds,
    reusableStageIds,
    blockedStageIds,
    nextStageId: plannedRunStageIds[0] ?? null,
    completeFromCache,
    evidenceStopSatisfied,
  };
};
