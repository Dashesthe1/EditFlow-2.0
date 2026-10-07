import { assertExplicitEditorialPayloadV1 } from "../../adapters/ae-cep/src/explicit-editorial-payload.js";
import { createHash } from "node:crypto";

/** This module retains GPT decisions and checks their mechanics. It never proposes an edit. */
type Packet = Record<string, any>;
export const PRIMARY_PRODUCTION_WORKFLOW_V1 = "CHATGPT_PRODUCTION_WORKFLOW_V1";
export const PRIMARY_WORKFLOW_ROUTING_V1 = {
  primaryWorkflow: PRIMARY_PRODUCTION_WORKFLOW_V1,
  availableWorkflows: [PRIMARY_PRODUCTION_WORKFLOW_V1],
  workflowSelectionAllowed: false,
  workflowFallback: false,
} as const;
const required = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new TypeError(name + " is required.");
  return v.trim();
};
const array = (v: unknown, name: string, nonempty = false): any[] => {
  if (!Array.isArray(v) || nonempty && !v.length) throw new TypeError(name + " must be an array.");
  return v;
};
const texts = (v: unknown, name: string, nonempty = false): string[] => array(v, name, nonempty).map(x => required(x, name));
const number = (v: unknown, name: string, min = 0): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) throw new TypeError(name + " must be finite and >= " + min);
  return v;
};
const unique = (items: readonly string[], name: string): void => {
  if (new Set(items).size !== items.length) throw new TypeError(name + " contains duplicate identities.");
};
const object = (v: unknown, name: string): Packet => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new TypeError(name + " must be an object.");
  return structuredClone(v);
};
export const workflowHashV1 = (v: unknown): string => {
  const canonical = (x: any): any => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object"
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  return createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
};
const decision = (p: Packet): void => {
  if (p.authority !== "CHATGPT_DIRECT") throw new TypeError("CHATGPT_DIRECT_REQUIRED: workflow choices belong to ChatGPT.");
  required(p.decisionId, "decisionId"); required(p.rationale, "rationale");
  texts(p.evidenceRefs, "evidenceRefs", true); assertExplicitEditorialPayloadV1(p);
};

export interface ProductionWorkflowPlanV1 {
  readonly authority: "CHATGPT_DIRECT";
  readonly decisionId: string;
  readonly rationale: string;
  readonly evidenceRefs: readonly string[];
  readonly mode: "REPEAT_PRODUCTION" | "METHOD_LEARNING";
  readonly scope: string;
  readonly output: Readonly<{ width: number; height: number; fps: number; durationMs: number }>;
  readonly passOrder: readonly string[];
  readonly sources: readonly Packet[];
  readonly audio: Packet;
  readonly anchors: readonly Packet[];
  readonly events: readonly Packet[];
  readonly finishing: readonly string[];
  readonly nextAction: string;
}

