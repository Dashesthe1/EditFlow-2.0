import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EditTypeKnowledgeSnapshotV1, GptAssignmentCompletionV1, GptAssignmentStatusV1, GptCapabilityGapV1, GptLearnedSkillV1, GptLearningEventV1, GptLearningOutcomeV1, GptLearningStageV1, GptOrchestrationAssignmentV1, GptOrchestrationModeV1, GptResearchSourceV1, PracticeMediaInputV1, PracticePreflightCheckpointV1, PracticeSceneMatchV1, PracticeRunRoleV1, PracticeVerificationPolicyV1 } from "./contracts.js";

import { CLIP_RESEARCH_POLICY_V1 } from "./clip-research.js";
import { PRIMARY_PRODUCTION_WORKFLOW_V1, PRODUCTION_WORKFLOW_POLICY_V1 } from "./production-workflow.js";
import { hasVerifiedPracticeSourceIdentityV1 } from "./source-integrity.js";

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
        const practiceRole: PracticeRunRoleV1 | null = assignment.mode === "PRACTICE" ? "LEARNING" : null;
        const currentMessage = assignment.chatMessage;
        const continuityMessage = currentMessage;
        const directMatches = (assignment.practiceSceneMatches ?? []).filter((match) => isDirectChatgptRawSelectionV1(match, assignment.start));
        const discardedLegacy = assignment.mode === "PRACTICE"
          && directMatches.length !== (assignment.practiceSceneMatches ?? []).length;
        const needsDirectPreflight = assignment.mode === "PRACTICE"
          && ["PENDING", "CLAIMED", "RUNNING"].includes(assignment.status)
          && (discardedLegacy || assignment.preflight === undefined);
        return {
          ...assignment,
          primaryWorkflow: PRIMARY_PRODUCTION_WORKFLOW_V1,
          ...(discardedLegacy ? { practiceSceneMatches: directMatches } : {}),
          ...(needsDirectPreflight ? { preflight: { ...assignment.preflight, stage: "AWAITING_CHATGPT_SHOTS" as const,
              updatedAt: new Date().toISOString(), requireTransferNovelty: assignment.preflight?.requireTransferNovelty ?? false,
              completedShotIds: [], unresolvedShotIds: assignment.preflight?.totalShotIds ?? [],
              reasons: ["Select the raw targets you intend to edit. Other unfinished selections do not block already selected targets."], evidenceRefs: [] } } : {}),
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

export const EDITFLOW_TUTORIAL_DRIVE_ROOT_V1 =
  "https://drive.google.com/drive/folders/1eP2O7OwoCL1uP3OaA4euewUAZFU-VsL7";
export const EDITFLOW_EFFECT_TUTORIALS_FOLDER_V1 =
  "https://drive.google.com/drive/folders/183rOt8jpMghRA3Gtu-ZKxZ2NSkJF5S-G";
export const EDITFLOW_MUSIC_BEAT_TUTORIALS_FOLDER_V1 =
  "https://drive.google.com/drive/folders/19RI8JpZQvmD7R5_4Ub1E_JBodcx7MtGZ";

const RESEARCH_PRIORITY_LINES = [
  "- Research only unfamiliar or changed techniques. Known constructions and explicitly chosen notebook recipes can be applied directly without a new per-clip research plan. For new research use Tutorial Drive, then Adobe resources, then web.",
  "- Search the Tutorial Drive for the closest matching behavior or technique before consulting any external source. Primary folders: Adobe Effect Tutorials (" + EDITFLOW_EFFECT_TUTORIALS_FOLDER_V1 + ") and Adobe Effect Music + Beat Tutorials (" + EDITFLOW_MUSIC_BEAT_TUTORIALS_FOLDER_V1 + "). Root: " + EDITFLOW_TUTORIAL_DRIVE_ROOT_V1 + ".",
  "- Use the matching tutorial video or videos to retain a structured technique record: WHAT the visible behavior is, WHEN/WHY it is used, HOW it is constructed in After Effects, ACCESS requirements, the PROOF needed to verify it, and TRANSFER rules for adapting it to new footage. Do not copy literal tutorial values as the lesson.",
  "- ChatGPT directly studies the tutorial and chooses its construction, exact settings, invariants, adaptation and troubleshooting. Record those decisions as explicit clip-research SOURCE steps with authority:CHATGPT_DIRECT and reviewed worked examples. Machine tutorial compilation is retired from production.",
  "- Preserve tutorial provenance and actual AE render/readback checks. Retain successes and failures in the selected preset's existing practice-notebook; no machine skill promotion or automatic recipe application.",
  "- If no sufficiently relevant Tutorial Drive match exists, record the Tutorial Drive search/query and no-match result in RESEARCH provenance before escalating.",
  "- Second priority is official Adobe documentation/resources and the installed Adobe feature/plugin surface.",
  "- Third priority is external professional tutorials and plugin/vendor documentation; broader web/internet research is last.",
] as const;

export const CHATGPT_FOOTAGE_POLICY_V1 = [
  "CHATGPT DIRECT RAW FOOTAGE SELECTION V1",
  "ChatGPT alone inspects raw footage and chooses exact scenes/shots. The old raw-shot candidate generator, visual matching/ranking and automated selection are removed from production; never invoke them or treat their cached matches as choices.",
  "Read GET /v1/product/gpt/assignments/{id}/footage-selection and its contract. POST BROWSE with the current claimedBy, mediaId and your explicit timesMs; open its timestamped contact sheets and individual frames. POST SELECT to retain your exact ranges, direction, temporal comparisons, confidence and rationale. Resume prior GPT choices and inspection receipts.",
  "For unfinished Practice source discovery, use the user-authorized EditFlow Source Match Service first: start_source_match {requestId,assignmentId,referencePath,sourcePaths,budgetSeconds:480,shots?:[{start,end}]}. Poll the retained job; do not resubmit or repeat the movie search. Resume includes sourceMatch.retained and both service contracts. Machine frame correspondences are requested measurements, not editorial selections or GPT PASS.",
  "Inspect the batched reference/raw frame evidence. For partial results use refine_source_match {requestId,jobId,shotIds,windows?:[{shotId,sourceIndex,start,end}],budgetSeconds}. It retains other shots and checks chosen locations at higher resolution. Use scene/dialogue/script/chapter clues and direct BROWSE for remaining misses. Web timestamps are clues, never proof or replacement footage. Black or occluded boundary identity may be impossible to measure; report that uncertainty rather than invent an exact timestamp.",
  "Choose efficient strategies yourself: broad chronological contact sheets, scene/context/dialogue clues, interval narrowing, adjacent-scene inspection, cached low-resolution views, dense gesture and boundary sampling, then exact-frame comparisons. You decide which timestamps to inspect; helpers only decode, timestamp, cache and extract what you request, never propose/rank shots. Preserve coverage notes across handoffs and change strategy when a search is unproductive.",
  "Compare at least three distinct Finish/raw moments across every selected shot, including framing, subject identity, pose/action and temporal direction. Retain the comparisons with actual issued inspection evidence IDs; never invent geometric measurements or claim a machine score proves your choice. Materialize only your selected raw ranges with bounded handles before AE assembly.",
  "After all exact endpoints are verified and directly reviewed, PREPARE_ASSEMBLY saves official timestamps and cuts original-footage ranges; poll the retained assemblyId, then ASSEMBLY_PLAN and enqueue its unchanged AE_TRANSACTION payload with the current issued researchContext. This is the standard Practice handoff. Preserve Finished shot order, create a new comp, inspect the checkpoint, then choose retiming/effects explicitly. Neither service resumes paused production. Keep the same assignment and AE open.",
].join("\n");

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

const isTutorialDriveFolderSearch = (source: GptResearchSourceV1 | undefined): boolean =>
  isTutorialDriveResearchSource(source)
  && typeof source?.uri === "string"
  && /^https:\/\/drive\.google\.com\/drive\/folders\//.test(source.uri.trim());

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
  const message = [
    "EDITFLOW 2.0 GPT ORCHESTRATION ASSIGNMENT",
    "Session: " + input.sessionId, "Mode: " + input.mode, "Edit Type: " + input.editTypeId,
    "Practice role: " + (input.practiceRole ?? "LEARNING"),
    input.mode === "PRACTICE" ? "Study the actual Finish and reconstruct it from the provided raw media in After Effects." : "Design an original edit from the provided raw media using the chosen preset and direct render review.",
    "Finish path: " + (input.finish?.uri ?? "(none)"),
    "Editing sequence: RESUME ONCE -> THINK -> AE BATCH -> INSPECT -> CORRECT. Build the whole edit, then polish; learn at meaningful review boundaries.",
    "Finish: " + JSON.stringify(input.finish), "Provided raw media: " + JSON.stringify(input.start),
    "Retained GPT source choices and visual decisions: included in the current resume response; retrieve details only for a current question.",
    "Evidence directory: " + input.artifactDir,
    "Preset learning: resume includes a compact index. Retrieve a chosen complete method or relevant failure on demand; never replay the entire notebook at startup.",
    ...RESEARCH_PRIORITY_LINES, CLIP_RESEARCH_POLICY_V1,
    "Keep one AE writer, keep AE open, preserve correct retained work, and build whole-edit coverage before polishing deficient regions.",
    "Full raw movies are search-only. Materialize your selected ranges with bounded handles for AE; Finish remains a reference and must never become production footage.",
    "Directly inspect reference shots, cut boundaries, effect states, audio relationships and source traversal. Retain concise visual conclusions at meaningful pass boundaries.",
    "All cutting, retiming, effects, transitions and compositing must be constructed in AE from your explicit decisions. Research unfamiliar behavior rather than replacing it with a weaker approximation.",
  ].join("\n");
  return applyCurrentProductionQueuePolicy(message, input.mode);
};

