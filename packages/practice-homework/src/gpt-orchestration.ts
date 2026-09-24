import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  EditTypeKnowledgeSnapshotV1,
  GptAssignmentCompletionV1,
  GptAssignmentStatusV1,
  GptCapabilityGapV1,
  GptLearnedSkillV1,
  GptLearningEventV1,
  GptLearningOutcomeV1,
  GptLearningStageV1,
  GptOrchestrationAssignmentV1,
  GptOrchestrationModeV1,
  GptResearchSourceV1,
  PracticeMediaInputV1,
  PracticeRunRoleV1,
  PracticeVerificationPolicyV1,
} from "./contracts.js";
import { applyCompiledTutorialCausalModelV1 } from "./tutorial-causal-compiler.js";

interface GptOrchestrationStorePayloadV1 {
  readonly schema: "editflow.gpt-orchestration-store.v1";
  readonly assignments: readonly GptOrchestrationAssignmentV1[];
  readonly events: readonly GptLearningEventV1[];
}

const EMPTY_STORE: GptOrchestrationStorePayloadV1 = {
  schema: "editflow.gpt-orchestration-store.v1",
  assignments: [],
  events: [],
};

export const DEFAULT_PRACTICE_VERIFICATION_POLICY_V1: PracticeVerificationPolicyV1 = {
  minimumSimilarity: 0.95,
  exactSceneConfidence: 0.95,
  minimumAudioConfidence: 0.90,
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const normalizePracticeVerificationPolicyV1 = (
  value?: Partial<PracticeVerificationPolicyV1> | null,
): PracticeVerificationPolicyV1 => ({
  minimumSimilarity: Math.max(
    DEFAULT_PRACTICE_VERIFICATION_POLICY_V1.minimumSimilarity,
    clamp01(value?.minimumSimilarity
      ?? DEFAULT_PRACTICE_VERIFICATION_POLICY_V1.minimumSimilarity),
  ),
  exactSceneConfidence: Math.max(
    DEFAULT_PRACTICE_VERIFICATION_POLICY_V1.exactSceneConfidence,
    clamp01(value?.exactSceneConfidence
      ?? DEFAULT_PRACTICE_VERIFICATION_POLICY_V1.exactSceneConfidence),
  ),
  minimumAudioConfidence: Math.max(
    DEFAULT_PRACTICE_VERIFICATION_POLICY_V1.minimumAudioConfidence,
    clamp01(value?.minimumAudioConfidence
      ?? DEFAULT_PRACTICE_VERIFICATION_POLICY_V1.minimumAudioConfidence),
  ),
});

const readStore = async (filePath: string): Promise<GptOrchestrationStorePayloadV1> => {
  try {
    const parsed = JSON.parse(
      await readFile(filePath, "utf8"),
    ) as Partial<GptOrchestrationStorePayloadV1>;
    if (parsed.schema !== "editflow.gpt-orchestration-store.v1"
      || !Array.isArray(parsed.assignments)
      || !Array.isArray(parsed.events)) {
      throw new TypeError("GPT orchestration store has an unsupported schema.");
    }
    const payload = parsed as GptOrchestrationStorePayloadV1;
    return {
      ...payload,
      assignments: payload.assignments.map((assignment) => {
        const practicePolicy = assignment.mode === "PRACTICE"
          ? normalizePracticeVerificationPolicyV1(assignment.practicePolicy)
          : null;
        const practiceRole: PracticeRunRoleV1 | null = assignment.mode === "PRACTICE"
          ? assignment.practiceRole === "HELD_OUT_CERTIFICATION"
            ? "HELD_OUT_CERTIFICATION"
            : "LEARNING"
          : null;
        const researchMessage = applyCurrentResearchPriority(assignment.chatMessage);
        return {
          ...assignment,
          practiceRole,
          practicePolicy,
          chatMessage: practicePolicy === null
            ? researchMessage
            : applyCurrentMasteryPolicy(researchMessage, practicePolicy),
        };
      }),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(EMPTY_STORE);
    }
    throw error;
  }
};

const nonEmpty = (value: string, name: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new TypeError(name + " must not be empty.");
  return trimmed;
};

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const sameCapabilityGapIdentity = (
  left: GptCapabilityGapV1 | undefined,
  right: GptCapabilityGapV1 | undefined,
): boolean => {
  if (left === undefined || right === undefined) return false;
  return left.gapId.trim() === right.gapId.trim()
    && left.kind === right.kind
    && left.requestedBehavior.trim() === right.requestedBehavior.trim()
    && JSON.stringify([...unique(left.missingCapabilityIds)].sort())
      === JSON.stringify([...unique(right.missingCapabilityIds)].sort());
};

const hasCompleteCausalModel = (
  model: GptLearnedSkillV1["causalModel"],
): boolean => model !== undefined && [
  model.triggerConditions,
  model.invariants,
  model.adaptationAxes,
  model.failureSignals,
  model.repairStrategies,
  model.transferCriteria,
].every((values) => unique(values ?? []).length > 0);

const hasCausalTransferModel = (skill: GptLearnedSkillV1): boolean =>
  hasCompleteCausalModel(skill.causalModel);

const hasCompleteMachineUseSignature = (skill: GptLearnedSkillV1): boolean => {
  const invariants = unique(skill.causalModel?.invariants ?? []);
  const signature = skill.machineUseSignature;
  if (invariants.length === 0
    || signature?.schema !== "editflow.gpt-skill-machine-use-signature.v1"
    || signature.invariantRules.length === 0) {
    return false;
  }
  const invariantSet = new Set(invariants);
  if (signature.invariantRules.some((rule) =>
    !invariantSet.has(rule.invariant.trim())
    || rule.evidence.length === 0
    || rule.evidence.some((predicate) => predicate.value.trim().length === 0))) {
    return false;
  }
  const coversEveryInvariant = invariants.every((invariant) =>
    signature.invariantRules.some((rule) =>
      rule.invariant.trim() === invariant && rule.evidence.length > 0));
  const bindsConstructionEvidence = signature.invariantRules.some((rule) =>
    rule.evidence.some((predicate) => predicate.source === "CONSTRUCTION_ID"));
  return coversEveryInvariant && bindsConstructionEvidence;
};

export const EDITFLOW_TUTORIAL_DRIVE_ROOT_V1 =
  "https://drive.google.com/drive/folders/1eP2O7OwoCL1uP3OaA4euewUAZFU-VsL7";
export const EDITFLOW_EFFECT_TUTORIALS_FOLDER_V1 =
  "https://drive.google.com/drive/folders/183rOt8jpMghRA3Gtu-ZKxZ2NSkJF5S-G";
export const EDITFLOW_MUSIC_BEAT_TUTORIALS_FOLDER_V1 =
  "https://drive.google.com/drive/folders/19RI8JpZQvmD7R5_4Ub1E_JBodcx7MtGZ";

const LEGACY_RESEARCH_POLICY_LINES = [
  "- When existing EditFlow knowledge is insufficient or the reference behavior is not understood, online research is required before accepting a fallback: inspect the live Capability Registry and installed Adobe features/plugins, then use Adobe documentation, professional tutorials, and broader web sources as needed.",
  "- For a missing skill/capability, research the live Capability Registry, installed Adobe features/plugins, Adobe documentation, professional tutorials, and the web when useful.",
] as const;

const RESEARCH_PRIORITY_LINES = [
  "- Tutorial Drive is the mandatory first research source whenever EditFlow does not know how to reproduce a visible reference behavior, is stuck on a construction, or discovers a missing fundamental skill.",
  "- Search the Tutorial Drive for the closest matching behavior or technique before consulting any external source. Primary folders: Adobe Effect Tutorials (" + EDITFLOW_EFFECT_TUTORIALS_FOLDER_V1 + ") and Adobe Effect Music + Beat Tutorials (" + EDITFLOW_MUSIC_BEAT_TUTORIALS_FOLDER_V1 + "). Root: " + EDITFLOW_TUTORIAL_DRIVE_ROOT_V1 + ".",
  "- Use the matching tutorial video or videos to retain a structured technique record: WHAT the visible behavior is, WHEN/WHY it is used, HOW it is constructed in After Effects, ACCESS requirements, the PROOF needed to verify it, and TRANSFER rules for adapting it to new footage. Do not copy literal tutorial values as the lesson.",
  "- Every matched Tutorial Drive tutorial file must be deep-analyzed and compiled through EditFlow's tutorial causal compiler before it can support Practice learning. The compiler-derived construction pattern, capabilities, triggers, invariants, adaptation axes, failure/repair logic, and transfer criteria are authoritative; do not hand-author substitutes for those fields.",
  "- Keep capability evidence causally bound: CAPABILITY_IMPLEMENTATION and CAPABILITY_PROOF must carry the same originating capability gap, and SKILL_COMMIT may use only compiler semantics targeting that skill plus proof evidence bound to that same gap.",
  "- If no sufficiently relevant Tutorial Drive match exists, record the Tutorial Drive search/query and no-match result in RESEARCH provenance before escalating.",
  "- Second priority is official Adobe documentation/resources and the installed Adobe feature/plugin surface.",
  "- Third priority is external professional tutorials and plugin/vendor documentation; broader web/internet research is last.",
] as const;

const applyCurrentResearchPriority = (message: string): string => {
  if (message.includes(RESEARCH_PRIORITY_LINES[4])) return message;
  if (message.includes(RESEARCH_PRIORITY_LINES[3])) {
    return message.replace(
      RESEARCH_PRIORITY_LINES[3],
      RESEARCH_PRIORITY_LINES[3] + "\n" + RESEARCH_PRIORITY_LINES[4],
    );
  }
  if (message.includes(RESEARCH_PRIORITY_LINES[2])) {
    return message.replace(
      RESEARCH_PRIORITY_LINES[2],
      RESEARCH_PRIORITY_LINES[2] + "\n" + RESEARCH_PRIORITY_LINES[3]
        + "\n" + RESEARCH_PRIORITY_LINES[4],
    );
  }
  for (const legacyLine of LEGACY_RESEARCH_POLICY_LINES) {
    if (message.includes(legacyLine)) {
      return message.replace(legacyLine, RESEARCH_PRIORITY_LINES.join("\n"));
    }
  }
  return message;
};

const MASTERY_POLICY_MARKER =
  "- GPT completion is not Practice mastery.";

const applyCurrentMasteryPolicy = (
  message: string,
  policy: PracticeVerificationPolicyV1,
): string => {
  if (message.includes(MASTERY_POLICY_MARKER)) return message;
  return [
    message,
    "",
    "Practice certification policy (current):",
    MASTERY_POLICY_MARKER
      + " EditFlow independently re-analyzes the actual final render before certification.",
    "- Certification requires exact source matching, 100% defining effect/transition behavior coverage, "
      + "and weighted/effect/transition fidelity >= " + policy.minimumSimilarity.toFixed(3) + ".",
    "- Exact-scene confidence must be >= " + policy.exactSceneConfidence.toFixed(3)
      + "; raw-audio confidence, when applicable, must be >= "
      + policy.minimumAudioConfidence.toFixed(3) + ".",
    "- A machine-passing first reconstruction is REFERENCE_VERIFIED; Pro Creation remains blocked "
      + "until materially different Finish and Start video content also passes as TRANSFER_VERIFIED.",
    "- HUMAN_REVIEW_REQUIRED is not mastery and must not be written into authoritative training memory.",
  ].join("\n");
};

const isTutorialDriveResearchSource = (source: GptResearchSourceV1 | undefined): boolean =>
  source?.kind === "TUTORIAL_DRIVE"
  && typeof source.uri === "string"
  && /^https:\/\/drive\.google\.com\/(?:file\/d\/|drive\/folders\/)/.test(source.uri.trim());

const hasStructuredTutorialTechnique = (source: GptResearchSourceV1 | undefined): boolean => {
  if (!isTutorialDriveResearchSource(source) || source?.tutorialTechnique === undefined) return false;
  const technique = source.tutorialTechnique;
  return [
    technique.what,
    technique.whenWhy,
    technique.how,
    technique.access,
    technique.proof,
    technique.transfer,
  ].every((value) => typeof value === "string" && value.trim().length > 0);
};

const hasValidTutorialCompilation = (source: GptResearchSourceV1 | undefined): boolean => {
  const compilation = source?.tutorialCompilation;
  if (compilation === undefined) return true;
  return isTutorialDriveResearchSource(source)
    && hasStructuredTutorialTechnique(source)
    && compilation.schema === "editflow.gpt-tutorial-causal-compilation.v1"
    && compilation.compilerVersion === 1
    && compilation.targetSkillId.trim().length > 0
    && compilation.tutorialId.trim().length > 0
    && compilation.tutorialSkillId.trim().length > 0
    && compilation.sourceRef.trim().length > 0
    && compilation.analysisFingerprint.trim().length > 0
    && compilation.constructionPattern.trim().length > 0
    && compilation.adaptationNotes.trim().length > 0
    && hasCompleteCausalModel(compilation.causalModel)
    && unique(compilation.evidenceRefs ?? []).length > 0;
};

const isTutorialDriveFolderSearch = (source: GptResearchSourceV1 | undefined): boolean =>
  isTutorialDriveResearchSource(source)
  && typeof source?.uri === "string"
  && /^https:\/\/drive\.google\.com\/drive\/folders\//.test(source.uri.trim());

const hasResearchLearningPath = (sources: readonly GptResearchSourceV1[]): boolean =>
  sources.some((source) =>
    source.tutorialCompilation !== undefined && hasValidTutorialCompilation(source))
  || (sources.some(isTutorialDriveFolderSearch)
    && sources.some((source) => source.kind !== "TUTORIAL_DRIVE" && source.kind !== "INTERNAL_EVIDENCE"));

const hasResearchLearningPathForSkill = (
  sources: readonly GptResearchSourceV1[],
  skillId: string,
): boolean =>
  sources.some((source) =>
    source.tutorialCompilation?.targetSkillId === skillId
    && hasValidTutorialCompilation(source))
  || (sources.some(isTutorialDriveFolderSearch)
    && sources.some((source) => source.kind !== "TUTORIAL_DRIVE" && source.kind !== "INTERNAL_EVIDENCE"));

const researchPriority = (source: GptResearchSourceV1): number | null => {
  switch (source.kind) {
    case "TUTORIAL_DRIVE": return 0;
    case "ADOBE_DOCUMENTATION":
    case "INSTALLED_ADOBE_FEATURE":
      return 1;
    case "PLUGIN_DOCUMENTATION":
    case "PROFESSIONAL_TUTORIAL":
      return 2;
    case "WEB": return 3;
    case "INTERNAL_EVIDENCE": return null;
  }
};

const researchSourcesFollowPriority = (
  sources: readonly GptResearchSourceV1[],
): boolean => {
  let highest = -1;
  for (const source of sources) {
    const priority = researchPriority(source);
    if (priority === null) continue;
    if (priority < highest) return false;
    highest = Math.max(highest, priority);
  }
  return true;
};

const mediaLine = (input: PracticeMediaInputV1): string =>
  "- " + input.mediaKind + " " + input.mediaId + ": " + input.uri;

export const buildGptOrchestrationChatMessageV1 = (input: {
  readonly sessionId: string;
  readonly mode: GptOrchestrationModeV1;
  readonly practiceRole: PracticeRunRoleV1 | null;
  readonly editTypeId: string;
  readonly finish: PracticeMediaInputV1 | null;
  readonly start: readonly PracticeMediaInputV1[];
  readonly practicePolicy: PracticeVerificationPolicyV1 | null;
  readonly artifactDir: string;
  readonly knowledge: EditTypeKnowledgeSnapshotV1 | null;
}): string => {
  const learned = input.knowledge;
  const successLessons = learned?.gptLearning.successLessons ?? [];
  const failureLessons = learned?.gptLearning.failureAvoidanceLessons ?? [];
  const patterns = learned?.gptLearning.developmentPatterns ?? [];
  const allLearnedSkills = learned?.gptLearning.learnedSkills ?? [];
  const learnedSkills = input.mode === "PRO_CREATION"
    ? allLearnedSkills.filter((skill) => skill.maturity === "TRANSFER_VERIFIED")
    : allLearnedSkills;
  const openGaps = (learned?.gptLearning.capabilityGaps ?? [])
    .filter((gap) => gap.status !== "RESOLVED");
  const skillLines = learnedSkills.slice(-12).map((skill) => {
    const causal = skill.causalModel;
    const causalSummary = causal === undefined
      ? " causal-model=UNRECORDED"
      : " triggers={" + causal.triggerConditions.join("; ") + "}"
        + " invariants={" + causal.invariants.join("; ") + "}"
        + " adapt={" + causal.adaptationAxes.join("; ") + "}"
        + " transfer={" + causal.transferCriteria.join("; ") + "}";
    const machineSignature = skill.machineUseSignature;
    const machineSummary = machineSignature === undefined
      ? " machine-use-signature=UNRECORDED"
      : " machine-use-signature={"
        + machineSignature.invariantRules.map((rule) =>
          rule.invariant + "=>"
            + rule.evidence.map((predicate) =>
              predicate.source + ":" + predicate.match + ":" + predicate.value
            ).join("&")
        ).join(" | ")
        + "}";
    return skill.skillId + " [" + skill.maturity + "] " + skill.title + ": "
      + skill.constructionPattern + causalSummary + machineSummary;
  });
  const gapLines = openGaps.slice(-12).map((gap) =>
    gap.gapId + " [" + gap.kind + "/" + gap.status + "] " + gap.requestedBehavior
  );
  const practicePolicy = input.mode === "PRACTICE"
    ? normalizePracticeVerificationPolicyV1(input.practicePolicy)
    : null;
  const modeInstruction = input.mode === "PRACTICE"
    ? input.practiceRole === "HELD_OUT_CERTIFICATION"
      ? [
        "This is held-out Practice certification. The Finish video is an unseen answer key.",
        "Use only the frozen TRANSFER_VERIFIED Edit Type snapshot supplied with this assignment.",
        "Study the Finish, find the matching raw material, and reconstruct it from scratch in After Effects.",
        "Continue render -> compare -> diagnose -> correct cycles until the reference is replicated to the accepted proof gate.",
        "Do not teach, research, implement new capabilities, commit skills, or retain lessons during this run. If frozen knowledge/capabilities are insufficient, record the failure and let the held-out case fail closed.",
        "Assignment events are audit trace only and must not mutate Edit Type learning memory.",
      ]
      : [
        "This is supervised Practice learning. The Finish video is the answer key.",
        "Study the Finish, find the matching raw material, and reconstruct it from scratch in After Effects.",
        "Continue render -> compare -> diagnose -> correct cycles until the reference is replicated to the accepted proof gate.",
        "Record the full learning trajectory, including failed hypotheses and why they failed, under the selected Edit Type.",
      ]
    : [
      "This is Pro Creation. There is no Finish answer key.",
      "Create a new professional edit from the Start media by applying the selected Edit Type's successful Practice development patterns.",
      "Treat only TRANSFER_VERIFIED learned skills as authoritative Pro Creation skill memory; AE_PROVEN single-reference skills remain Practice-only until separately transferred.",
      "Use successful lessons as guidance and actively avoid failures retained from Practice.",
      "The result must be original to the supplied footage while following the learned professional visual language.",
    ];
  return [
    "EDITFLOW 2.0 GPT ORCHESTRATION ASSIGNMENT",
    "Session: " + input.sessionId,
    "Mode: " + input.mode,
    ...(input.mode === "PRACTICE" ? ["Practice role: " + (input.practiceRole ?? "LEARNING")] : []),
    "Edit Type: " + input.editTypeId,
    "",
    ...modeInstruction,
    "",
    "Control architecture:",
    "- GPT is the orchestrator, creative reasoner, and learner.",
    "- EditFlow Brain is supporting editing knowledge and capability intelligence, not a replacement for GPT reasoning.",
    "- EditFlow visual analysis is GPT's eyes.",
    "- EditFlow's typed After Effects controls are GPT's primary editing hands.",
    "- Desktop Commander is the system-level hand for files, processes, recovery, and environment operations.",
    "- All editorial cutting, retiming, remodeling, effects, transitions, compositing, and final construction must exist in After Effects.",
    "- Never replace an unfamiliar reference behavior with a weaker known effect. Reverse-engineer it and synthesize a construction when capabilities permit.",
    "- If a fundamental skill is missing, distinguish a RECIPE_SKILL gap from an EXECUTION_CAPABILITY gap instead of degrading the reference.",
    ...(input.practiceRole === "HELD_OUT_CERTIFICATION"
      ? [
        "- Held-out certification is inference-only: do not research or implement a missing skill inside the case. Record the exact missing behavior/capability in the audit trace and allow the case to fail.",
      ]
      : [
        ...RESEARCH_PRIORITY_LINES,
        "- Preserve research provenance (source, URI when available, and the specific technique learned) in the Practice trace. Research is for discovery; rendered/readback evidence is still required for proof.",
      ]),
    "- Treat a short replay of recently shown source frames backward as TEMPORAL_REWIND / REVERSE_PLAYBACK. Do not confuse it with animation-parameter recovery, transition recoil, or a failed construction. Measure the source-time trajectory, rewind span, speed, and exit behavior, then reproduce the actual backward replay.",
    ...(input.practiceRole === "HELD_OUT_CERTIFICATION"
      ? [
        "- Do not synthesize or retain a new reusable skill during certification. A missing execution route is a certification failure, not an invitation to widen the system under test.",
      ]
      : [
        "- If existing primitives can express the behavior, synthesize and prove a new reusable skill. If an execution capability is genuinely absent, implement/prove the missing EditFlow route when development access permits; otherwise mark the exact gap BLOCKED.",
        "- Research is hypothesis evidence, not proof. Resume the edit only after AE construction/readback/render evidence supports the new skill or capability.",
      ]),
    "- GPT completion is not Practice mastery. On completion, EditFlow independently re-analyzes the actual final render against Finish, re-checks exact source matches, M6 defining behavior coverage, effect/transition fidelity, and the configured Practice proof gate.",
    ...(practicePolicy === null ? [] : [
      "- Practice certification thresholds: weighted/effect/transition fidelity >= " + practicePolicy.minimumSimilarity.toFixed(3)
        + ", exact-scene confidence >= " + practicePolicy.exactSceneConfidence.toFixed(3)
        + ", raw-audio confidence >= " + practicePolicy.minimumAudioConfidence.toFixed(3)
        + ". These thresholds can be strengthened per session but never weakened below the product floor.",
    ]),
    "- A Practice run that misses any hard gate remains HUMAN_REVIEW_REQUIRED even if GPT believes the edit is successful. Never self-certify or substitute prose confidence for retained comparison evidence.",
    ...(input.practiceRole === "HELD_OUT_CERTIFICATION"
      ? [
        "- A passing held-out case is certification evidence only. It must not become a mastery/training record or alter TRANSFER_VERIFIED skills.",
        "- appliedSkillIds on SUCCESS/IMPROVED AE_ACTION or RESULT events are diagnostic audit claims only. They never earn certification credit by themselves.",
        "- Skill-use credit is derived independently from the exact persisted Practice attempt that produced the certified render. Every causal invariant must satisfy the retained machineUseSignature using actual cue IDs, rationale codes, construction IDs, proof effect-family/object evidence, or retained AE/runtime evidence refs.",
        "- A retained skill with no machineUseSignature, a render-mismatched/missing attempt, missing construction IDs, or an unsatisfied causal invariant earns no held-out skill credit. Do not try to compensate with prose or extra appliedSkillIds claims.",
        "- Skill-level certification is cumulative across held-out cases: ROBUST requires machine-attested passing held-out coverage for every retained TRANSFER_VERIFIED learned skill, not merely aggregate effect-family coverage.",
      ]
      : [
        "- The first machine-passing reference reconstruction is REFERENCE_VERIFIED. Pro Creation remains blocked until a later materially different Finish/source set also passes and promotes the Edit Type to TRANSFER_VERIFIED.",
        "- When an existing AE_PROVEN skill is successfully re-proven on a materially different Practice reference/source set, emit a fresh SKILL_COMMIT with AE_PROVEN maturity. EditFlow promotes that skill to TRANSFER_VERIFIED only after the overall machine transfer gate passes.",
      ]),
    "- Check cancellation state between meaningful operations and stop safely when cancellation is requested.",
    "",
    input.practiceRole === "HELD_OUT_CERTIFICATION" ? "Certification audit trace contract:" : "Learning trace contract:",
    ...(input.practiceRole === "HELD_OUT_CERTIFICATION"
      ? [
        "Inference loop: OBSERVATION -> INTERPRETATION -> HYPOTHESIS -> PLAN -> AE_ACTION -> RENDER -> COMPARISON -> DIAGNOSIS -> CORRECTION -> RESULT.",
        "Do not emit RESEARCH, CAPABILITY_IMPLEMENTATION, CAPABILITY_PROOF, SKILL_COMMIT, or LESSON during held-out certification.",
      ]
      : [
        "Normal loop: OBSERVATION -> INTERPRETATION -> HYPOTHESIS -> PLAN -> AE_ACTION -> RENDER -> COMPARISON -> DIAGNOSIS -> CORRECTION -> RESULT -> LESSON.",
        "When a missing fundamental skill/capability is discovered, insert CAPABILITY_GAP -> RESEARCH -> CAPABILITY_IMPLEMENTATION -> CAPABILITY_PROOF -> SKILL_COMMIT, then return to the normal AE/render/compare loop.",
        "A lesson or committed skill should capture transferable reasons and adaptation rules, not only literal parameter values.",
        "Every SKILL_COMMIT must retain a causal transfer model: trigger conditions, visual/temporal invariants, adaptation axes, failure signals, repair strategies, and explicit transfer criteria. It should also retain a machineUseSignature that maps every causal invariant to observable Practice/AE proof predicates (CUE_ID, RATIONALE_CODE, CONSTRUCTION_ID, EVIDENCE_REF, PROOF_EFFECT_FAMILY, or PROOF_OBJECT_AWARE; EXACT or PREFIX matching). Do not encode an invariant that cannot be independently observed.",
        "A later materially different Practice run must re-prove and re-commit that skill before EditFlow can promote it to TRANSFER_VERIFIED.",
      ]),
    "",
    "Start media:",
    ...input.start.map(mediaLine),
    ...(input.finish === null ? [] : ["", "Finish reference:", mediaLine(input.finish)]),
    "",
    "Artifact directory: " + input.artifactDir,
    "",
    "Retained Edit Type knowledge:",
    "Maturity: " + (learned?.maturityStage ?? "UNPROVEN"),
    "Trust scope: " + (learned?.knowledgeScope ?? "NONE"),
    "Successful lessons: " + (successLessons.length === 0 ? "(none yet)" : successLessons.join(" | ")),
    "Failures to avoid: " + (failureLessons.length === 0 ? "(none yet)" : failureLessons.join(" | ")),
    "Development patterns: " + (patterns.length === 0 ? "(none yet)" : patterns.join(" | ")),
    "Learned skills: " + (skillLines.length === 0 ? "(none yet)" : skillLines.join(" | ")),
    "Open/blocked capability gaps: " + (gapLines.length === 0 ? "(none)" : gapLines.join(" | ")),
  ].join("\n");
};

export class GptOrchestrationStoreV1 {
  readonly filePath: string;
  #tail: Promise<void> = Promise.resolve();
  #sequence = 0;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async #write(payload: GptOrchestrationStorePayloadV1): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    this.#sequence += 1;
    const temporary = this.filePath + ".tmp-" + String(process.pid) + "-" + String(this.#sequence);
    await writeFile(temporary, JSON.stringify(payload, null, 2) + "\n", "utf8");
    try {
      await rename(temporary, this.filePath);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (process.platform !== "win32" || (code !== "EPERM" && code !== "EACCES")) throw error;
      await copyFile(temporary, this.filePath);
      await unlink(temporary);
    }
  }

  async #mutate<T>(
    operation: (payload: GptOrchestrationStorePayloadV1) =>
      Promise<readonly [GptOrchestrationStorePayloadV1, T]> |
      readonly [GptOrchestrationStorePayloadV1, T],
  ): Promise<T> {
    let output!: T;
    const pending = this.#tail.then(async () => {
      const current = await readStore(this.filePath);
      const [next, value] = await operation(current);
      await this.#write(next);
      output = value;
    });
    this.#tail = pending.catch(() => undefined);
    await pending;
    return output;
  }

  async createAssignment(input: {
    readonly sessionId: string;
    readonly mode: GptOrchestrationModeV1;
    readonly practiceRole?: PracticeRunRoleV1 | null;
    readonly editTypeId: string;
    readonly finish: PracticeMediaInputV1 | null;
    readonly start: readonly PracticeMediaInputV1[];
    readonly practicePolicy?: Partial<PracticeVerificationPolicyV1> | null;
    readonly artifactDir: string;
    readonly knowledge: EditTypeKnowledgeSnapshotV1 | null;
  }): Promise<GptOrchestrationAssignmentV1> {
    const sessionId = nonEmpty(input.sessionId, "sessionId");
    const editTypeId = nonEmpty(input.editTypeId, "editTypeId");
    if (input.start.length === 0) throw new TypeError("GPT assignment requires Start media.");
    if (input.mode === "PRACTICE" && input.finish === null) {
      throw new TypeError("GPT Practice assignment requires a Finish reference.");
    }
    const practiceRole: PracticeRunRoleV1 | null = input.mode === "PRACTICE"
      ? input.practiceRole === "HELD_OUT_CERTIFICATION"
        ? "HELD_OUT_CERTIFICATION"
        : "LEARNING"
      : null;
    if (practiceRole === "HELD_OUT_CERTIFICATION"
      && input.knowledge?.knowledgeScope !== "TRANSFER_VERIFIED_ONLY") {
      throw new TypeError("Held-out Practice certification requires a frozen TRANSFER_VERIFIED_ONLY knowledge snapshot.");
    }
    const assignmentId = "gpt-assignment:" + randomUUID();
    const artifactDir = path.resolve(input.artifactDir);
    const practicePolicy = input.mode === "PRACTICE"
      ? normalizePracticeVerificationPolicyV1(input.practicePolicy)
      : null;
    const assignment: GptOrchestrationAssignmentV1 = {
      schema: "editflow.gpt-orchestration-assignment.v1",
      assignmentId,
      sessionId,
      mode: input.mode,
      practiceRole,
      editTypeId,
      status: "PENDING",
      finish: input.finish === null ? null : structuredClone(input.finish),
      start: structuredClone(input.start),
      practicePolicy,
      artifactDir,
      chatMessage: buildGptOrchestrationChatMessageV1({
        sessionId,
        mode: input.mode,
        practiceRole,
        editTypeId,
        finish: input.finish,
        start: input.start,
        practicePolicy,
        artifactDir,
        knowledge: input.knowledge,
      }),
      createdAt: new Date().toISOString(),
      claimedAt: null,
      claimedBy: null,
      startedAt: null,
      completedAt: null,
      cancelRequestedAt: null,
      finalRenderRef: null,
      finalSummary: null,
      error: null,
    };
    return await this.#mutate((payload) => {
      if (payload.assignments.some((item) => item.sessionId === sessionId)) {
        throw new TypeError("GPT assignment already exists for session " + sessionId + ".");
      }
      return [{
        ...payload,
        assignments: [...payload.assignments, assignment],
      }, structuredClone(assignment)] as const;
    });
  }

  async getAssignment(assignmentId: string): Promise<GptOrchestrationAssignmentV1 | null> {
    const payload = await readStore(this.filePath);
    const assignment = payload.assignments.find((item) => item.assignmentId === assignmentId);
    return assignment === undefined ? null : structuredClone(assignment);
  }

  async getBySession(sessionId: string): Promise<GptOrchestrationAssignmentV1 | null> {
    const payload = await readStore(this.filePath);
    const assignment = payload.assignments.find((item) => item.sessionId === sessionId);
    return assignment === undefined ? null : structuredClone(assignment);
  }

  async listAssignments(input: {
    readonly statuses?: readonly GptAssignmentStatusV1[];
    readonly mode?: GptOrchestrationModeV1;
  } = {}): Promise<readonly GptOrchestrationAssignmentV1[]> {
    const payload = await readStore(this.filePath);
    const statusSet = input.statuses === undefined ? null : new Set(input.statuses);
    return payload.assignments
      .filter((item) => statusSet === null || statusSet.has(item.status))
      .filter((item) => input.mode === undefined || item.mode === input.mode)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((item) => structuredClone(item));
  }

  async claim(assignmentId: string, claimedBy: string): Promise<GptOrchestrationAssignmentV1> {
    const controller = nonEmpty(claimedBy, "claimedBy");
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (assignment.status !== "PENDING") {
        throw new TypeError("GPT assignment is not pending: " + assignment.status);
      }
      const now = new Date().toISOString();
      return {
        ...assignment,
        status: "RUNNING",
        claimedAt: now,
        claimedBy: controller,
        startedAt: now,
      };
    });
  }

  async requestCancel(assignmentId: string): Promise<GptOrchestrationAssignmentV1> {
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(assignment.status)) return assignment;
      const now = new Date().toISOString();
      if (assignment.status === "PENDING") {
        return {
          ...assignment,
          status: "CANCELLED",
          cancelRequestedAt: now,
          completedAt: now,
          finalSummary: "Cancelled before GPT claimed the assignment.",
        };
      }
      return {
        ...assignment,
        status: "CANCEL_REQUESTED",
        cancelRequestedAt: assignment.cancelRequestedAt ?? now,
      };
    });
  }

  async acknowledgeCancelled(
    assignmentId: string,
    summary = "GPT stopped safely after cancellation was requested.",
  ): Promise<GptOrchestrationAssignmentV1> {
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (assignment.status !== "CANCEL_REQUESTED" && assignment.status !== "CANCELLED") {
        throw new TypeError("GPT assignment has no active cancellation request.");
      }
      return {
        ...assignment,
        status: "CANCELLED",
        completedAt: assignment.completedAt ?? new Date().toISOString(),
        finalSummary: summary.trim() || "Cancelled.",
      };
    });
  }

  async appendEvent(input: {
    readonly assignmentId: string;
    readonly stage: GptLearningStageV1;
    readonly outcome?: GptLearningOutcomeV1;
    readonly attempt?: number;
    readonly summary: string;
    readonly detail?: string;
    readonly developmentPattern?: string;
    readonly reusableLesson?: string;
    readonly avoidRepeat?: string;
    readonly capabilityGap?: GptCapabilityGapV1;
    readonly researchSources?: readonly GptResearchSourceV1[];
    readonly learnedSkill?: GptLearnedSkillV1;
    readonly appliedSkillIds?: readonly string[];
    readonly evidenceRefs?: readonly string[];
  }): Promise<GptLearningEventV1> {
    const summary = nonEmpty(input.summary, "summary");
    return await this.#mutate((payload) => {
      const assignment = payload.assignments.find((item) => item.assignmentId === input.assignmentId);
      if (assignment === undefined) throw new TypeError("Unknown GPT assignment: " + input.assignmentId);
      if (!["RUNNING", "CANCEL_REQUESTED"].includes(assignment.status)) {
        throw new TypeError("GPT learning events require a running assignment.");
      }
      const appliedSkillIds = unique(input.appliedSkillIds ?? []);
      const eventOutcome = input.outcome ?? "NEUTRAL";
      if (assignment.practiceRole === "HELD_OUT_CERTIFICATION") {
        const forbiddenStages: readonly GptLearningStageV1[] = [
          "RESEARCH", "CAPABILITY_IMPLEMENTATION", "CAPABILITY_PROOF", "SKILL_COMMIT", "LESSON",
        ];
        if (forbiddenStages.includes(input.stage)) {
          throw new TypeError("Held-out Practice certification is inference-only and forbids learning/mutation stages.");
        }
        if (input.developmentPattern !== undefined
          || input.reusableLesson !== undefined
          || input.avoidRepeat !== undefined
          || input.learnedSkill !== undefined) {
          throw new TypeError("Held-out Practice certification cannot retain lessons, patterns, or learned skills.");
        }
        if (appliedSkillIds.length > 0
          && input.stage !== "AE_ACTION"
          && input.stage !== "RESULT") {
          throw new TypeError(
            "Held-out appliedSkillIds are allowed only on AE_ACTION or RESULT audit events.",
          );
        }
        if (appliedSkillIds.length > 0
          && eventOutcome !== "SUCCESS"
          && eventOutcome !== "IMPROVED") {
          throw new TypeError(
            "Held-out appliedSkillIds require SUCCESS or IMPROVED audit outcome.",
          );
        }
        if (appliedSkillIds.length > 0 && unique(input.evidenceRefs ?? []).length === 0) {
          throw new TypeError(
            "Held-out appliedSkillIds require retained evidenceRefs tying the skill claim to the case.",
          );
        }
      } else if (appliedSkillIds.length > 0) {
        throw new TypeError("appliedSkillIds are reserved for held-out Practice certification audits.");
      }
      const sessionEvents = payload.events.filter((event) => event.sessionId === assignment.sessionId);
      let retainedLearnedSkill = input.learnedSkill === undefined
        ? undefined
        : structuredClone(input.learnedSkill);
      if (input.stage === "CAPABILITY_GAP" && input.capabilityGap === undefined) {
        throw new TypeError("CAPABILITY_GAP requires capabilityGap.");
      }
      if (input.stage === "RESEARCH") {
        if (input.researchSources === undefined || input.researchSources.length === 0) {
          throw new TypeError("RESEARCH requires researchSources.");
        }
        if (!isTutorialDriveResearchSource(input.researchSources[0])) {
          throw new TypeError(
            "RESEARCH must begin with Tutorial Drive provenance using a Google Drive tutorial/file or recorded folder search before Adobe or broader web sources.",
          );
        }
        if (!researchSourcesFollowPriority(input.researchSources)) {
          throw new TypeError(
            "RESEARCH sources must preserve priority order: Tutorial Drive -> Adobe/resources -> external professional/plugin sources -> broader web.",
          );
        }
        for (const source of input.researchSources) {
          if (!hasValidTutorialCompilation(source)) {
            throw new TypeError(
              "Tutorial causal compilations must be compiler-backed Tutorial Drive records with structured technique, complete causal semantics, and retained analysis evidence.",
            );
          }
          if (isTutorialDriveResearchSource(source)
            && !isTutorialDriveFolderSearch(source)
            && !hasStructuredTutorialTechnique(source)) {
            throw new TypeError(
              "A matched Tutorial Drive tutorial must retain WHAT, WHEN/WHY, HOW, ACCESS, PROOF, and TRANSFER technique fields before it can support Practice learning.",
            );
          }
          if (isTutorialDriveResearchSource(source)
            && !isTutorialDriveFolderSearch(source)
            && source.tutorialCompilation === undefined) {
            throw new TypeError(
              "A matched Tutorial Drive tutorial file must be deep-analyzed and compiled by EditFlow before it can support Practice learning.",
            );
          }
        }
      }
      if (input.stage === "CAPABILITY_IMPLEMENTATION") {
        const gap = input.capabilityGap;
        if (gap === undefined || gap.status !== "OPEN") {
          throw new TypeError(
            "CAPABILITY_IMPLEMENTATION requires the originating OPEN capabilityGap.",
          );
        }
        const gapWasOpened = sessionEvents.some((event) =>
          event.stage === "CAPABILITY_GAP"
          && sameCapabilityGapIdentity(event.capabilityGap, gap));
        if (!gapWasOpened) {
          throw new TypeError(
            "CAPABILITY_IMPLEMENTATION must bind to a prior matching CAPABILITY_GAP event.",
          );
        }
      }
      if (input.stage === "CAPABILITY_PROOF") {
        const gap = input.capabilityGap;
        if (gap === undefined || gap.status !== "OPEN") {
          throw new TypeError(
            "CAPABILITY_PROOF requires the originating OPEN capabilityGap.",
          );
        }
        if (unique(input.evidenceRefs ?? []).length === 0) {
          throw new TypeError("CAPABILITY_PROOF requires retained evidenceRefs.");
        }
        const gapWasOpened = sessionEvents.some((event) =>
          event.stage === "CAPABILITY_GAP"
          && sameCapabilityGapIdentity(event.capabilityGap, gap));
        if (!gapWasOpened) {
          throw new TypeError(
            "CAPABILITY_PROOF must bind to a prior matching CAPABILITY_GAP event.",
          );
        }
        const priorResearch = sessionEvents.filter((event) => event.stage === "RESEARCH")
          .flatMap((event) => event.researchSources ?? []);
        const priorImplementation = sessionEvents.some((event) =>
          event.stage === "CAPABILITY_IMPLEMENTATION"
          && event.outcome !== "FAILURE"
          && sameCapabilityGapIdentity(event.capabilityGap, gap));
        if (!priorResearch.some(isTutorialDriveResearchSource)) {
          throw new TypeError("CAPABILITY_PROOF requires prior Tutorial Drive research provenance.");
        }
        if (!hasResearchLearningPath(priorResearch)) {
          throw new TypeError(
            "CAPABILITY_PROOF requires either a compiler-backed Tutorial Drive technique record or a retained Tutorial Drive no-match folder search followed by an escalated authoritative source.",
          );
        }
        if (!priorImplementation) {
          throw new TypeError(
            "CAPABILITY_PROOF requires a prior CAPABILITY_IMPLEMENTATION event for the same capability gap.",
          );
        }
      }
      if (input.stage === "SKILL_COMMIT") {
        const gap = input.capabilityGap;
        const research = sessionEvents.filter((event) => event.stage === "RESEARCH")
          .flatMap((event) => event.researchSources ?? []);
        if (retainedLearnedSkill !== undefined) {
          retainedLearnedSkill = applyCompiledTutorialCausalModelV1(
            retainedLearnedSkill,
            research,
          );
        }
        const skill = retainedLearnedSkill;
        if (gap === undefined || skill === undefined) {
          throw new TypeError("SKILL_COMMIT requires learnedSkill and resolved capabilityGap.");
        }
        if (gap.status !== "RESOLVED" || gap.resolutionSkillId !== skill.skillId) {
          throw new TypeError("SKILL_COMMIT must resolve the gap with the committed skill.");
        }
        if (skill.maturity !== "AE_PROVEN") {
          throw new TypeError(
            "SKILL_COMMIT requires AE_PROVEN maturity. TRANSFER_VERIFIED is assigned only after a machine-verified transfer Practice completion.",
          );
        }
        if (skill.adaptationNotes === undefined || skill.adaptationNotes.trim().length === 0) {
          throw new TypeError("SKILL_COMMIT requires explicit transfer/adaptation rules.");
        }
        if (!hasCausalTransferModel(skill)) {
          throw new TypeError(
            "SKILL_COMMIT requires a complete causal transfer model with triggers, invariants, adaptation axes, failure signals, repair strategies, and transfer criteria.",
          );
        }
        if (!hasCompleteMachineUseSignature(skill)) {
          throw new TypeError(
            "SKILL_COMMIT requires a machineUseSignature covering every causal invariant and binding at least one rule to persisted CONSTRUCTION_ID evidence.",
          );
        }
        const gapWasOpened = sessionEvents.some((event) =>
          event.stage === "CAPABILITY_GAP"
          && sameCapabilityGapIdentity(event.capabilityGap, gap));
        const matchingProofEvents = sessionEvents.filter((event) =>
          event.stage === "CAPABILITY_PROOF"
          && event.outcome === "SUCCESS"
          && event.evidenceRefs.length > 0
          && sameCapabilityGapIdentity(event.capabilityGap, gap));
        if (!gapWasOpened) {
          throw new TypeError(
            "SKILL_COMMIT requires a prior matching CAPABILITY_GAP event.",
          );
        }
        if (!research.some(isTutorialDriveResearchSource)) {
          throw new TypeError("SKILL_COMMIT requires prior Tutorial Drive research provenance.");
        }
        if (!hasResearchLearningPathForSkill(research, skill.skillId)) {
          throw new TypeError(
            "SKILL_COMMIT requires compiler-backed Tutorial Drive semantics targeting the committed skill, or a retained Tutorial Drive no-match search followed by an escalated authoritative source.",
          );
        }
        if (matchingProofEvents.length === 0) {
          throw new TypeError(
            "SKILL_COMMIT requires a successful CAPABILITY_PROOF bound to the same capability gap.",
          );
        }
        retainedLearnedSkill = {
          ...skill,
          evidenceRefs: unique([
            ...skill.evidenceRefs,
            ...matchingProofEvents.flatMap((event) => event.evidenceRefs),
          ]),
        };
      }
      const event: GptLearningEventV1 = {
        schema: "editflow.gpt-learning-event.v1",
        eventId: "gpt-learning-event:" + randomUUID(),
        sessionId: assignment.sessionId,
        editTypeId: assignment.editTypeId,
        mode: assignment.mode,
        ...(input.attempt === undefined ? {} : { attempt: Math.max(1, Math.floor(input.attempt)) }),
        stage: input.stage,
        outcome: eventOutcome,
        summary,
        ...(input.detail === undefined ? {} : { detail: input.detail.trim() }),
        ...(input.developmentPattern === undefined
          ? {}
          : { developmentPattern: input.developmentPattern.trim() }),
        ...(input.reusableLesson === undefined
          ? {}
          : { reusableLesson: input.reusableLesson.trim() }),
        ...(input.avoidRepeat === undefined ? {} : { avoidRepeat: input.avoidRepeat.trim() }),
        ...(input.capabilityGap === undefined
          ? {}
          : { capabilityGap: structuredClone(input.capabilityGap) }),
        ...(input.researchSources === undefined
          ? {}
          : { researchSources: structuredClone(input.researchSources) }),
        ...(retainedLearnedSkill === undefined
          ? {}
          : { learnedSkill: structuredClone(retainedLearnedSkill) }),
        ...(appliedSkillIds.length === 0 ? {} : { appliedSkillIds }),
        evidenceRefs: unique(input.evidenceRefs ?? []),
        createdAt: new Date().toISOString(),
      };
      return [{
        ...payload,
        events: [...payload.events, event],
      }, structuredClone(event)] as const;
    });
  }

  async eventsForSession(sessionId: string): Promise<readonly GptLearningEventV1[]> {
    const payload = await readStore(this.filePath);
    return payload.events
      .filter((event) => event.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((event) => structuredClone(event));
  }

  async complete(
    assignmentId: string,
    completion: GptAssignmentCompletionV1,
  ): Promise<GptOrchestrationAssignmentV1> {
    const summary = nonEmpty(completion.finalSummary, "finalSummary");
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (!["RUNNING", "CANCEL_REQUESTED"].includes(assignment.status)) {
        throw new TypeError("GPT assignment is not running.");
      }
      if (assignment.status === "CANCEL_REQUESTED") {
        return {
          ...assignment,
          status: "CANCELLED",
          completedAt: new Date().toISOString(),
          finalSummary: summary,
        };
      }
      return {
        ...assignment,
        status: completion.success ? "COMPLETED" : "FAILED",
        completedAt: new Date().toISOString(),
        finalRenderRef: completion.finalRenderRef?.trim() || null,
        finalSummary: summary,
        error: completion.success ? null : summary,
      };
    });
  }

  async fail(assignmentId: string, error: string): Promise<GptOrchestrationAssignmentV1> {
    const message = nonEmpty(error, "error");
    return await this.#updateAssignment(assignmentId, (assignment) => ({
      ...assignment,
      status: assignment.status === "CANCEL_REQUESTED" ? "CANCELLED" : "FAILED",
      completedAt: new Date().toISOString(),
      error: assignment.status === "CANCEL_REQUESTED" ? null : message,
      finalSummary: message,
    }));
  }

  async #updateAssignment(
    assignmentId: string,
    update: (assignment: GptOrchestrationAssignmentV1) => GptOrchestrationAssignmentV1,
  ): Promise<GptOrchestrationAssignmentV1> {
    return await this.#mutate((payload) => {
      const index = payload.assignments.findIndex((item) => item.assignmentId === assignmentId);
      if (index < 0) throw new TypeError("Unknown GPT assignment: " + assignmentId);
      const next = [...payload.assignments];
      const updated = update(next[index]!);
      next[index] = updated;
      return [{ ...payload, assignments: next }, structuredClone(updated)] as const;
    });
  }
}