export const parseProductionWorkflowPlanV1 = (input: Packet): ProductionWorkflowPlanV1 => {
  decision(input);
  if (!["REPEAT_PRODUCTION", "METHOD_LEARNING"].includes(input.mode)) throw new TypeError("Choose production or method learning explicitly.");
  const output = { width: number(input.output?.width, "width", 1), height: number(input.output?.height, "height", 1),
    fps: number(input.output?.fps, "fps", .001), durationMs: number(input.output?.durationMs, "durationMs", .001) };
  const sources = array(input.sources, "sources", true).map(s => {
    const source = object(s, "source");
    required(source.clipId, "source.clipId"); required(source.mediaId, "source.mediaId"); required(source.fingerprint, "source.fingerprint");
    number(source.fps, "source.fps", .001);
    const startMs = number(source.startMs, "source.startMs"), endMs = number(source.endMs, "source.endMs");
    if (endMs <= startMs) throw new TypeError("Source range must increase.");
    const availableStartMs = number(source.availableStartMs, "availableStartMs"), availableEndMs = number(source.availableEndMs, "availableEndMs");
    if (availableStartMs > startMs || availableEndMs < endMs) throw new TypeError("Source handles must contain the selected range.");
    for (const a of array(source.actionAnchors, "actionAnchors")) {
      required(a.id, "action anchor id"); const t = number(a.sourceMs, "action sourceMs");
      if (t < availableStartMs || t > availableEndMs) throw new TypeError("Action anchor exceeds source handles.");
      required(a.observation, "action observation");
    }
    return source;
  });
  unique(sources.map(s => s.clipId), "source clipIds");
  const anchors = array(input.anchors, "anchors", true).map(a => {
    const anchor = object(a, "anchor"); required(anchor.id, "anchor.id"); required(anchor.role, "anchor.role");
    required(anchor.rationale, "anchor.rationale");
    if (number(anchor.outputMs, "anchor.outputMs") > output.durationMs) throw new TypeError("Output anchor exceeds duration.");
    return anchor;
  });
  unique(anchors.map(a => a.id), "anchors");
  const events = array(input.events, "events", true).map(e => {
    const event = object(e, "event"); required(event.id, "event.id");
    if (texts(event.clipIds, "event.clipIds", true).some(id => !sources.some(s => s.clipId === id))) throw new TypeError("Unknown event clip binding.");
    if (texts(event.anchorIds, "event.anchorIds", true).some(id => !anchors.some(a => a.id === id))) throw new TypeError("Unknown event anchor binding.");
    required(event.treatment, "event.treatment"); texts(event.acceptedDimensions, "event.acceptedDimensions");
    texts(event.unresolvedIssues, "event.unresolvedIssues"); return event;
  });
  unique(events.map(e => e.id), "events");
  const audio = object(input.audio, "audio"); required(audio.mediaId, "audio.mediaId"); number(audio.songOffsetMs, "songOffsetMs");
  required(audio.policy, "audio.policy");
  const passOrder = texts(input.passOrder, "passOrder", true); unique(passOrder, "passOrder");
  return { authority: "CHATGPT_DIRECT", decisionId: input.decisionId, rationale: input.rationale, evidenceRefs: input.evidenceRefs,
    mode: input.mode, scope: required(input.scope, "scope"), output, passOrder, sources, audio, anchors, events,
    finishing: texts(input.finishing, "finishing"), nextAction: required(input.nextAction, "nextAction") };
};

