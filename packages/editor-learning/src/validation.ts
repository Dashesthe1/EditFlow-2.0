import type { EditingSkill, TutorialExtraction } from "./index.js";
import type { ReferenceAnalysis } from "./reference-learning.js";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ExtractionValidationReport {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

const issue = (issues: ValidationIssue[], path: string, message: string): void => {
  issues.push({ path, message });
};

const validateConfidence = (issues: ValidationIssue[], path: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) issue(issues, path, "confidence must be between 0 and 1");
};

const validateSkill = (issues: ValidationIssue[], skill: EditingSkill, path: string, expectedSourceId: string): void => {
  if (skill.id.trim().length === 0) issue(issues, `${path}.id`, "skill id is required");
  if (!skill.sourceIds.includes(expectedSourceId)) issue(issues, `${path}.sourceIds`, `must cite source '${expectedSourceId}'`);
  validateConfidence(issues, `${path}.confidence`, skill.confidence);
  if (skill.mastery !== "OBSERVED") {
    issue(issues, `${path}.mastery`, "tutorial extraction must begin at OBSERVED; execution evidence is required for promotion");
  }
  for (let index = 0; index < skill.parameterGuidance.length; index += 1) {
    const guidance = skill.parameterGuidance[index];
    if (guidance === undefined) continue;
    if (guidance.minimum !== null && guidance.maximum !== null && guidance.minimum > guidance.maximum) {
      issue(issues, `${path}.parameterGuidance[${index}]`, "minimum cannot exceed maximum");
    }
  }
};

export const validateTutorialExtraction = (extraction: TutorialExtraction): ExtractionValidationReport => {
  const issues: ValidationIssue[] = [];
  const source = extraction.source;
  if (source.sourceId.trim().length === 0) issue(issues, "source.sourceId", "source id is required");
  if (source.title.trim().length === 0) issue(issues, "source.title", "title is required");
  if (source.sourceRef.trim().length === 0) issue(issues, "source.sourceRef", "source reference is required");
  if (source.durationSeconds !== null && (!Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0)) {
    issue(issues, "source.durationSeconds", "duration must be positive when known");
  }

  const skillIds = new Set<string>();
  extraction.skills.forEach((skill, index) => {
    if (skillIds.has(skill.id)) issue(issues, `skills[${index}].id`, `duplicate skill id '${skill.id}'`);
    skillIds.add(skill.id);
    validateSkill(issues, skill, `skills[${index}]`, source.sourceId);
  });

  const demonstrationIds = new Set<string>();
  const actionIds = new Set<string>();
  extraction.demonstrations.forEach((demonstration, index) => {
    const path = `demonstrations[${index}]`;
    if (demonstrationIds.has(demonstration.demonstrationId)) issue(issues, `${path}.demonstrationId`, "duplicate demonstration id");
    demonstrationIds.add(demonstration.demonstrationId);
    if (demonstration.sourceId !== source.sourceId) issue(issues, `${path}.sourceId`, "demonstration must cite extraction source");
    for (const skillId of demonstration.candidateSkillIds) {
      if (!skillIds.has(skillId)) issue(issues, `${path}.candidateSkillIds`, `unknown candidate skill '${skillId}'`);
    }
    demonstration.actions.forEach((action, actionIndex) => {
      const actionPath = `${path}.actions[${actionIndex}]`;
      if (actionIds.has(action.id)) issue(issues, `${actionPath}.id`, `duplicate action id '${action.id}'`);
      actionIds.add(action.id);
      if (action.timeSeconds !== null) {
        if (!Number.isFinite(action.timeSeconds) || action.timeSeconds < 0) issue(issues, `${actionPath}.timeSeconds`, "timestamp must be non-negative");
        if (source.durationSeconds !== null && action.timeSeconds > source.durationSeconds) {
          issue(issues, `${actionPath}.timeSeconds`, "timestamp exceeds source duration");
        }
      }
    });
  });

  extraction.edges.forEach((edge, index) => {
    if (!skillIds.has(edge.fromSkillId)) issue(issues, `edges[${index}].fromSkillId`, `unknown skill '${edge.fromSkillId}'`);
    if (!skillIds.has(edge.toSkillId)) issue(issues, `edges[${index}].toSkillId`, `unknown skill '${edge.toSkillId}'`);
    if (edge.fromSkillId === edge.toSkillId) issue(issues, `edges[${index}]`, "skill edge cannot point to itself");
  });

  return { valid: issues.length === 0, issues };
};

export const validateReferenceAnalysis = (analysis: ReferenceAnalysis): ExtractionValidationReport => {
  const issues: ValidationIssue[] = [];
  const source = analysis.source;
  if (source.sourceId.trim().length === 0) issue(issues, "source.sourceId", "source id is required");
  if (source.title.trim().length === 0) issue(issues, "source.title", "title is required");
  if (source.sourceRef.trim().length === 0) issue(issues, "source.sourceRef", "source reference is required");
  if (source.durationSeconds !== null && (!Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0)) {
    issue(issues, "source.durationSeconds", "duration must be positive when known");
  }

  const principleIds = new Set<string>();
  analysis.principles.forEach((principle, index) => {
    const path = `principles[${index}]`;
    if (principleIds.has(principle.id)) issue(issues, `${path}.id`, `duplicate principle id '${principle.id}'`);
    principleIds.add(principle.id);
    if (!principle.sourceIds.includes(source.sourceId)) issue(issues, `${path}.sourceIds`, `must cite source '${source.sourceId}'`);
    if (principle.origin !== "PROFESSIONAL_REFERENCE") issue(issues, `${path}.origin`, "reference extraction principles must originate as PROFESSIONAL_REFERENCE");
    validateConfidence(issues, `${path}.confidence`, principle.confidence);
  });

  analysis.structure.forEach((phase, index) => {
    const path = `structure[${index}]`;
    if (!Number.isFinite(phase.startSeconds) || !Number.isFinite(phase.endSeconds) || phase.startSeconds < 0) {
      issue(issues, path, "phase timestamps must be finite and non-negative");
    }
    if (phase.endSeconds <= phase.startSeconds) issue(issues, path, "phase end must be after phase start");
    if (source.durationSeconds !== null && phase.endSeconds > source.durationSeconds + 0.001) {
      issue(issues, `${path}.endSeconds`, "phase exceeds source duration");
    }
  });

  analysis.moments.forEach((moment, index) => {
    const path = `moments[${index}]`;
    if (!Number.isFinite(moment.timeSeconds) || moment.timeSeconds < 0) issue(issues, `${path}.timeSeconds`, "moment timestamp must be non-negative");
    if (source.durationSeconds !== null && moment.timeSeconds > source.durationSeconds) issue(issues, `${path}.timeSeconds`, "moment exceeds source duration");
    for (const principleId of moment.principleIds) {
      if (!principleIds.has(principleId)) issue(issues, `${path}.principleIds`, `unknown principle '${principleId}'`);
    }
  });

  return { valid: issues.length === 0, issues };
};

export const assertValidTutorialExtraction = (extraction: TutorialExtraction): void => {
  const report = validateTutorialExtraction(extraction);
  if (!report.valid) throw new Error(`Invalid tutorial extraction:\n${report.issues.map((item) => `${item.path}: ${item.message}`).join("\n")}`);
};

export const assertValidReferenceAnalysis = (analysis: ReferenceAnalysis): void => {
  const report = validateReferenceAnalysis(analysis);
  if (!report.valid) throw new Error(`Invalid reference analysis:\n${report.issues.map((item) => `${item.path}: ${item.message}`).join("\n")}`);
};
