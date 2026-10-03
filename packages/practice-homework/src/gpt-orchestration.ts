import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  PracticePreflightCheckpointV1,
  PracticeSceneMatchV1,
  PracticeRunRoleV1,
  PracticeVerificationPolicyV1,
} from "./contracts.js";
import { applyCompiledTutorialCausalModelV1 } from "./tutorial-causal-compiler.js";
import { CLIP_RESEARCH_POLICY_V1 } from "./clip-research.js";
import { hasVerifiedPracticeSourceIdentityV1 } from "./engine.js";

const isDirectChatgptRawSelectionV1 = (
  match: PracticeSceneMatchV1,
  start: readonly PracticeMediaInputV1[],
): boolean => match.selectionMode === "CHATGPT_DIRECT"
  && hasVerifiedPracticeSourceIdentityV1(match)
  && !!match.shotId?.trim() && Number.isFinite(match.confidence)
  && match.confidence >= 0 && match.confidence <= 1
  && Number.isFinite(match.sourceStartMs) && match.sourceStartMs >= 0
  && Number.isFinite(match.sourceEndMs) && match.sourceEndMs > match.sourceStartMs
  && Number.isFinite(match.playbackRate) && match.playbackRate > 0
  && start.some((media) => media.role === "START_SOURCE"
    && media.mediaKind === "VIDEO" && media.mediaId === match.sourceId);

const assertDirectChatgptRawSelectionsV1 = (
  matches: readonly PracticeSceneMatchV1[],
  start: readonly PracticeMediaInputV1[],
): void => {
  if (matches.some((match) => !isDirectChatgptRawSelectionV1(match, start))
    || new Set(matches.map((match) => match.shotId)).size !== matches.length) {
    throw new TypeError("CHATGPT_DIRECT_REQUIRED: Practice accepts only direct ChatGPT selections backed by retained comparisons of provided raw video.");
  }
};

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

const eventJournalPathFor = (filePath: string): string => filePath + ".events.jsonl";