/** Complete exact craft lives inside the existing worked example, never a competing skill store. */
export interface ProductionMethodV1 {
  readonly schema: "editflow.production-method.v1";
  readonly family: string;
  readonly sourceBindings: readonly Packet[];
  readonly containers: readonly Packet[];
  readonly anchors: readonly Packet[];
  readonly channels: readonly Packet[];
  readonly effects: readonly Packet[];
  readonly dependencies: readonly Packet[];
  readonly adaptationChecks: readonly string[];
  readonly failureSymptoms: readonly string[];
}
export const parseProductionMethodV1 = (input: Packet): ProductionMethodV1 => {
  if (input.schema !== "editflow.production-method.v1") throw new TypeError("Unsupported production method schema.");
  assertExplicitEditorialPayloadV1(input);
  const sourceBindings = array(input.sourceBindings, "sourceBindings", true).map(s => {
    const source = object(s, "sourceBinding"); required(source.id, "sourceBinding.id"); required(source.mediaId, "sourceBinding.mediaId");
    required(source.fingerprint, "sourceBinding.fingerprint"); number(source.fps, "sourceBinding.fps", .001);
    const lo = number(source.availableStartMs, "availableStartMs"), hi = number(source.availableEndMs, "availableEndMs");
    if (hi <= lo) throw new TypeError("Invalid source handles.");
    for (const sample of array(source.traversal, "traversal", true)) {
      number(sample.outputMs, "traversal.outputMs"); const t = number(sample.sourceMs, "traversal.sourceMs");
      if (t < lo || t > hi) throw new TypeError("Retimed source traversal exceeds handles.");
    }
    return source;
  });
  unique(sourceBindings.map(s => s.id), "sourceBindings");
  const containers = array(input.containers, "containers", true).map(c => {
    const container = object(c, "container"); required(container.id, "container.id");
    number(container.width, "container.width", 1); number(container.height, "container.height", 1);
    number(container.fps, "container.fps", .001); number(container.timeOriginMs, "timeOriginMs", -Number.MAX_VALUE);
    if (!["2D", "3D"].includes(container.space)) throw new TypeError("Container space must be 2D or 3D.");
    if (container.parentId !== null) required(container.parentId, "parentId"); return container;
  });
  unique(containers.map(c => c.id), "containers"); const ids = new Set(containers.map(c => c.id));
  for (const c of containers) {
    const visited = new Set([c.id]); let parent = c.parentId;
    while (parent !== null) {
      if (!ids.has(parent) || visited.has(parent)) throw new TypeError("Invalid or cyclic parent identity.");
      visited.add(parent); parent = containers.find(n => n.id === parent)!.parentId;
    }
  }
  const anchors = array(input.anchors, "method anchors", true).map(a => {
    const anchor = object(a, "method anchor"); required(anchor.id, "anchor.id"); number(anchor.outputMs, "anchor.outputMs"); return anchor;
  }); unique(anchors.map(a => a.id), "method anchors");
  const channels = array(input.channels, "channels").map(ch => {
    const channel = object(ch, "channel"); required(channel.id, "channel.id");
    if (!ids.has(channel.containerId)) throw new TypeError("Unknown channel container.");
    required(channel.property, "channel.property"); required(channel.role, "channel.role"); required(channel.coordinateSpace, "channel.coordinateSpace");
    let prior = -Infinity;
    for (const key of array(channel.keys, "channel.keys", true)) {
      const time = number(key.timeMs, "key.timeMs", -Number.MAX_VALUE);
      if (time <= prior) throw new TypeError("Channel keys must have increasing times."); prior = time;
      if (!("value" in key)) throw new TypeError("Each key needs an explicit value.");
      object(key.interpolation, "key.interpolation");
      if (!anchors.some(a => a.id === key.anchorId)) throw new TypeError("Unknown key anchor.");
    }
    return channel;
  }); unique(channels.map(c => c.id), "channels");
  const effects = array(input.effects, "effects").map(e => {
    const effect = object(e, "effect"); required(effect.id, "effect.id"); required(effect.matchName, "effect.matchName");
    required(effect.version, "effect.version");
    if (!ids.has(effect.containerId)) throw new TypeError("Unknown effect container.");
    if (!Number.isInteger(number(effect.order, "effect.order"))) throw new TypeError("Effect order must be an integer.");
    object(effect.settings, "effect.settings"); return effect;
  }); unique(effects.map(e => e.id), "effects");
  unique([...sourceBindings, ...containers, ...effects].map(item => item.id), "method identities");
  unique(effects.map(e => e.containerId + ":" + e.order), "effect stack positions");
  const dependencies = array(input.dependencies, "dependencies").map(d => {
    const dependency = object(d, "dependency"); required(dependency.ownerId, "dependency.ownerId");
    required(dependency.property, "dependency.property"); required(dependency.targetId, "dependency.targetId");
    required(dependency.kind, "dependency.kind"); required(dependency.check, "dependency.check");
    if (![...ids, ...effects.map(e => e.id)].includes(dependency.ownerId)
      || ![...ids, ...sourceBindings.map(s => s.id)].includes(dependency.targetId)) throw new TypeError("Unresolved method dependency identity.");
    return dependency;
  });
  return { schema: "editflow.production-method.v1", family: required(input.family, "family"), sourceBindings, containers, anchors, channels,
    effects, dependencies, adaptationChecks: texts(input.adaptationChecks, "adaptationChecks", true), failureSymptoms: texts(input.failureSymptoms, "failureSymptoms") };
};

