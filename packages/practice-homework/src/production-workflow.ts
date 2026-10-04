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
  if (!c && options.acceptedLegacyReceipt) return;
  if (!c || c.workflowId !== PRIMARY_PRODUCTION_WORKFLOW_V1 && !(options.acceptedLegacyReceipt && c.workflowId === undefined)) {
    throw new TypeError("PRIMARY_WORKFLOW_REQUIRED: use CHATGPT_PRODUCTION_WORKFLOW_V1 and its WORKFLOW_PLAN; reference preparation uses phase PREPARATION.");
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
  "CHATGPT_PRODUCTION_WORKFLOW_V1 is the sole primary workflow for PRACTICE and PRO_CREATION. No workflow selector, older route or automatic fallback exists; ChatGPT alone makes every editorial decision.",
  "Read production.workflow, the current notebook, raw selections, research plans and receipts once on resume. Reconcile AE identity before advancing the retained next action; redo preflight only for changed dependencies or a real failure.",
  "Commit WORKFLOW_PLAN to the existing production endpoint: explicitly choose scope, learning/repeat mode, output timebase, bounded raw ranges/handles/fps/action anchors, supplied audio/offset, musical anchors, event topology, pass order, finishing and nextAction. No source/effect/preset chooser exists.",
  "Every new production job requires workflowContext:{workflowId:CHATGPT_PRODUCTION_WORKFLOW_V1,planDecisionId,planHash,eventIds:[...]}, bound to the active retained plan. Before raw selections are ready, REFERENCE_ANALYSIS alone may use workflowContext:{workflowId:CHATGPT_PRODUCTION_WORKFLOW_V1,phase:PREPARATION}. Source browsing, research and preflight are preparation within this same workflow. Previously accepted receipts remain resumable; they cannot authorize new legacy work.",
  "Establish playable whole-edit coverage early. Choose coherent section/pass work and prototype an unfamiliar critical event when needed; record unresolved issues rather than polishing one shot indefinitely. Pass order remains your editorial decision.",
  "Use complete notebook methods with source bindings, containers/parents/coordinate spaces, effect instances/order/versions, source traversal, all keys/easing and dependencies. Select a WORKED method explicitly, record methodApplications with every identity rebound and an exact adaptedMethod. Never copy tracker data onto another subject or retime a wrapper twice by accident.",
  "Coordinate retime, parent Position/Scale/Rotation, brightness, text/audio and paired incoming/outgoing events through your chosen anchor map. Choose all values/offsets/curves yourself; no pulse formula or automatic timing adaptation. Different source/master/wrapper fps are distinct.",
  "Reuse inspected tutorial evidence through clip-research SOURCE reuseSourceId and bind a new PLAN per target. Across sessions consult the timestamped notebook provenance; research the missing or changed component. Tutorial Drive -> Adobe -> web remains required. Access errors are BLOCKED, never NO_MATCH.",
  "Batch coherent exact operations through production-jobs. LOCAL_RENDER accepts explicit resolutionScale 1|0.25|0.125; reduced previews use an isolated unpatched duplicate, never change canonical picture. Choose local intervals with handles for local questions, focused full-resolution checks for flow/edges/mattes, and whole-edit audiovisual review at pass boundaries and final acceptance.",
  "Record WORKFLOW_REVIEW with dimensions, retained renderJobId, constructionDecisionId, PASS/REVISE, observed issues and your next action. Save reviewed methods into existing workedExamples. Writes/metadata alone are never visual proof. After repeated similar defects diagnose bindings, time/space, topology, stack, selectors or plugin behavior before another numerical trial.",
  "Finishing and enhancement are scope choices. Keep picture cache/enhancement dimensions, fps, frame count, origins, audio and text/grade stack explicit. Tutorial external assets are not permission to import them; output uses assignment-provided raw inputs.",
  "Record TELEMETRY spans with activity ACTIVE|MACHINE_WAIT|IDLE and purpose PREPARATION|LEARNING|PRODUCTION|REVIEW|EXPORT|RECOVERY. Unknown gaps stay unattributed. Mark first rough and first accepted method with WORKFLOW_MILESTONE; one hour is a matched repeat-job target, never an acceptance shortcut.",
].join("\n");
export const PRODUCTION_WORKFLOW_CONTRACT_V1 = {
  schema: "editflow.production-workflow-contract.v1", authority: "CHATGPT_DIRECT", automaticDecisions: false,
  ...PRIMARY_WORKFLOW_ROUTING_V1, exclusive: true, modes: ["PRACTICE", "PRO_CREATION"],
  storage: "Existing production coordinator snapshot and selected preset gptLearning.workedExamples",
  endpoint: "/v1/product/gpt/assignments/{id}/production", actions: ["WORKFLOW_PLAN", "WORKFLOW_REVIEW", "WORKFLOW_MILESTONE", "TELEMETRY"],
  policy: PRODUCTION_WORKFLOW_POLICY_V1,
  plan: ["authority,decisionId,rationale,evidenceRefs", "mode,scope,output:{width,height,fps,durationMs},passOrder", "sources:[{clipId,mediaId,fingerprint,fps,startMs,endMs,availableStartMs,availableEndMs,actionAnchors:[{id,sourceMs,observation}]}]", "audio:{mediaId,songOffsetMs,policy}", "anchors:[{id,role,outputMs,rationale}]", "events:[{id,clipIds,anchorIds,treatment,acceptedDimensions,unresolvedIssues}]", "finishing:[explicit choices],nextAction"],
  review: ["authority,decisionId,rationale,evidenceRefs", "planDecisionId,eventId,constructionDecisionId,renderJobId,inspections:[{evidenceId,timeMs}]", "dimensions,verdict:PASS|REVISE,remainingIssues,observation,nextAction"],
  jobContext: "Required workflowContext:{workflowId:CHATGPT_PRODUCTION_WORKFLOW_V1,planDecisionId,planHash,eventIds}; new jobs use the active ChatGPT plan. REFERENCE_ANALYSIS preparation alone uses {workflowId:CHATGPT_PRODUCTION_WORKFLOW_V1,phase:PREPARATION}. Pre-rollout accepted receipts remain resumable only.",
  methodApplication: "methodApplications:[{authority,decisionId,rationale,evidenceRefs,lessonId,bindings:[{fromId,toId}],adaptationChecks,adaptedMethod}] — explicit, current WORKED example only; no automatic application",
  benchmark: { scope: "Familiar 14–15s two-shot velocity edit with prepared permitted raw inputs", targetMinutes: 60, measured: false,
    checkpoints: ["0–8 preparation", "8–18 playable structure", "18–35 first method and explicit reuse", "35–48 motion and paired cut", "48–60 finishing and full review"],
    include: ["preparation", "learning", "repeat production", "review", "export/waits", "recovery", "full elapsed", "unattributed"] },
} as const;