const readEventJournal = async (filePath: string): Promise<readonly GptLearningEventV1[]> => {
  try {
    const raw = await readFile(eventJournalPathFor(filePath), "utf8");
    return raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line) as GptLearningEventV1; }
      catch (error) {
        throw new TypeError(`GPT orchestration event journal contains invalid JSON at line ${index + 1}: ${String(error)}`);
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

const mergeEvents = (
  snapshotEvents: readonly GptLearningEventV1[],
  journalEvents: readonly GptLearningEventV1[],
): readonly GptLearningEventV1[] => {
  const byId = new Map<string, GptLearningEventV1>();
  for (const event of [...snapshotEvents, ...journalEvents]) byId.set(event.eventId, event);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

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
    const journalEvents = await readEventJournal(filePath);
    return {
      ...payload,
      events: mergeEvents(payload.events, journalEvents),
      assignments: payload.assignments.map((assignment) => {
        const practicePolicy = assignment.mode === "PRACTICE"
          ? normalizePracticeVerificationPolicyV1(assignment.practicePolicy)
          : null;
        const practiceRole: PracticeRunRoleV1 | null = assignment.mode === "PRACTICE"
          ? assignment.practiceRole === "HELD_OUT_CERTIFICATION"
            ? "HELD_OUT_CERTIFICATION"
            : "LEARNING"
          : null;
        const currentMessage = assignment.chatMessage.includes("MANDATORY PER-CLIP RESEARCH GATE V1")
          ? assignment.chatMessage : assignment.chatMessage + "\n\n" + CLIP_RESEARCH_POLICY_V1;
        const researchMessage = applyCurrentResearchPriority(currentMessage);
        const continuityMessage = applyCurrentWorkflowContinuityPolicy(researchMessage, assignment.mode);
        const directMatches = (assignment.practiceSceneMatches ?? []).filter((match) => isDirectChatgptRawSelectionV1(match, assignment.start));
        const discardedLegacy = assignment.mode === "PRACTICE"
          && directMatches.length !== (assignment.practiceSceneMatches ?? []).length;
        const needsDirectPreflight = assignment.mode === "PRACTICE"
          && ["PENDING", "CLAIMED", "RUNNING"].includes(assignment.status)
          && (discardedLegacy || assignment.preflight === undefined);
        return {
          ...assignment,
          ...(discardedLegacy ? { practiceSceneMatches: directMatches } : {}),
          ...(needsDirectPreflight ? { preflight: { ...assignment.preflight, stage: "AWAITING_CHATGPT_SHOTS" as const,
              updatedAt: new Date().toISOString(), requireTransferNovelty: assignment.preflight?.requireTransferNovelty ?? false,
              completedShotIds: [], unresolvedShotIds: assignment.preflight?.totalShotIds ?? [],
              reasons: ["Practice requires direct ChatGPT footage selections and verified preflight before editing."], evidenceRefs: [] } } : {}),
          practiceRole,
          practicePolicy,
          chatMessage: applyCurrentProductionQueuePolicy(continuityMessage, assignment.mode),
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
  "- Tutorial Drive is the mandatory first research source before editing EVERY clip in Practice and Pro Creation. Scan raw/reference windows, consult and compile matching tutorials, map the learned tools/method steps to each effect, and commit the durable clip research plan before AE mutations.",
  "- Search the Tutorial Drive for the closest matching behavior or technique before consulting any external source. Primary folders: Adobe Effect Tutorials (" + EDITFLOW_EFFECT_TUTORIALS_FOLDER_V1 + ") and Adobe Effect Music + Beat Tutorials (" + EDITFLOW_MUSIC_BEAT_TUTORIALS_FOLDER_V1 + "). Root: " + EDITFLOW_TUTORIAL_DRIVE_ROOT_V1 + ".",
  "- Use the matching tutorial video or videos to retain a structured technique record: WHAT the visible behavior is, WHEN/WHY it is used, HOW it is constructed in After Effects, ACCESS requirements, the PROOF needed to verify it, and TRANSFER rules for adapting it to new footage. Do not copy literal tutorial values as the lesson.",
  "- ChatGPT directly studies the tutorial and chooses its construction, exact settings, invariants, adaptation and troubleshooting. Record those decisions as explicit clip-research SOURCE steps with authority:CHATGPT_DIRECT and reviewed worked examples. Machine tutorial compilation is retired from production.",
  "- Preserve tutorial provenance and actual AE render/readback checks. Retain successes and failures in the selected preset's existing practice-notebook; no machine skill promotion or automatic recipe application.",
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

const PRIMARY_EDIT_PRODUCTION_SYSTEM_MARKER =
  "- PRIMARY EDIT PRODUCTION SYSTEM IS MANDATORY:";
const WORKFLOW_CONTINUITY_POLICY_MARKER =
  "- PRACTICE CONTINUITY IS MANDATORY:";
const PRO_CREATION_CONTINUITY_POLICY_MARKER =
  "- PRO CREATION CONTINUITY IS MANDATORY:";

const LEGACY_WORKFLOW_POLICY_REPLACEMENTS = [
  [
    "- M6_IS_TARGETED_SPECIALIST: M6/VisualEffectsBrain may analyze, synthesize, test, and correct specific observed effects/transitions, but it must not become the governing whole-edit reconstruction loop.",
    "- PRIMARY_SYSTEM_GOVERNS_REFERENCE_DRIVEN_WORKFLOW: The primary production system owns scheduling, continuity, batching, checkpoints, and AE execution. Within Practice, invoke the M6 reference-fidelity engine for dense reference analysis, construction/synthesis, comparison, correction, and fidelity gating.",
  ],
  [
    "- ORIGINAL_M6_GOVERNS_REFERENCE_DRIVEN_WORKFLOW: Follow the original M6 roadmap from scene understanding and reference-effect detection through dense evidence, anatomy/DNA, construction/synthesis, real-AE local render, semantic comparison, bounded correction, and fidelity gating. GPT supervises continuity and escalation; later systems support this route rather than replacing it.",
    "- PRIMARY_SYSTEM_GOVERNS_REFERENCE_DRIVEN_WORKFLOW: The primary production system owns scheduling, continuity, batching, checkpoints, and AE execution. Within Practice, invoke the M6 reference-fidelity engine for reference-effect detection, dense evidence, anatomy/DNA, construction/synthesis, real-AE local render, semantic comparison, bounded correction, and fidelity gating.",
  ],
  [
    "- GPT is the orchestrator, creative reasoner, and learner.",
    "- GPT is the session orchestrator, creative judgment owner, continuity owner, and escalation reasoner inside the primary production system.",
  ],
  [
    "- GPT is the session orchestrator, continuity owner, and escalation reasoner.",
    "- GPT is the session orchestrator, creative judgment owner, continuity owner, and escalation reasoner inside the primary production system.",
  ],
  [
    "- EditFlow Brain is supporting editing knowledge and capability intelligence, not a replacement for GPT reasoning.",
    "- M6 Visual Effects Intelligence is an integrated Practice reference-fidelity engine, not a separate whole-edit production controller.",
  ],
  [
    "- The original M6 Visual Effects Intelligence loop is the governing reference-driven effects/transition workflow inside the full reconstruction process. GPT drives and supervises that loop; it does not replace it with a parallel free-form effect workflow.",
    "- M6 Visual Effects Intelligence is the integrated reference-fidelity engine for difficult Practice effects/transitions, not a separate whole-edit controller.",
  ],
  [
    "- Direct GPT visual judgment of the actual Finish, raw candidates, and rendered result is the creative authority; machine evidence is measurement/support.",
    "- The professional reference and rendered pixels are the Practice visual authority; machine evidence measures and proves the observed behavior.",
  ],
  [
    "- EditFlow visual analysis is GPT's measurement layer and search accelerator, not an autonomous creative editor.",
    "- EditFlow visual analysis is the measurement/search layer inside the primary production system.",
  ],
  [
    "- EditFlow visual analysis is the measurement/search layer used by the governing M6 workflow.",
    "- EditFlow visual analysis is the measurement/search layer inside the primary production system.",
  ],
  [
    "- M6 is the professional effect/transition reconstruction specialist. It receives GPT-observed target behavior and returns/proves constructions; it does not choose the entire edit architecture.",
    "- M6/Visual Effects Intelligence is an integrated synthesis/correction capability inside the primary production system and never creates a second production workflow.",
  ],
] as const;

const applyPrimaryEditProductionSystemPolicy = (
  message: string,
  mode: GptOrchestrationModeV1,
): string => {
  message = message.replace("- Legacy/current-shadow control endpoint names are compatibility aliases only. They may call the same guarded runtime but must never become a separate legacy production workflow or bypass the active assignment.",
    "- Direct mutation endpoints and legacy aliases are removed. Submit every edit through production-jobs; inspect/reconcile its receipt instead of falling back to another execution route.");
  if (message.includes(PRIMARY_EDIT_PRODUCTION_SYSTEM_MARKER)) return message;
  return [
    message,
    "",
    "Primary edit production system (current):",
    PRIMARY_EDIT_PRODUCTION_SYSTEM_MARKER
      + " Practice and Pro Creation use one authoritative production architecture.",
    "- The authoritative route is durable GPT assignment -> production coordinator/job queue -> single AE writer -> persistent warm CEP batched runtime -> After Effects -> render/readback -> retained evidence.",
    "- ChatGPT owns creative judgment, ambiguity resolution, and strategy escalation. Deterministic authorized work runs locally in durable batches/jobs; do not recreate the old serial one-chat/one-action production loop.",
    "- Every production AE mutation during an active Practice or Pro Creation assignment must pass through the guarded production operation path, the mandatory per-clip research gate, and the single-writer lease.",
    "- Direct mutation endpoints and legacy aliases are removed. Submit every edit through production-jobs; inspect/reconcile its receipt instead of falling back to another execution route.",
    "- Keep one AE writer. Parallelize only non-mutating analysis, tutorial retrieval, source preparation, comparison, and planning work.",
    "- Treat ChatGPT conversations as replaceable reasoning workers. Durable assignment state, production heartbeat, checkpoints, job receipts, research plans, and evidence own continuity across chats.",
    "- Reconcile an interrupted or ambiguous AE write from actual readback/evidence before continuing; never blindly replay a crashed mutation.",
    "- Tutorial Drive -> Adobe resources -> external professional/vendor sources -> broader web remains the mandatory research order before clip mutation.",
    "- Production proof scripts, baseline assembly, correction, goals and batches are durable job kinds inside the same worker. Standalone acceptance labs are isolated tests and never production fallback controllers.",
    mode === "PRACTICE"
      ? "- ChatGPT directly studies the reference and decides editorial choices and final acceptance."
      : "- Pro Creation has no Finish answer key: use retained Edit Type lessons and worked examples, the designed editorial target, direct review of actual renders, and the same durable production/execution architecture without inventing reference-only gates.",
  ].join("\n");
};

const applyCurrentWorkflowContinuityPolicy = (
  message: string,
  mode: GptOrchestrationModeV1,
): string => {
  let migrated = applyChatgptFootagePolicyV1(message);
  for (const [legacy, current] of LEGACY_WORKFLOW_POLICY_REPLACEMENTS) {
    migrated = migrated.replace(legacy, current);
  }
  const legacyPracticeHeading = "\n\nOriginal M6 workflow + continuity policy (current):";
  const legacyPracticeIndex = migrated.indexOf(legacyPracticeHeading);
  if (legacyPracticeIndex >= 0) migrated = migrated.slice(0, legacyPracticeIndex);
  if (mode === "PRO_CREATION") {
    migrated = applyPrimaryEditProductionSystemPolicy(migrated, mode);
    if (migrated.includes(PRO_CREATION_CONTINUITY_POLICY_MARKER)) return migrated;
    return [
      migrated,
      "",
      "Pro Creation continuity policy (current):",
      PRO_CREATION_CONTINUITY_POLICY_MARKER
        + " the Pro Creation assignment is the durable unit of work across ChatGPT conversations.",
      "- Resume the existing PENDING/RUNNING Pro Creation assignment from retained events, jobs, checkpoints, research plans, and current AE state. A new chat never creates a replacement edit run.",
      "- Read retained Edit Type knowledge and explicitly decide which techniques apply; adapt it to the supplied footage rather than replaying literal values.",
      "- Build a coherent playable edit early, then render/review and target the largest editorial, pacing, transition, effect, motion, and finish residuals instead of serially perfecting one clip before the rest exists.",
      "- Preserve correct regions and retained checkpoints. Re-run only work invalidated by a concrete source, construction, or proof dependency change.",
      "- Infrastructure failure is a pause, not a restart: repair the connection/runtime and continue from retained production state.",
    ].join("\n");
  }
  migrated = applyPrimaryEditProductionSystemPolicy(migrated, mode);
  if (migrated.includes(WORKFLOW_CONTINUITY_POLICY_MARKER)) return migrated;
  return [
    migrated,
    "",
    "Practice reference-fidelity policy (current):",
    WORKFLOW_CONTINUITY_POLICY_MARKER
      + " the Practice session/assignment is the durable unit of work across ChatGPT conversations.",
    "- Bootstrap once through GET /v1/product/practice/resume-or-start. If the direct MCP transport fails once and Desktop Commander is online, immediately call the authenticated local product API through Desktop Commander. Do not repeatedly retry the failed MCP route.",
    "- POST /v1/product/practice/resume-or-start resumes persisted preflight. Inspect assignment.preflight, prepared practiceSceneMatches, reasons and nextOperation. Keep the same assignment; reconstruct in AE only after READY. Heartbeat by claiming with your unique controller ID at least every 60 seconds; release-controller when handing off.",
    "- A new ChatGPT controller must resume the existing PENDING/RUNNING assignment by reading retained events, artifacts, current AE/EditFlow state, and the latest verified checkpoint. A new chat is never a reason to create a new Practice run.",
    "- Never redo completed reference analysis, source matching, scene locking, baseline assembly, effect-window work, or full renders unless a concrete input change or retained proof explicitly invalidates that stage.",
    "- Infrastructure failure is a pause, not a restart: repair Desktop Commander/EditFlow/CEP/AE, verify readiness, then continue the same assignment from its latest checkpoint.",
    "- The primary production system governs the edit. Within Practice, ChatGPT directly observes and reasons about effects/transitions, supplies exact constructions, reviews real AE renders and decides each correction.",
    "- Retained Edit Type knowledge, Tutorial Drive learning, exact-source working clips, tracking, roto, masks, subject isolation, retained truth, optical flow, advanced synthesis, and later systems are integrated capabilities inside the primary production system, not alternate workflows.",
    "- Optimize for completion: reuse the verified source set and content-locked baseline, preserve correct regions, render locally before full-edit rerenders, and advance from retained evidence instead of rebuilding the edit.",
  ].join("\n");
};

export const CHATGPT_FOOTAGE_POLICY_V1 = [
  "CHATGPT DIRECT RAW FOOTAGE SELECTION V1",
  "ChatGPT alone inspects raw footage and chooses exact scenes/shots. The old raw-shot candidate generator, visual matching/ranking and automated selection are removed from production; never invoke them or treat their cached matches as choices.",
  "Read GET /v1/product/gpt/assignments/{id}/footage-selection and its contract. POST BROWSE with the current claimedBy, mediaId and your explicit timesMs; open its timestamped contact sheets and individual frames. POST SELECT to retain your exact ranges, direction, temporal comparisons, confidence and rationale. Resume prior GPT choices and inspection receipts.",
  "For footage discovery, primarily use internet research: identify the film/episode/event, search distinctive dialogue, scene descriptions, scripts/transcripts, chapter guides and sequence context. Then directly inspect the provided raw media. Web timestamps are clues, never proof or replacement footage. Record research URLs/queries/findings or an actual unavailable-access reason.",
  "Choose efficient strategies yourself: broad chronological contact sheets, scene/context/dialogue clues, interval narrowing, adjacent-scene inspection, cached low-resolution views, dense gesture and boundary sampling, then exact-frame comparisons. You decide which timestamps to inspect; helpers only decode, timestamp, cache and extract what you request, never propose/rank shots. Preserve coverage notes across handoffs and change strategy when a search is unproductive.",
  "Compare at least three distinct Finish/raw moments across every selected shot, including framing, subject identity, pose/action and temporal direction. Retain the comparisons with actual issued inspection evidence IDs; never invent geometric measurements or claim a machine score proves your choice. Materialize only your selected raw ranges with bounded handles before AE assembly.",
  "AWAITING_CHATGPT_SHOTS requires direct footage work now, not polling an algorithm. Keep the same assignment. For effect/transition construction, the separate Tutorial Drive → Adobe → web research order still applies; submit AE actions only through production-jobs and keep AE open.",
].join("\n");

const applyChatgptFootagePolicyV1 = (message: string): string => {
  const cleaned = message.replace(/Preflight-verified source matches \/ AE working clips:\n[\s\S]*?Use the working clip path for AE construction\.[^\n]*/g,
    "ChatGPT-selected raw shots / AE working clips: read current exact selections from footage-selection; never reuse legacy ranked candidates.")
    .split("\n").filter((line) => !line.includes("A machine scene score narrows candidates")
    && !line.includes("strongest raw-source candidates")).join("\n");
  return cleaned.includes("CHATGPT DIRECT RAW FOOTAGE SELECTION V1") ? cleaned : cleaned + "\n\n" + CHATGPT_FOOTAGE_POLICY_V1;
};

const MASTERY_POLICY_MARKER =
  "- GPT completion is not Practice mastery.";

const applyCurrentMasteryPolicy = (
  message: string,
  policy: PracticeVerificationPolicyV1,
): string => {
  return applyCurrentProductionQueuePolicy(message, "PRACTICE");
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
  readonly practiceSceneMatches?: readonly PracticeSceneMatchV1[] | null;
  readonly practicePolicy: PracticeVerificationPolicyV1 | null;
  readonly artifactDir: string;
  readonly knowledge: EditTypeKnowledgeSnapshotV1 | null;
}): string => {
  const learning = input.knowledge?.gptLearning;
  const message = [
    "EDITFLOW 2.0 GPT ORCHESTRATION ASSIGNMENT",
    "Session: " + input.sessionId, "Mode: " + input.mode, "Edit Type: " + input.editTypeId,
    "Practice role: " + (input.practiceRole ?? "LEARNING"),
    input.mode === "PRACTICE" ? "Study the actual Finish and reconstruct it from the provided raw media in After Effects." : "Design an original edit from the provided raw media using the chosen preset and direct render review.",
    "Finish path: " + (input.finish?.uri ?? "(none)"),
    "Learning sequence: OBSERVATION -> INTERPRETATION -> HYPOTHESIS -> PLAN -> AE -> RENDER -> DIRECT COMPARISON -> CORRECTION -> WORKED EXAMPLE.",
    "Finish: " + JSON.stringify(input.finish), "Provided raw media: " + JSON.stringify(input.start),
    "Retained GPT source choices: " + JSON.stringify(input.practiceSceneMatches ?? []),
    "Evidence directory: " + input.artifactDir,
    "Existing preset successes: " + JSON.stringify(learning?.successLessons ?? []),
    "Existing preset failures: " + JSON.stringify(learning?.failureAvoidanceLessons ?? []),
    "Existing preset techniques: " + JSON.stringify(learning?.learnedSkills ?? []),
    "Recent worked examples: " + JSON.stringify((learning?.workedExamples ?? []).slice(-12)),
    "Capability gaps: " + JSON.stringify(learning?.capabilityGaps ?? []),
    "These retained observations are context for your judgment, not automatically applied recipes. Retrieve the fresh complete preset notebook on every start and resume.",
    ...RESEARCH_PRIORITY_LINES, CLIP_RESEARCH_POLICY_V1,
    "Keep one AE writer, keep AE open, preserve correct retained work, and build whole-edit coverage before polishing deficient regions.",
    "Full raw movies are search-only. Materialize your selected ranges with bounded handles for AE; Finish remains a reference and must never become production footage.",
    "Directly inspect all reference shots, cut boundaries, effect states, audio relationships and reverse/rewind behavior. Record your blueprint before construction.",
    "All cutting, retiming, effects, transitions and compositing must be constructed in AE from your explicit decisions. Research unfamiliar behavior rather than replacing it with a weaker approximation.",
  ].join("\n");
  return applyCurrentProductionQueuePolicy(applyCurrentWorkflowContinuityPolicy(message, input.mode), input.mode);
};

const EDIT_PRODUCTION_CONTINUITY_MARKER_V1 = "CHATGPT_DIRECT_EDITORIAL_AUTHORITY_V1";
const editProductionContinuityAppendixV1 = (mode: GptOrchestrationModeV1) => [
  EDIT_PRODUCTION_CONTINUITY_MARKER_V1,
  "Current exclusive editorial authority:",
  "- ChatGPT directly decides reference duration/cuts, footage, audio arrangement, timing/retiming, framing, effects, transitions, construction, corrections, candidate selection, next steps and final acceptance. Automatic creative analysis, formula pulses, baseline generation, scoring/ranking/pruning, machine certification and local-Qwen creative/UI decisions are retired from production.",
  "- Helpers execute your explicit operations or return requested raw observations. Native tracking/roto/optical flow are allowed only when you explicitly choose the target, method and settings and then review the output; no automatic backend or recipe fallback.",
  "- Resume the retained assignment, preserve correct retained work and reconcile actual AE state. Submit every AE action through production-jobs on the sole durable writer. Preserve receipts on timeout; never replay interrupted writes blindly or use retired routes.",
  "- Every job payload requires editorialDecision:{authority:CHATGPT_DIRECT,decisionId,rationale,evidenceRefs:[...],steps:[...]}. Its immutable receipt binds the exact payload hash. Changed plans need new decisionIds. Include the current researchContext/controller credential.",
  "- BUILD_BASELINE requires plan containing exact AE transaction operations. AE_GOAL accepts only SHORT_HORIZON with exact intents or REFRAME with explicit values; automatic pulse goals are rejected. PROOF_SCRIPT requires scriptSha256 of the reviewed script with your explicit editing settings.",
  "- REFERENCE_ANALYSIS decodes only your chosen Finish timesMs inside a bounded window. Use footage-selection BROWSE for wider contact sheets and DEFINE_REFERENCE for explicit durationMs and continuous shots [{shotId,order,referenceStartMs,referenceEndMs,observation,inspections:[{evidenceId,timeMs}]}], authority:CHATGPT_DIRECT and rationale. No automatic cut/tail detector is used.",
  "- Search internet scene/dialogue/script/chapter clues first, then browse your chosen raw timestamps and verify exact provided pixels. SELECT requires explicit ranges, direction, playbackRate, rationale and issued comparison anchors; retain search notes. Source discovery and effect research use their distinct research orders.",
  "- SCRATCH_SEARCH renders every candidate in supplied order at its explicit resolutionScale (default full), without scoring, pruning or selecting a winner. Review the actual alternatives yourself and submit a separate explicit canonical commit. Machines must never decide which alternatives you see.",
  "- Production telemetry and residual measurements are observations. Choose the correction order and strategy yourself. Scheduling, file integrity, leases and execution safety checks are mechanical, not editorial decisions.",
  "- GET assignments/{id}/practice-notebook reads the existing selected preset gptLearning including old lessons/skills and complete worked/failed examples; ?q searches without ranking. POST records your lesson with ordered actions/settings/reasons/checks, observed outcome, explanation, whenToUse, adaptation, mistakesToAvoid, evidenceRefs and supersedesLessonIds. Reviewed outcomes require reviewEvidence with a retained renderJobId and issued inspections, or failedJobId for an execution failure. Save after reviewed attempts, before handoff and completion. Never overwrite history or apply a recipe automatically.",
  mode === "PRACTICE" ? "- Completion and Practice learning authority are your direct review of the exact final render against Finish. Machine similarity/audio/effect scores cannot decide acceptance or block use of retained preset knowledge. Preserve fidelity as the target; record discrepancies honestly and choose PASS or REVISE." : "- Pro Creation has no Finish. Use all relevant retained preset examples, including failures, and explicitly adapt them to the footage. Review against your designed target.",
  "- Complete requires claimedBy, success, finalSummary and finalReview:{authority:CHATGPT_DIRECT,verdict:PASS|REVISE,renderJobId,renderSha256,remainingIssues:[],checks:{shots,timing,audio,framing,effects,transitions,color},comparisons:[{clipId,renderTimeMs,renderEvidenceId,referenceTimeMs,referenceEvidenceId,observation}]}. Use BROWSE_RENDER to obtain issued inspections from the retained LOCAL_RENDER output. Review every chosen clip. Practice must first save a reviewed worked/failed example in the existing preset. PASS requires no unresolved issues. Numeric scores alone never complete an edit.",
].join("\n");

const applyCurrentProductionQueuePolicy = (message: string, mode: GptOrchestrationModeV1): string => {
  const markerAt = message.indexOf(EDIT_PRODUCTION_CONTINUITY_MARKER_V1);
  const prior = (markerAt < 0 ? message : message.slice(0, markerAt))
    .replace(/PRACTICE_ACCELERATION_CONTINUITY_V[1-3]\nCurrent Practice execution policy for this resumed assignment:\n(?:- .*?(?:\n|$))*/g, "")
    .replace(/Pass each phase before emitting work for the next chronological phase\./g, "");
  // Remove obsolete cached directions, not retained evidence or lessons.
  const obsolete = /(?:compiler-derived|compiled through|compiler semantics|Certification requires|machine[- ]passing|independently re-analyzes|machine-attested|machine transfer gate|certification thresholds|raw-audio confidence|exact-scene confidence|95% similarity floor|QUALITY_GATES_UNCHANGED|PROGRESSIVE FIDELITY FUNNEL|GPT REVIEW COMPRESSION|GLOBAL RESIDUAL SCHEDULER|ANTI_STAGNATION|BOUNDED SCRATCH SEARCH|scratch candidate funnel|32 coarse|winning commit|strongest alternatives|strongest 3|M6 owns|EditFlow Brain\/M6 owns|invoke the M6 reference-fidelity|GPT completion is not Practice mastery|Pro Creation remains blocked|Use only TRANSFER_VERIFIED|Treat only TRANSFER_VERIFIED|frozen TRANSFER_VERIFIED|must re-prove and re-commit|fresh machine binding proof|Final proof authority is unchanged|Keep its distinct existing completion gates|HUMAN_REVIEW_REQUIRED|reference-scored scratch search|residual-priority correction|same.*proof gate|overall machine|95%|machine evidence measures and proves)/i;
  const cleaned = prior.split("\n").filter(line => !(line.startsWith("- ") && obsolete.test(line)) && !/^(?:EDIT_PRODUCTION_QUEUE_POLICY_V|Practice certification policy \(current\):|Current authoritative edit production policy:)/.test(line)).join("\n").trimEnd();
  return cleaned + "\n\n" + editProductionContinuityAppendixV1(mode);
};

export interface GptAppendEventInputV1 {
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
}

export class GptOrchestrationStoreV1 {
  readonly filePath: string;
  static readonly #tails = new Map<string, Promise<void>>();
  #sequence = 0;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async #appendMissingEventsToJournal(events: readonly GptLearningEventV1[]): Promise<void> {
    if (events.length === 0) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const retainedIds = new Set((await readEventJournal(this.filePath)).map((event) => event.eventId));
    const missing = events.filter((event) => !retainedIds.has(event.eventId));
    if (missing.length === 0) return;
    await appendFile(
      eventJournalPathFor(this.filePath),
      missing.map((event) => JSON.stringify(event)).join("\n") + "\n",
      { encoding: "utf8", flush: true },
    );
  }

  async #write(payload: GptOrchestrationStorePayloadV1): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await this.#appendMissingEventsToJournal(payload.events);
    const snapshotPayload: GptOrchestrationStorePayloadV1 = { ...payload, events: [] };
    this.#sequence += 1;
    const temporary = this.filePath + ".tmp-" + String(process.pid) + "-" + String(this.#sequence) + "-" + randomUUID();
    try {
      await writeFile(temporary, JSON.stringify(snapshotPayload, null, 2) + "\n", { encoding: "utf8", flush: true });
      for (let attempt = 0; ; attempt += 1) {
        try {
          await rename(temporary, this.filePath);
          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const locked = process.platform === "win32"
            && ["EPERM", "EACCES", "EBUSY"].includes(code ?? "");
          if (!locked || attempt >= 40) {
            if (locked && error instanceof Error) {
              error.message += " Practice checkpoint was not committed; release the file reader lock and retry the retained assignment.";
            }
            throw error;
          }
          // Preserve atomic readers; retry a bounded Windows sharing violation.
          await new Promise((resolve) => setTimeout(resolve, Math.min(250, 10 * 2 ** attempt)));
        }
      }
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async #mutate<T>(
    operation: (payload: GptOrchestrationStorePayloadV1) =>
      Promise<readonly [GptOrchestrationStorePayloadV1, T]> |
      readonly [GptOrchestrationStorePayloadV1, T],
  ): Promise<T> {
    let output!: T;
    const pending = (GptOrchestrationStoreV1.#tails.get(this.filePath) ?? Promise.resolve()).then(async () => {
      const current = await readStore(this.filePath);
      const [next, value] = await operation(current);
      if (next !== current) await this.#write(next);
      output = value;
    });
    const tail = pending.catch(() => undefined);
    GptOrchestrationStoreV1.#tails.set(this.filePath, tail);
    try { await pending; } finally {
      if (GptOrchestrationStoreV1.#tails.get(this.filePath) === tail) GptOrchestrationStoreV1.#tails.delete(this.filePath);
    }
    return output;
  }

  async createAssignment(input: {
    readonly sessionId: string;
    readonly mode: GptOrchestrationModeV1;
    readonly practiceRole?: PracticeRunRoleV1 | null;
    readonly editTypeId: string;
    readonly finish: PracticeMediaInputV1 | null;
    readonly start: readonly PracticeMediaInputV1[];
    readonly practiceSceneMatches?: readonly PracticeSceneMatchV1[] | null;
    readonly preflight?: PracticePreflightCheckpointV1;
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
    if (input.mode === "PRACTICE") assertDirectChatgptRawSelectionsV1(input.practiceSceneMatches ?? [], input.start);
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
      practiceSceneMatches: input.mode === "PRACTICE"
        ? structuredClone(input.practiceSceneMatches ?? null)
        : null,
      practicePolicy,
      ...(input.preflight === undefined ? {} : { preflight: structuredClone(input.preflight) }),
      artifactDir,
      chatMessage: buildGptOrchestrationChatMessageV1({
        sessionId,
        mode: input.mode,
        practiceRole,
        editTypeId,
        finish: input.finish,
        start: input.start,
        practiceSceneMatches: input.practiceSceneMatches ?? null,
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

  async updatePreflight(
    assignmentId: string,
    preflight: PracticePreflightCheckpointV1,
    matches?: readonly PracticeSceneMatchV1[],
  ): Promise<GptOrchestrationAssignmentV1> {
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (["CANCEL_REQUESTED", "CANCELLED", "COMPLETED", "FAILED"].includes(assignment.status)) return assignment;
      if (assignment.mode === "PRACTICE" && matches !== undefined) {
        assertDirectChatgptRawSelectionsV1(matches, assignment.start);
      }
      return {
        ...assignment,
        preflight: structuredClone(preflight),
        ...(matches === undefined ? {} : { practiceSceneMatches: structuredClone(matches) }),
      };
    });
  }

  async resumeFailedProduction(assignmentId: string): Promise<GptOrchestrationAssignmentV1> {
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (assignment.status !== "FAILED") return assignment;
      return { ...assignment, status: "RUNNING", controllerLease: null, completedAt: null, error: null,
        finalSummary: "Supervisor recovered failed production; retained checkpoints and job receipts require reconciliation." };
    });
  }

  async releaseController(assignmentId: string, owner: string): Promise<GptOrchestrationAssignmentV1> {
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (assignment.controllerLease?.owner !== owner) throw new TypeError("Controller lease owner mismatch.");
      return { ...assignment, controllerLease: null };
    });
  }

  async refreshActiveProductionInstructions(): Promise<number> {
    return await this.#mutate(async (payload) => {
      const raw = JSON.parse(await readFile(this.filePath, "utf8").catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return '{"assignments":[]}';
        throw error;
      })) as GptOrchestrationStorePayloadV1;
      const needsRefresh = new Set(raw.assignments.filter(a => !a.chatMessage.includes(EDIT_PRODUCTION_CONTINUITY_MARKER_V1)).map(a => a.assignmentId));
      let refreshed = 0;
      const assignments = payload.assignments.map((assignment) => {
        if (!["PENDING", "RUNNING", "CANCEL_REQUESTED"].includes(assignment.status)
          || !needsRefresh.has(assignment.assignmentId)) {
          return assignment;
        }
        refreshed += 1;
        return {
          ...assignment,
          chatMessage: applyCurrentProductionQueuePolicy(assignment.chatMessage, assignment.mode),
        };
      });
      return [refreshed === 0 ? payload : { ...payload, assignments }, refreshed] as const;
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
      if (assignment.controllerLease !== undefined && assignment.controllerLease !== null
        && assignment.controllerLease.owner !== controller
        && Date.parse(assignment.controllerLease.expiresAt) > Date.now()) {
        throw new TypeError("Practice controller lease is held by " + assignment.controllerLease.owner + ".");
      }
      const controllerLease = { owner: controller, expiresAt: new Date(Date.now() + 120_000).toISOString() };
      if (assignment.status === "RUNNING" || assignment.status === "CANCEL_REQUESTED") {
        return {
          ...assignment,
          claimedBy: controller,
          controllerLease,
        };
      }
      if (assignment.status !== "PENDING") {
        throw new TypeError("GPT assignment is not resumable: " + assignment.status);
      }
      const now = new Date().toISOString();
      return {
        ...assignment,
        status: "RUNNING",
        claimedAt: now,
        claimedBy: controller,
        controllerLease,
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

  async appendEvent(input: GptAppendEventInputV1): Promise<GptLearningEventV1> {
    return (await this.appendEvents([input]))[0]!;
  }

  async appendEvents(inputs: readonly GptAppendEventInputV1[]): Promise<readonly GptLearningEventV1[]> {
    if (inputs.length === 0 || inputs.length > 64) {
      throw new TypeError("GPT event batch must contain 1-64 entries.");
    }
    let output: readonly GptLearningEventV1[] = [];
    const pending = (GptOrchestrationStoreV1.#tails.get(this.filePath) ?? Promise.resolve()).then(async () => {
      let next = await readStore(this.filePath);
      const events: GptLearningEventV1[] = [];
      for (const input of inputs) {
        const [updated, event] = this.#appendEventToPayload(next, input);
        next = updated;
        events.push(event);
      }
      await this.#appendMissingEventsToJournal(events);
      output = events.map((event) => structuredClone(event));
    });
    const tail = pending.catch(() => undefined);
    GptOrchestrationStoreV1.#tails.set(this.filePath, tail);
    try { await pending; } finally {
      if (GptOrchestrationStoreV1.#tails.get(this.filePath) === tail) GptOrchestrationStoreV1.#tails.delete(this.filePath);
    }
    return output;
  }

  #appendEventToPayload(
    payload: GptOrchestrationStorePayloadV1,
    input: GptAppendEventInputV1,
  ): readonly [GptOrchestrationStorePayloadV1, GptLearningEventV1] {
      const summary = nonEmpty(input.summary, "summary");
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
      if (updated === next[index]) return [payload, structuredClone(updated)] as const;
      next[index] = updated;
      return [{ ...payload, assignments: next }, structuredClone(updated)] as const;
    });
  }
}