export interface ProductionWorkflowStateV1 {
  readonly plans: readonly { readonly plan: ProductionWorkflowPlanV1; readonly hash: string }[];
  readonly activeDecisionId: string | null;
  readonly reviews: readonly Packet[];
  readonly milestones: readonly Packet[];
}
export const emptyProductionWorkflowV1 = (): ProductionWorkflowStateV1 => ({ plans: [], activeDecisionId: null, reviews: [], milestones: [] });
export const retainProductionWorkflowPlanV1 = (state: ProductionWorkflowStateV1, input: Packet): ProductionWorkflowStateV1 => {
  const plan = parseProductionWorkflowPlanV1(input), hash = workflowHashV1(plan);
  const prior = state.plans.find(p => p.plan.decisionId === plan.decisionId);
  if (prior && prior.hash !== hash) throw new TypeError("WORKFLOW_DECISION_CHANGED: create a new decisionId; preserve history.");
  return { ...state, plans: prior ? state.plans : [...state.plans, { plan, hash }], activeDecisionId: plan.decisionId };
};
export const retainProductionWorkflowReviewV1 = (state: ProductionWorkflowStateV1, input: Packet): ProductionWorkflowStateV1 => {
  decision(input); const selected = state.plans.find(p => p.plan.decisionId === input.planDecisionId);
  if (!selected || !selected.plan.events.some(e => e.id === input.eventId)) throw new TypeError("Review requires a retained event and plan.");
  if (!["PASS", "REVISE"].includes(input.verdict)) throw new TypeError("Only ChatGPT supplies PASS or REVISE.");
  texts(input.dimensions, "review dimensions", true); const issues = texts(input.remainingIssues, "remainingIssues");
  if (input.verdict === "PASS" && issues.length) throw new TypeError("Unresolved dimensions cannot pass.");
  required(input.renderJobId, "renderJobId"); required(input.constructionDecisionId, "constructionDecisionId");
  required(input.observation, "observation"); required(input.nextAction, "nextAction");
  const review = structuredClone(input); const prior = state.reviews.find(r => r.decisionId === review.decisionId);
  if (prior && workflowHashV1(prior) !== workflowHashV1(review)) throw new TypeError("Review decisions are immutable.");
  return prior ? state : { ...state, reviews: [...state.reviews, review] };
};
export const validateWorkflowJobV1 = (state: ProductionWorkflowStateV1, payload: Packet,
  options: { kind?: string; acceptedReceipt?: boolean; acceptedLegacyReceipt?: boolean } = {}): void => {
  // Compatibility is granted by the server's pre-rollout durable receipt IDs,
  // never by a client flag. It cannot admit another new legacy job.
  const c = payload.workflowContext;
  // The sole workflow is implicit. Its separate plan is optional supporting memory.
  // Routing metadata never needs a separate GPT approval round trip.
  if (!c) {
    if (!options.acceptedLegacyReceipt && (payload.legacy || payload.acceptedLegacyReceipt)) throw new TypeError("PRIMARY_WORKFLOW_REQUIRED: client legacy flags cannot select another workflow.");
    return;
  }
  if (!c || c.workflowId !== PRIMARY_PRODUCTION_WORKFLOW_V1 && !(options.acceptedLegacyReceipt && c.workflowId === undefined)) {
    throw new TypeError("PRIMARY_WORKFLOW_REQUIRED: use CHATGPT_PRODUCTION_WORKFLOW_V1.");
  }
  if (c.phase === "DIRECT") {
    if (c.planDecisionId !== undefined || c.planHash !== undefined || c.eventIds !== undefined) throw new TypeError("DIRECT uses the exact job decision; omit separate plan bindings.");
    return;
  }
  if (c.phase === "PREPARATION") {
    if (options.kind !== "REFERENCE_ANALYSIS") throw new TypeError("WORKFLOW_PREPARATION_ONLY: preparation context cannot authorize AE production.");
    if (c.planDecisionId !== undefined || c.planHash !== undefined || c.eventIds !== undefined) throw new TypeError("Choose preparation or a retained production plan explicitly.");
    return;
  }
  const selected = state.plans.find(p => p.plan.decisionId === c.planDecisionId);
  if (!selected || selected.hash !== c.planHash) throw new TypeError("WORKFLOW_PLAN_MISMATCH");
  if (!options.acceptedReceipt && state.activeDecisionId !== c.planDecisionId) throw new TypeError("WORKFLOW_PLAN_SUPERSEDED: new jobs require the current ChatGPT plan.");
  const eventIds = texts(c.eventIds, "workflow eventIds", true);
  if (eventIds.some(id => !selected.plan.events.some(e => e.id === id))) throw new TypeError("Unknown workflow event.");
  const clipIds = new Set(selected.plan.events.filter(e => eventIds.includes(e.id)).flatMap(e => e.clipIds));
  if ((payload.researchContext?.plans ?? []).some((p: Packet) => !clipIds.has(p.clipId))) throw new TypeError("Job exceeds the chosen workflow event scope.");
};
export const validateMethodApplicationV1 = (examples: readonly Packet[], applications: unknown): void => {
  for (const app of array(applications, "methodApplications")) {
    decision(app);
    const example = examples.find(e => e.lessonId === app.lessonId);
    if (!example || example.outcome !== "WORKED" || examples.some(e => e.supersedesLessonIds?.includes(app.lessonId))) throw new TypeError("Choose a current WORKED example explicitly; failures remain research context.");
    if (!example.method) throw new TypeError("Legacy example needs a complete method before dependency-checked reuse.");
    const method = parseProductionMethodV1(example.method);
    const bindings = array(app.bindings, "application bindings", true);
    const requiredIds = [...method.sourceBindings, ...method.containers, ...method.effects].map(x => x.id);
    if (requiredIds.some(id => !bindings.some(b => b.fromId === id && typeof b.toId === "string" && b.toId.trim()))) throw new TypeError("Rebind every source, container and effect identity explicitly.");
    unique(bindings.map(b => b.fromId), "application binding origins");
    unique(bindings.map(b => b.toId), "application binding targets");
    texts(app.adaptationChecks, "application adaptationChecks", true);
    // The adapted method retains exact keys/curves/settings; this validator changes none.
    const adapted = parseProductionMethodV1(app.adaptedMethod);
    const targetIds = [...adapted.sourceBindings, ...adapted.containers, ...adapted.effects].map(x => x.id);
    if (bindings.some(b => !requiredIds.includes(b.fromId) || !targetIds.includes(b.toId)) || targetIds.length !== requiredIds.length) throw new TypeError("Adapted method must use the explicit rebound identities.");
    for (const dep of method.dependencies) {
      const ownerId = bindings.find(b => b.fromId === dep.ownerId)!.toId;
      const targetId = bindings.find(b => b.fromId === dep.targetId)!.toId;
      if (!adapted.dependencies.some(d => d.ownerId === ownerId && d.targetId === targetId && d.property === dep.property && d.kind === dep.kind)) throw new TypeError("Copied method dependency was not rebound; choose a new construction explicitly.");
    }
  }
};