const EDIT_PRODUCTION_CONTINUITY_MARKER_V1 = "CHATGPT_DIRECT_EDITORIAL_AUTHORITY_V1";
const editProductionContinuityAppendixV1 = (mode: GptOrchestrationModeV1) => [
  EDIT_PRODUCTION_CONTINUITY_MARKER_V1,
  "RETIRED_EDIT_ENGINES_REMOVED_V1",
  "Current exclusive editorial authority:",
  PRODUCTION_WORKFLOW_POLICY_V1,
  "- ChatGPT directly decides reference duration/cuts, footage, audio arrangement, timing/retiming, framing, effects, transitions, construction, corrections, candidate selection, next steps and final acceptance. Automatic creative analysis, formula pulses, baseline generation, scoring/ranking/pruning, machine certification and local-Qwen creative/UI decisions are retired from production.",
  "- Helpers execute your explicit operations or return requested raw observations. Native tracking/roto/optical flow are allowed only when you explicitly choose the target, method and settings and then review the output; no automatic backend or recipe fallback.",
  "- Resume the retained assignment, preserve correct retained work and reconcile actual AE state. Submit every AE action through production-jobs on the sole durable writer. Preserve receipts on timeout; never replay interrupted writes blindly or use retired routes.",
  "- Every job payload requires editorialDecision:{authority:CHATGPT_DIRECT,decisionId,rationale,evidenceRefs:[...],steps:[...]}. Its immutable receipt binds the exact payload hash. Changed plans need new decisionIds. Include the current researchContext/controller credential.",
  "- BUILD_BASELINE requires plan containing exact AE transaction operations. AE_GOAL accepts only SHORT_HORIZON with exact intents or REFRAME with explicit values; automatic pulse goals are rejected. PROOF_SCRIPT requires scriptSha256 of the reviewed script with your explicit editing settings.",
  "- REFERENCE_ANALYSIS decodes only your chosen Finish timesMs inside a bounded window. Use footage-selection BROWSE for wider contact sheets and DEFINE_REFERENCE for explicit durationMs and continuous shots [{shotId,order,referenceStartMs,referenceEndMs,observation,inspections:[{evidenceId,timeMs}]}], authority:CHATGPT_DIRECT and rationale. No automatic cut/tail detector is used.",
  "- For unfinished Practice source discovery use EditFlow Source Match Service, resume its retained job and refine only unresolved shots. Inspect actual provided pixels and SELECT exact ranges with rationale and issued comparison anchors. Complete endpoint verification and GPT review lead directly to Source Assembly through the normal durable AE queue. Preserve retained source choices; never redo accepted discovery or replace uncertainty with extrapolated timestamps.",
  "- SCRATCH_SEARCH renders every candidate in supplied order at its explicit resolutionScale (default full), without scoring, pruning or selecting a winner. Review the actual alternatives yourself and submit a separate explicit canonical commit. Machines must never decide which alternatives you see.",
  "- Production telemetry and residual measurements are observations. Choose the correction order and strategy yourself. Scheduling, file integrity, leases and execution safety checks are mechanical, not editorial decisions.",
  "- GET assignments/{id}/practice-notebook reads the existing selected preset gptLearning including old lessons/skills and complete worked/failed examples; ?q searches without ranking. POST records your lesson with ordered actions/settings/reasons/checks, observed outcome, explanation, whenToUse, adaptation, mistakesToAvoid, evidenceRefs and supersedesLessonIds. Reviewed outcomes require reviewEvidence with a retained renderJobId and issued inspections, or failedJobId for an execution failure. Save after reviewed attempts, before handoff and completion. Never overwrite history or apply a recipe automatically.",
  mode === "PRACTICE" ? "- Completion and Practice learning authority are your direct review of the exact final render against Finish. Machine similarity/audio/effect scores cannot decide acceptance or block use of retained preset knowledge. Preserve fidelity as the target; record discrepancies honestly and choose PASS or REVISE." : "- Pro Creation has no Finish. Use all relevant retained preset examples, including failures, and explicitly adapt them to the footage. Review against your designed target.",
  "- Complete requires claimedBy, success, finalSummary and finalReview:{authority:CHATGPT_DIRECT,verdict:PASS|REVISE,renderJobId,renderSha256,remainingIssues:[],checks:{shots,timing,audio,framing,effects,transitions,color},comparisons:[{clipId,renderTimeMs,renderEvidenceId,referenceTimeMs,referenceEvidenceId,observation}]}. Use BROWSE_RENDER to obtain issued inspections from the retained LOCAL_RENDER output. Review every chosen clip. Practice must first save a reviewed worked/failed example in the existing preset. PASS requires no unresolved issues. Numeric scores alone never complete an edit.",
].join("\n");

