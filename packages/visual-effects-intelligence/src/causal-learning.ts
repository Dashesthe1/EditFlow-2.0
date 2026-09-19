import type {
  ActionPixelCausalRuleV1,
  DenseEvidenceSummaryV1,
  DimensionDeltaV1,
  TutorialActionObservationV1,
  VisualDimensionV1,
} from "./contracts.js";

interface MetricBindingV1 {
  readonly metric: keyof DenseEvidenceSummaryV1;
  readonly dimension: VisualDimensionV1;
  readonly materialThreshold: number;
}

const bindings: readonly MetricBindingV1[] = [
  { metric: "temporalStateCountPeak", dimension: "TEMPORAL", materialThreshold: 1 },
  { metric: "temporalPersistence", dimension: "TEMPORAL", materialThreshold: 0.08 },
  { metric: "motionEnergyPeak", dimension: "MOTION_STRUCTURE", materialThreshold: 0.06 },
  { metric: "displacementPeak", dimension: "SPATIAL", materialThreshold: 0.04 },
  { metric: "scaleRange", dimension: "SPATIAL", materialThreshold: 0.04 },
  { metric: "rotationRange", dimension: "SPATIAL", materialThreshold: 3 },
  { metric: "blurPeak", dimension: "OPTICAL", materialThreshold: 0.08 },
  { metric: "distortionPeak", dimension: "DISTORTION", materialThreshold: 0.08 },
  { metric: "exposurePeak", dimension: "OPTICAL", materialThreshold: 0.08 },
  { metric: "subjectSeparationPeak", dimension: "ISOLATION", materialThreshold: 0.08 },
  { metric: "overlapDensityPeak", dimension: "COMPOSITING", materialThreshold: 0.08 },
  { metric: "occlusionPeak", dimension: "COMPOSITING", materialThreshold: 0.08 },
  { metric: "accelerationPeak", dimension: "MOTION_STRUCTURE", materialThreshold: 0.04 },
  { metric: "recoveryFrames", dimension: "MOTION_STRUCTURE", materialThreshold: 1 },
];

const numeric = (summary: DenseEvidenceSummaryV1, key: keyof DenseEvidenceSummaryV1): number => {
  const value = summary[key];
  return typeof value === "number" ? value : 0;
};

export const learnActionPixelCausalRuleV1 = (
  observation: TutorialActionObservationV1,
): ActionPixelCausalRuleV1 => {
  if (observation.actionId.trim().length === 0 || observation.tutorialId.trim().length === 0
    || observation.action.trim().length === 0 || observation.aeChange.trim().length === 0
    || observation.editorialPurpose.trim().length === 0) {
    throw new TypeError("Action -> pixel learning requires named action, AE change, and editorial purpose.");
  }
  const pixelConsequences: DimensionDeltaV1[] = bindings.map((binding) => {
    const before = numeric(observation.before.summary, binding.metric);
    const after = numeric(observation.after.summary, binding.metric);
    const delta = after - before;
    return {
      dimension: binding.dimension,
      metric: binding.metric,
      before,
      after,
      delta,
      material: Math.abs(delta) >= binding.materialThreshold,
    };
  }).filter((delta) => delta.material);
  const visible = pixelConsequences
    .map((delta) => `${delta.metric} ${delta.delta >= 0 ? "increases" : "decreases"}`)
    .join(", ");
  const adaptation = observation.adaptationInputs.length > 0
    ? observation.adaptationInputs.join(", ")
    : "reference evidence";
  return {
    schema: "editflow.action-pixel-causal-rule.v1",
    actionId: observation.actionId,
    tutorialId: observation.tutorialId,
    action: observation.action,
    aeChange: observation.aeChange,
    pixelConsequences,
    editorialPurpose: observation.editorialPurpose,
    omissionConsequence: pixelConsequences.length === 0
      ? "The supplied before/after evidence does not establish a material visible consequence; do not promote this action."
      : `Omitting the action removes or weakens: ${visible}.`,
    transferableRule: `Derive the action from ${adaptation}; literal tutorial values are provenance only, not production defaults.`,
    adaptationInputs: [...new Set(observation.adaptationInputs)],
    literalValues: structuredClone(observation.literalValues ?? {}),
    evidenceRefs: [...new Set([
      ...observation.evidenceRefs,
      ...observation.before.evidenceRefs,
      ...observation.after.evidenceRefs,
    ])],
    traceable: pixelConsequences.length > 0 && observation.evidenceRefs.length > 0,
  };
};

export interface TutorialCausalLearningResultV1 {
  readonly schema: "editflow.tutorial-causal-learning.v1";
  readonly tutorialId: string;
  readonly rules: readonly ActionPixelCausalRuleV1[];
  readonly unprovenMajorActionIds: readonly string[];
  readonly complete: boolean;
}

export const learnTutorialActionPixelConsequencesV1 = (
  observations: readonly TutorialActionObservationV1[],
): TutorialCausalLearningResultV1 => {
  if (observations.length === 0) throw new TypeError("Tutorial causal learning requires observations.");
  const tutorialIds = new Set(observations.map((observation) => observation.tutorialId));
  if (tutorialIds.size !== 1) throw new TypeError("One causal learning result cannot mix tutorials.");
  const actionIds = observations.map((observation) => observation.actionId);
  if (new Set(actionIds).size !== actionIds.length) throw new TypeError("Tutorial action IDs must be unique.");
  const rules = observations.map(learnActionPixelCausalRuleV1);
  const unprovenMajorActionIds = observations
    .filter((observation, index) => observation.major && rules[index]?.traceable !== true)
    .map((observation) => observation.actionId);
  return {
    schema: "editflow.tutorial-causal-learning.v1",
    tutorialId: observations[0]?.tutorialId ?? "",
    rules,
    unprovenMajorActionIds,
    complete: unprovenMajorActionIds.length === 0,
  };
};