export const PRODUCTION_WORKFLOW_POLICY_V1 = [
  "VISUAL_CONTINUITY_V1: resume returns current accepted dimensions, unfinished issues, rejected alternatives and matching renders. Preserve accepted dimensions until current pixels prove a defect. Settle temporal source identity across synchronized timestamps before crop/grade. After two distinct failed renders of the same issue, reconsider the hypothesis or compare deliberately different GPT-chosen alternatives; no hard budget, approval or worker replacement follows.",
  "At meaningful review boundaries record VISUAL_REVIEW via record_production_update, or attach visualReview to the next production job payload. review:{authority:CHATGPT_DIRECT,reviewId,renderJobId,observations:[{clipId,dimensions:[source|timing|framing|effects|transitions|color|text|audio],verdict:PASS|REVISE|REJECTED,observation,hypothesis?,settings?,comparisons:[{renderTimeMs,renderEvidenceId,referenceTimeMs,referenceEvidenceId}]}]}. Record precise settings and rejected alternatives, not another task backlog. Temporal PASS spans beginning/middle/end. renderTimeMs is rendered-file time; add compositionTimeOriginMs from BROWSE_RENDER for referenceTimeMs. No plan, research record or per-shot approval is needed. Machines retain/invalidate evidence only; GPT alone chooses and accepts.",
  "Render reuse is the default, including final renders across workers. forceRender:true without forceRenderReason no longer bypasses an intact matching cache. A genuinely required independent rerender may supply an explicit reason. Changed revision/environment/interval/resolution or damaged output already invalidates reuse. Reused pixels still require direct review.",
  "Finishing: review the current whole edit, collect material defects together, correct them in coherent batches, inspect affected ranges, then perform final full-resolution audiovisual review. Do not reopen accepted dimensions for taste changes. Persist concise judgments with the review/next edit and complete after the successful final review; keep full history on demand.",
  "CHATGPT_PRODUCTION_WORKFLOW_V1 is the sole primary workflow for PRACTICE and PRO_CREATION. No workflow selector, older route or automatic fallback exists; ChatGPT alone makes every editorial decision.",
  "ONE_CALL_RESUME_V1: claim_gpt_assignment returns the retained assignment, AE state, jobs, checkpoint, raw selections and current notebook in one response. Read once; no separate tool-inventory preflight, repeated assignment reads or separate controller/reconciliation checklist is required.",
  "DIRECT_EDITING_RESULTS_V1: Routine edit submission returns completion/readbacks/current state/checkpoint in one call. Resume/jobs are compact; read complete retained jobs by ID or includeHistory only for audits. Use AE_BATCH for supported text, solid, effect/property/keyframe/expression, comp and layer edits. Host preflight is internal and read-only. Never require ChatGPT to manage it. Use READ_PROPERTY for exact property state; opaque scripts are reserved for genuinely unsupported operations and still require actual reconciliation.",
  "PREVIEW_REUSE_V1: LOCAL_RENDER accepts exact frameTimesMs for still questions or startMs/endMs for motion/audio. Cache identity includes observed AE revision, environment, comp, interval and resolution; forceRender:true with forceRenderReason bypasses reuse. Cached output does not confer visual acceptance. Explicit pause/finished states do not generate stall alarms. Old wall-clock stage budgets and forced strategy acknowledgements are retired.",
  "DIRECT_EDITING_V1: Think -> enqueue exact AE batch -> inspect -> correct. The exact editorialDecision on the job is sufficient; WORKFLOW_PLAN, workflowContext and per-target READY research plans are optional memory, never routine admission prerequisites.",
  "Build playable whole-edit coverage first. Then work across the edit in passes: timing/framing/retiming, effect families, whole-edit review, targeted corrections and finishing. Do not require a local PASS before constructing the next shot. An unfamiliar critical event may be prototyped without trapping the rest of the edit.",
  "Use complete notebook methods with source bindings, containers/parents/coordinate spaces, effect instances/order/versions, source traversal, all keys/easing and dependencies. Select a WORKED method explicitly, record methodApplications with every identity rebound and an exact adaptedMethod. Never copy tracker data onto another subject or retime a wrapper twice by accident.",
  "Coordinate retime, parent Position/Scale/Rotation, brightness, text/audio and paired incoming/outgoing events through your chosen anchor map. Choose all values/offsets/curves yourself; no pulse formula or automatic timing adaptation. Different source/master/wrapper fps are distinct.",
  "Recognize effect families once, retrieve worked recipes from the preset notebook, choose their exact adapted settings and apply them in a coherent batch. No repeated tutorial search, copied SOURCE record or new PLAN is required per clip. Research only unfamiliar or changed components, using Tutorial Drive -> Adobe -> web.",
  "Batch coherent exact operations through production-jobs. LOCAL_RENDER accepts explicit resolutionScale 1|0.25|0.125; reduced previews use an isolated unpatched duplicate, never change canonical picture. Choose local intervals with handles for local questions, focused full-resolution checks for flow/edges/mattes, and whole-edit audiovisual review at pass boundaries and final acceptance.",
  "Review whole-edit audiovisual previews at pass boundaries, then correct visible misses. LOCAL_RENDER completes without blocking subsequent jobs on a separate resolve receipt; inspection remains GPT's responsibility. Local renders are for actual defects. WORKFLOW_REVIEW is optional supporting memory; final full-resolution direct review remains required.",
  "The queue journals exact decisions/receipts, renews the current claim and saves an AE checkpoint after committed mutation batches. Save reviewed successes/failures and reusable complete methods at meaningful review/pass boundaries, handoff or completion; do not require a persistence call after each micro-operation. Unknown or partial AE writes still require actual readback before replay.",
  "Finishing and enhancement are scope choices. Keep picture cache/enhancement dimensions, fps, frame count, origins, audio and text/grade stack explicit. Tutorial external assets are not permission to import them; output uses assignment-provided raw inputs.",
  "Record TELEMETRY spans with activity ACTIVE|MACHINE_WAIT|IDLE and purpose PREPARATION|LEARNING|PRODUCTION|REVIEW|EXPORT|RECOVERY. Unknown gaps stay unattributed. Mark first rough and first accepted method with WORKFLOW_MILESTONE; one hour is a matched repeat-job target, never an acceptance shortcut.",
].join("\n");
export const PRODUCTION_WORKFLOW_CONTRACT_V1 = {
  schema: "editflow.production-workflow-contract.v1", authority: "CHATGPT_DIRECT", automaticDecisions: false,
  ...PRIMARY_WORKFLOW_ROUTING_V1, exclusive: true, modes: ["PRACTICE", "PRO_CREATION"],
  storage: "Existing production coordinator snapshot and selected preset gptLearning.workedExamples",
  endpoint: "/v1/product/gpt/assignments/{id}/production", actions: ["VISUAL_REVIEW", "WORKFLOW_PLAN", "WORKFLOW_REVIEW", "WORKFLOW_MILESTONE", "TELEMETRY"],
  policy: PRODUCTION_WORKFLOW_POLICY_V1,
  executionPath: "ONE_CALL_RESUME -> CHATGPT_DECISION -> AE_BATCH -> OBSERVE -> CORRECT",
  startup: "claim_gpt_assignment returns assignment,resume,aeState,aeStateError",
  mandatoryResearchPlans: false, mandatoryWorkflowPlan: false, mandatoryLocalPass: false,
  automaticCheckpointAfterBatch: true, previewsBlockQueue: false,
  plan: ["authority,decisionId,rationale,evidenceRefs", "mode,scope,output:{width,height,fps,durationMs},passOrder", "sources:[{clipId,mediaId,fingerprint,fps,startMs,endMs,availableStartMs,availableEndMs,actionAnchors:[{id,sourceMs,observation}]}]", "audio:{mediaId,songOffsetMs,policy}", "anchors:[{id,role,outputMs,rationale}]", "events:[{id,clipIds,anchorIds,treatment,acceptedDimensions,unresolvedIssues}]", "finishing:[explicit choices],nextAction"],
  review: ["authority,decisionId,rationale,evidenceRefs", "planDecisionId,eventId,constructionDecisionId,renderJobId,inspections:[{evidenceId,timeMs}]", "dimensions,verdict:PASS|REVISE,remainingIssues,observation,nextAction"],
  jobContext: "workflowContext is optional. Omit it for direct editing, or use {workflowId:CHATGPT_PRODUCTION_WORKFLOW_V1,phase:DIRECT}. Explicit retained plan bindings remain validated when supplied. All jobs retain exact ChatGPT editorialDecision and issued assignment/worker identity.",
  methodApplication: "methodApplications:[{authority,decisionId,rationale,evidenceRefs,lessonId,bindings:[{fromId,toId}],adaptationChecks,adaptedMethod}] — explicit, current WORKED example only; no automatic application",
  benchmark: { scope: "Familiar 14–15s two-shot velocity edit with prepared permitted raw inputs", targetMinutes: 60, measured: false,
    checkpoints: ["0–8 preparation", "8–18 playable structure", "18–35 first method and explicit reuse", "35–48 motion and paired cut", "48–60 finishing and full review"],
    include: ["preparation", "learning", "repeat production", "review", "export/waits", "recovery", "full elapsed", "unattributed"] },
} as const;
