import { PROOF_MATURITY, type CapabilityId, type ProofMaturity } from "../../core-contracts/src/index.js";
import type { CapabilityRegistry } from "../../capability-registry/src/index.js";
import type {
  TutorialCapabilityDiscoveryReportV0,
  TutorialCapabilityFindingV0,
  TutorialCapabilityRequirementV0,
  TutorialCapabilityState,
  TutorialCapabilityUseV0,
  TutorialDevelopmentTaskKind,
  TutorialDevelopmentTaskV0,
  TutorialLessonV0,
} from "./contracts.js";

const maturityRank = (value: ProofMaturity): number => PROOF_MATURITY.indexOf(value);

interface RequirementBucket {
  readonly capabilityId: CapabilityId;
  readonly requirements: TutorialCapabilityRequirementV0[];
  readonly uses: TutorialCapabilityUseV0[];
}

const strongestMaturity = (requirements: readonly TutorialCapabilityRequirementV0[]): ProofMaturity =>
  requirements.reduce((best, candidate) =>
    maturityRank(candidate.minimumProofMaturity) > maturityRank(best) ? candidate.minimumProofMaturity : best,
  requirements[0]?.minimumProofMaturity ?? "DECLARED");
const collectRequirements = (lesson: TutorialLessonV0): readonly RequirementBucket[] => {
  const buckets = new Map<string, RequirementBucket>();
  for (const skill of lesson.skills) {
    for (const step of skill.steps) {
      for (const requirement of step.capabilityRequirements) {
        const key = String(requirement.capabilityId);
        const current = buckets.get(key) ?? {
          capabilityId: requirement.capabilityId,
          requirements: [],
          uses: [],
        };
        current.requirements.push(requirement);
        current.uses.push({
          skillId: skill.skillId,
          stepId: step.stepId,
          reason: requirement.reason,
          optional: requirement.optional === true,
        });
        buckets.set(key, current);
      }
    }
  }
  return [...buckets.values()].sort((a, b) => String(a.capabilityId).localeCompare(String(b.capabilityId)));
};

const classify = (
  registry: CapabilityRegistry,
  bucket: RequirementBucket,
): TutorialCapabilityFindingV0 => {
  const requiredProofMaturity = strongestMaturity(bucket.requirements);
  const record = registry.get(bucket.capabilityId);
  const preferredKinds = [...new Set(bucket.requirements.flatMap((item) => item.preferredRouteKinds ?? []))];
  if (record === null) {
    return {
      capabilityId: bucket.capabilityId,
      state: "UNREGISTERED",
      requiredProofMaturity,
      actualProofMaturity: null,
      registryStatus: null,
      bestRouteId: null,
      availableRouteKinds: [],
      uses: structuredClone(bucket.uses),
      limitations: [],
    };
  }
  const availableRoutes = record.routes.filter((route) => route.available);
  const preferredRoutes = preferredKinds.length === 0
    ? availableRoutes
    : availableRoutes.filter((route) => preferredKinds.includes(route.kind));
  const bestRoute = preferredRoutes[0] ?? availableRoutes[0] ?? null;
  let state: TutorialCapabilityState = "READY";
  if (record.status === "UNAVAILABLE") state = "UNAVAILABLE";
  else if (availableRoutes.length === 0 || record.status === "ADAPTER_REQUIRED") state = "ADAPTER_REQUIRED";
  else if (maturityRank(record.proofMaturity) < maturityRank(requiredProofMaturity)) state = "PROOF_REQUIRED";
  else if (record.status !== "FULL" || (preferredKinds.length > 0 && preferredRoutes.length === 0)) state = "PARTIAL";

  const limitations = [
    ...(record.limitations ?? []),
    ...availableRoutes.flatMap((route) => route.limitations ?? []),
  ];
  if (preferredKinds.length > 0 && preferredRoutes.length === 0 && availableRoutes.length > 0) {
    limitations.push(`Preferred route kind unavailable: ${preferredKinds.join(", ")}`);
  }
  return {
    capabilityId: bucket.capabilityId,
    state,
    requiredProofMaturity,
    actualProofMaturity: record.proofMaturity,
    registryStatus: record.status,
    bestRouteId: bestRoute?.routeId ?? null,
    availableRouteKinds: [...new Set(availableRoutes.map((route) => route.kind))],
    uses: structuredClone(bucket.uses),
    limitations: [...new Set(limitations)],
  };
};

const taskKindFor = (state: TutorialCapabilityState): TutorialDevelopmentTaskKind | null => {
  if (state === "UNREGISTERED") return "REGISTER_CAPABILITY";
  if (state === "ADAPTER_REQUIRED") return "ADD_RUNTIME_ROUTE";
  if (state === "PROOF_REQUIRED") return "RAISE_PROOF_MATURITY";
  if (state === "PARTIAL") return "IMPROVE_PARTIAL_SUPPORT";
  if (state === "UNAVAILABLE") return "UNBLOCK_CAPABILITY";
  return null;
};

const severity = (state: TutorialCapabilityState): number => {
  if (state === "UNREGISTERED" || state === "UNAVAILABLE") return 5;
  if (state === "ADAPTER_REQUIRED") return 4;
  if (state === "PROOF_REQUIRED") return 3;
  if (state === "PARTIAL") return 2;
  return 0;
};

const makeTask = (finding: TutorialCapabilityFindingV0): TutorialDevelopmentTaskV0 | null => {
  const kind = taskKindFor(finding.state);
  if (kind === null) return null;
  const blocking = finding.uses.some((use) => !use.optional);
  const requiredByCount = new Set(finding.uses.map((use) => `${use.skillId}:${use.stepId}`)).size;
  return {
    kind,
    capabilityId: finding.capabilityId,
    blocking,
    requiredByCount,
    rationale: `${finding.state}: ${String(finding.capabilityId)} is required by ${requiredByCount} tutorial step(s).`,
  };
};

export const discoverTutorialCapabilitiesV0 = (
  lesson: TutorialLessonV0,
  registry: CapabilityRegistry,
  generatedAt = new Date().toISOString(),
): TutorialCapabilityDiscoveryReportV0 => {
  const findings = collectRequirements(lesson).map((bucket) => classify(registry, bucket));
  const developmentQueue = findings.map(makeTask).filter((task): task is TutorialDevelopmentTaskV0 => task !== null)
    .sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      const aFinding = findings.find((item) => item.capabilityId === a.capabilityId);
      const bFinding = findings.find((item) => item.capabilityId === b.capabilityId);
      const severityDelta = severity(bFinding?.state ?? "READY") - severity(aFinding?.state ?? "READY");
      if (severityDelta !== 0) return severityDelta;
      if (a.requiredByCount !== b.requiredByCount) return b.requiredByCount - a.requiredByCount;
      return String(a.capabilityId).localeCompare(String(b.capabilityId));
    });
  const blocked = findings.filter((finding) =>
    finding.state !== "READY" && finding.uses.some((use) => !use.optional)).length;
  const optionalGaps = findings.filter((finding) =>
    finding.state !== "READY" && finding.uses.every((use) => use.optional)).length;
  return {
    tutorialId: lesson.tutorialId,
    generatedAt,
    summary: {
      total: findings.length,
      ready: findings.filter((finding) => finding.state === "READY").length,
      blocked,
      optionalGaps,
    },
    findings,
    developmentQueue,
  };
};