const applyCurrentProductionQueuePolicy = (message: string, mode: GptOrchestrationModeV1): string => {
  const markerAt = message.indexOf(EDIT_PRODUCTION_CONTINUITY_MARKER_V1);
  const retiredAt = message.search(/\n(?:Primary edit production system|Original M6 workflow|Practice reference-fidelity policy|EDIT_PRODUCTION_QUEUE_POLICY_V[1-4]|PRACTICE_ACCELERATION_CONTINUITY_V)/);
  const end = Math.min(...[markerAt, retiredAt, message.length].filter(v => v >= 0));
  const obsolete = /M6|VisualEffectsBrain|compiler[- ]backed|compiled through|machine[- ]passing|machine[- ]verified|machine[- ]attested|TRANSFER_VERIFIED_ONLY|HELD_OUT_CERTIFICATION|certification thresholds|candidate funnel|retained truth|advanced synthesis|GPT completion is not Practice mastery|ACCELERATED_REFERENCE_FIRST_V1|Optional workflowContext|MANDATORY PER-CLIP|before changing any clip|For EVERY clip|editing EVERY clip|READY plans|Commit clip-research PLAN|AE edits require researchContext|Record the actual search\/review artifact|Learning sequence:|commit the durable clip research plan/i;
  const generatedLines = new Set([...CHATGPT_FOOTAGE_POLICY_V1.split("\n"), ...RESEARCH_PRIORITY_LINES]);
  const retiredFootagePolicy = /^(For footage discovery, primarily use internet research:|AWAITING_CHATGPT_SHOTS requires direct footage work now, not polling an algorithm\.)/;
  const cleaned = message.slice(0, end).split("\n").filter(line => !obsolete.test(line) && !retiredFootagePolicy.test(line) && !generatedLines.has(line)
    && !line.includes("Record your blueprint before construction")).join("\n").trimEnd();
  return cleaned + "\n\n" + CHATGPT_FOOTAGE_POLICY_V1 + "\n\n" + RESEARCH_PRIORITY_LINES.join("\n") + "\n\n" + editProductionContinuityAppendixV1(mode);
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
    if (input.practiceRole === "HELD_OUT_CERTIFICATION") throw new TypeError("Machine certification roles are retired.");
    const practiceRole: PracticeRunRoleV1 | null = input.mode === "PRACTICE" ? "LEARNING" : null;
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
      primaryWorkflow: PRIMARY_PRODUCTION_WORKFLOW_V1,
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
      const needsRefresh = new Set(raw.assignments.filter(a => a.primaryWorkflow !== PRIMARY_PRODUCTION_WORKFLOW_V1
        || a.chatMessage !== payload.assignments.find(current => current.assignmentId === a.assignmentId)?.chatMessage).map(a => a.assignmentId));
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

  /** Refresh an existing claim only after the gateway validates the current generation.
   * An expired timestamp cannot revoke an otherwise live supervised worker.
   * This never acquires a missing claim or changes its owner.
   */
  async renewController(assignmentId: string, claimedBy: string): Promise<GptOrchestrationAssignmentV1> {
    const controller = nonEmpty(claimedBy, "claimedBy");
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (!["RUNNING", "CANCEL_REQUESTED"].includes(assignment.status)
        || assignment.claimedBy !== controller || assignment.controllerLease?.owner !== controller) {
        throw new TypeError("CONTROLLER_CLAIM_REQUIRED: renewal requires an existing claim by this worker.");
      }
      return { ...assignment, controllerLease: { owner: controller, expiresAt: new Date(Date.now() + 120_000).toISOString() } };
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
      if (input.stage === "SKILL_COMMIT" || input.learnedSkill !== undefined) throw new TypeError("MACHINE_SKILL_PROMOTION_RETIRED: save directly reviewed worked examples in practice-notebook.");
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
          if (source.tutorialCompilation !== undefined) throw new TypeError("Tutorial compiler removed; record your directly analyzed technique.");
          if (isTutorialDriveResearchSource(source)
            && !isTutorialDriveFolderSearch(source)
            && !hasStructuredTutorialTechnique(source)) {
            throw new TypeError(
              "A matched Tutorial Drive tutorial must retain WHAT, WHEN/WHY, HOW, ACCESS, PROOF, and TRANSFER technique fields before it can support Practice learning.",
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
        if (!priorImplementation) {
          throw new TypeError(
            "CAPABILITY_PROOF requires a prior CAPABILITY_IMPLEMENTATION event for the same capability gap.",
          );
        }
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
