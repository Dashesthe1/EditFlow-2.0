import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasVerifiedPracticeSourceIdentityV1 } from "./source-integrity.js";
import type { PracticeSceneMatchV1 } from "./contracts.js";

type Packet = Record<string, any>;
export const CLIP_RESEARCH_POLICY_V1 = [
  "ON-DEMAND METHOD LEARNING: research is supporting memory, never an AE admission gate.",
  "Recognize effect families from the reference once. Explicitly choose and adapt a retained worked method or a known construction immediately; no new SCAN, SOURCE or READY PLAN is required for each target.",
  "Research only the unfamiliar or changed component. For new research use Tutorial Drive, then Adobe documentation, then web. Retain genuine observations and provenance; access failures are never no-match evidence.",
  "SCAN/SOURCE/PLAN remain optional durable learning records. They do not authorize, block or sequence editing.",
  "Submit exact ChatGPT AE operations with researchContext={assignmentId,claimedBy,clipIds:[affected clips]} and editorialDecision. Existing plans fields remain readable but are optional. The server checks the current worker and selected raw identities inside admission and journals execution.",
].join("\n");

export const CLIP_RESEARCH_CONTRACT_V1 = {
  schema: "editflow.clip-research-contract.v1",
  policy: CLIP_RESEARCH_POLICY_V1,
  mandatoryBeforeEditing: false,
  researchTrigger: "CHATGPT_IDENTIFIES_AN_UNFAMILIAR_OR_CHANGED_METHOD",
  common: ["action", "clipId", "claimedBy"],
  SCAN: ["sourceMediaId (provided raw video)", "sourceRangeMs [start,end]", "referenceRangeMs [start,end] (Practice)", "observations", "effects [{effectId,behavior}]", "evidencePath (JSON {clipId,observations,sourceMediaId,sourceRangeMs,referenceRangeMs})"],
  SOURCE: ["authority CHATGPT_DIRECT", "tier TUTORIAL|ADOBE|WEB", "outcome SUFFICIENT|PARTIAL|NO_MATCH", "query", "title", "uri", "locator (video timestamps/document section)", "limitation (required if insufficient)", "evidencePath (JSON {query,uri,locator,observations|results})", "steps [{stepId,tool,action,effectIds}] chosen directly by ChatGPT", "reuseSourceId (optional retained sourceId from another clip when it covers every scanned effect)"],
  PLAN: ["bindings [{effectId,sourceId,stepIds,adaptation}]", "comparisonChecks [specific render/reference checks]"],
  mutationContext: { assignmentId: "current assignment", claimedBy: "current controller lease owner", clipIds: ["affected clip; inferred from declared clip/shot targets when omitted"], plans: "optional retained learning references" },
  persistence: "Separate atomic per-assignment ledger; scans/source evidence content hashes; methods and request hashes retained in audit.",
};

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceFileIdentity = async (uri: string): Promise<Packet> => {
  try { const file = await stat(uri); return { uri, size: file.size, mtimeMs: file.mtimeMs }; }
  catch { return { uri, missing: true }; }
};
const fail = (message: string): never => { throw new TypeError("CLIP_RESEARCH_REQUIRED: " + message); };
const str = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim()) return fail(name + " is required.");
  return value.trim();
};
const list = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || !value.length) return fail(name + " must be a non-empty array.");
  const result = value.map((item) => str(item, name));
  if (new Set(result).size !== result.length) return fail(name + " contains duplicates.");
  return result;
};
const range = (value: unknown, name: string): number[] => {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)
    || value[0] < 0 || value[1] <= value[0]) return fail(name + " must be an increasing millisecond range.");
  return value;
};
const assignmentHash = (assignment: Packet): string => hash({
  assignmentId: assignment.assignmentId, finish: assignment.finish, start: assignment.start,
  practiceSceneMatches: assignment.practiceSceneMatches,
});
const mediaKey = (assignment: Packet): string => hash({ finish: assignment.finish, start: assignment.start });
const matchKey = (assignment: Packet, clipId: string): string => {
  const match = (assignment.practiceSceneMatches ?? []).find((item: Packet) => item.shotId === clipId);
  return hash(match ? { sourceId: match.sourceId, sourcePath: match.sourcePath,
    sourceStartMs: match.sourceStartMs, sourceEndMs: match.sourceEndMs, direction: match.direction,
    trajectory: match.trajectory, workingMedia: match.workingMedia?.sourcePath,
    selectionMode: match.selectionMode, chatgptSelection: match.chatgptSelection } : null);
};

const requireDirectPracticeShot = (assignment: Packet, clipId: string): void => {
  if (assignment.mode !== "PRACTICE") return;
  const match = (assignment.practiceSceneMatches ?? []).find((item: Packet) => item.shotId === clipId);
  if (!match || match.selectionMode !== "CHATGPT_DIRECT"
    || !hasVerifiedPracticeSourceIdentityV1(match as PracticeSceneMatchV1)) {
    fail("clipId must be a retained direct ChatGPT Practice selection; inspect and select its raw footage first.");
  }
};
const ranks: Record<string, number> = { TUTORIAL: 0, ADOBE: 1, WEB: 2 };

export class ClipResearchStoreV1 {
  static readonly tails = new Map<string, Promise<unknown>>();
  readonly #cache = new Map<string, { mtimeMs: number; ledger: Packet }>();
  constructor(readonly directory: string, readonly evidenceRoots: readonly string[]) {}

  private file(assignmentId: string): string { return path.join(this.directory, hash(assignmentId) + ".json"); }
  async snapshot(assignment: Packet): Promise<Packet> {
    try {
      const file = this.file(assignment.assignmentId);
      const metadata = await stat(file);
      const cached = this.#cache.get(file);
      let saved: Packet;
      if (cached?.mtimeMs === metadata.mtimeMs) saved = structuredClone(cached.ledger);
      else {
        saved = JSON.parse(await readFile(file, "utf8")) as Packet;
        let journal = "";
        try { journal = await readFile(file + ".audit.jsonl", "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const audit = [...(saved.audit ?? []), ...journal.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))];
        saved.audit = [...new Map(audit.map((event: Packet) => [hash(event), event])).values()];
        this.#cache.set(file, { mtimeMs: metadata.mtimeMs, ledger: structuredClone(saved) });
      }
      if (saved.schema !== "editflow.clip-research-ledger.v1" || saved.assignmentId !== assignment.assignmentId) {
        return fail("Invalid research ledger; repair the ledger before editing.");
      }
      if (saved.assignmentHash !== assignmentHash(assignment) && saved.mediaKey === mediaKey(assignment)) {
        const clips = Object.fromEntries(Object.entries(saved.clips as Record<string, Packet>).map(([id, clip]) => [id,
          clip.matchKey === matchKey(assignment, id) ? clip : { ...clip, plan: null, stale: true }]));
        return { ...saved, clips, assignmentHash: assignmentHash(assignment), current: true };
      }
      return { ...saved, current: saved.assignmentHash === assignmentHash(assignment) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { schema: "editflow.clip-research-ledger.v1", assignmentId: assignment.assignmentId,
        sessionId: assignment.sessionId, assignmentHash: assignmentHash(assignment), clips: {}, audit: [], current: true };
    }
  }

  publicView(ledger: Packet, includeAuditHistory = false): Packet {
    const { journaledAudit: _journaledAudit, ...view } = ledger;
    const audit = ledger.audit ?? [];
    return { ...view, auditCount: audit.length, auditTruncated: !includeAuditHistory && audit.length > 20,
      audit: (includeAuditHistory ? audit : audit.slice(-20)).map((event: Packet) => ({ ...event,
        ...(Array.isArray(event.plans) && !includeAuditHistory ? {
          plans: event.plans.map((plan: Packet) => ({ clipId: plan.clipId, planId: plan.planId })) } : {}) })) };
  }

  private async evidence(value: unknown): Promise<Packet> {
    const file = path.resolve(str(value, "evidencePath"));
    if (!this.evidenceRoots.some((root) => {
      const relative = path.relative(path.resolve(root), file);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    })) return fail("Evidence must be under an authorized media/artifact root.");
    const bytes = await readFile(file);
    if (bytes.length > 4_000_000) return fail("Evidence JSON must be under 4 MB.");
    const data = JSON.parse(bytes.toString("utf8")) as Packet;
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail("Evidence must be a JSON object.");
    return { path: file, sha256: createHash("sha256").update(bytes).digest("hex"), data };
  }

  private async mutate(assignment: Packet, action: (saved: Packet) => Promise<Packet>): Promise<Packet> {
    const file = this.file(assignment.assignmentId);
    const prior = ClipResearchStoreV1.tails.get(file) ?? Promise.resolve();
    const pending = prior.catch(() => {}).then(async () => {
      const saved = await this.snapshot(assignment);
      const result = await action(saved);
      const next: Packet = { ...result, mediaKey: mediaKey(assignment), updatedAt: new Date().toISOString() };
      await mkdir(this.directory, { recursive: true });
      const cached = this.#cache.get(file);
      const retained = new Set((cached?.ledger.journaledAudit ?? []).map((item: string) => item));
      const missing = next.audit.filter((event: Packet) => !retained.has(hash(event)));
      if (missing.length) await appendFile(file + ".audit.jsonl", missing.map((event: Packet) => JSON.stringify(event)).join("\n") + "\n", { encoding: "utf8", flush: true });
      const journaledAudit = next.audit.map((event: Packet) => hash(event));
      const temporary = file + ".tmp-" + randomUUID();
      await writeFile(temporary, JSON.stringify({ ...next, audit: [], journaledAudit }, null, 2) + "\n", { encoding: "utf8", flush: true });
      try {
        for (let attempt = 0; ; attempt++) {
          try { await rename(temporary, file); break; }
          catch (error) {
            if (!["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") || attempt >= 5) throw error;
            await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
          }
        }
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
      this.#cache.set(file, { mtimeMs: (await stat(file)).mtimeMs, ledger: { ...structuredClone(next), journaledAudit } });
      return next;
    });
    ClipResearchStoreV1.tails.set(file, pending);
    try { return await pending; }
    finally { if (ClipResearchStoreV1.tails.get(file) === pending) ClipResearchStoreV1.tails.delete(file); }
  }

  async record(assignment: Packet, input: Packet): Promise<Packet> {
    if (assignment.status !== "RUNNING") return fail("Assignment must be RUNNING, not cancelled or terminal.");
    const lease = assignment.controllerLease;
    if (!lease || lease.owner !== input.claimedBy || Date.parse(lease.expiresAt) <= Date.now()) {
      return fail("Claim/heartbeat the existing assignment using your unique controller before recording research.");
    }
    const clipId = str(input.clipId, "clipId");
    requireDirectPracticeShot(assignment, clipId);
    return await this.mutate(assignment, async (saved) => {
      if (!saved.current) {
        saved = { ...saved, assignmentHash: assignmentHash(assignment), clips: {}, current: true,
          audit: [...saved.audit, { kind: "MEDIA_CHANGED", at: new Date().toISOString() }] };
      }
      let clip = saved.clips[clipId];
      if (input.action === "SCAN") {
        const sourceMediaId = str(input.sourceMediaId, "sourceMediaId");
        if (!assignment.start.some((m: Packet) => m.mediaId === sourceMediaId && m.mediaKind === "VIDEO")) {
          return fail("Scan must use a provided raw video, never Finished media.");
        }
        const sourceRangeMs = range(input.sourceRangeMs, "sourceRangeMs");
        const match = (assignment.practiceSceneMatches ?? []).find((item: Packet) => item.shotId === clipId);
        if (match && (match.sourceId !== sourceMediaId
          || (Number.isFinite(match.sourceStartMs) && sourceRangeMs[0]! > match.sourceStartMs)
          || (Number.isFinite(match.sourceEndMs) && sourceRangeMs[1]! < match.sourceEndMs))) {
          return fail("Inspect the retained matched raw source and its complete clip range.");
        }
        const referenceRangeMs = assignment.mode === "PRACTICE" ? range(input.referenceRangeMs, "referenceRangeMs") : null;
        const observations = str(input.observations, "observations");
        if (!Array.isArray(input.effects) || !input.effects.length) return fail("List every desired effect, including clean cut/framing when applicable.");
        const effects = input.effects.map((effect: Packet) => ({ effectId: str(effect.effectId, "effectId"), behavior: str(effect.behavior, "effect behavior") }));
        list(effects.map((effect: Packet) => effect.effectId), "effectIds");
        const evidence = await this.evidence(input.evidencePath);
        if (evidence.data.clipId !== clipId || evidence.data.sourceMediaId !== sourceMediaId
          || hash(evidence.data.sourceRangeMs) !== hash(sourceRangeMs)
          || (referenceRangeMs !== null && hash(evidence.data.referenceRangeMs) !== hash(referenceRangeMs))) {
          return fail("Inspection artifact must identify the same clip, raw media and source/reference windows.");
        }
        str(evidence.data.observations, "inspection artifact observations");
        const source = assignment.start.find((item: Packet) => item.mediaId === sourceMediaId);
        const scan = { sourceMediaId, sourceRangeMs, referenceRangeMs, observations, effects, evidence,
          sourceFileIdentity: await sourceFileIdentity(source.uri),
          referenceMediaId: assignment.finish?.mediaId ?? null };
        // Reposting the same scan resumes it; changed inspection invalidates the prior plan.
        clip = clip?.scanHash === hash(scan) && !clip.stale ? clip : { clipId, scan, scanHash: hash(scan), sources: [], plan: null };
        clip = { ...clip, matchKey: matchKey(assignment, clipId), stale: false };
      } else {
        if (!clip) return fail("Inspect and record SCAN before consulting a source or making a plan.");
        const effectIds = clip.scan.effects.map((effect: Packet) => effect.effectId);
        if (input.action === "SOURCE") {
          const priorSources = clip.sources as Packet[];
          const reuseSourceId = typeof input.reuseSourceId === "string" && input.reuseSourceId.trim()
            ? input.reuseSourceId.trim()
            : null;
          if (reuseSourceId !== null) {
            const reusable = Object.values(saved.clips as Record<string, Packet>)
              .flatMap((candidate: Packet) => candidate?.sources ?? [])
              .find((source: Packet) => source.sourceId === reuseSourceId);
            if (!reusable || reusable.outcome === "NO_MATCH") {
              return fail("reuseSourceId must identify a retained successful/partial consulted source.");
            }
            const covered = new Set(reusable.steps.flatMap((step: Packet) => step.effectIds));
            if (!effectIds.every((id: string) => covered.has(id))) {
              return fail("Reused research source does not cover every scanned effect for this clip.");
            }
            if (!priorSources.some((source: Packet) => source.sourceId === reusable.sourceId)) {
              priorSources.push(structuredClone(reusable));
              clip = { ...clip, sources: priorSources, plan: null };
            }
            return { ...saved, clips: { ...saved.clips, [clipId]: clip }, audit: [
              ...saved.audit,
              { kind: "RESEARCH_REUSED", at: new Date().toISOString(), clipId, sourceId: reuseSourceId },
            ] };
          }
          const tier = str(input.tier, "tier");
          const rank = ranks[tier];
          if (rank === undefined) return fail("tier must be TUTORIAL, ADOBE or WEB.");
          if (!["SUFFICIENT", "PARTIAL", "NO_MATCH"].includes(input.outcome)) return fail("Invalid source outcome; access failures must be repaired, not treated as no-match.");
          const lastRank = priorSources.length ? ranks[priorSources.at(-1)!.tier]! : 0;
          if (rank < lastRank || rank > lastRank + 1 || (!priorSources.length && rank !== 0)) {
            return fail("Consult tutorials first, then Adobe, then web without skipping a tier.");
          }
          if (rank > lastRank) {
            const previous = priorSources.filter((source) => ranks[source.tier] === lastRank);
            const covered = new Set(priorSources.flatMap((source) => source.steps.flatMap((step: Packet) => step.effectIds)));
            if (!previous.length || previous.some((source) => source.outcome === "SUFFICIENT" || !source.limitation)
              || effectIds.every((id: string) => covered.has(id))) {
              return fail("Escalation needs documented insufficient coverage in the preceding tier.");
            }
          }
          const query = str(input.query, "query");
          const uri = str(input.uri, "source uri");
          const locator = str(input.locator, "timestamp/section");
          const title = str(input.title, "source title");
          const limitation = input.outcome === "SUFFICIENT" ? null : str(input.limitation, "specific limitation");
          const evidence = await this.evidence(input.evidencePath);
          if (evidence.data.query !== query || evidence.data.uri !== uri || evidence.data.locator !== locator) {
            return fail("Review/search artifact must match query, source URI and section.");
          }
          if (input.outcome === "NO_MATCH") {
            if (!Array.isArray(evidence.data.results)) return fail("No-match requires the actual retained search results (which may be empty).");
          } else str(evidence.data.observations, "review artifact observations");
          if (tier === "ADOBE") {
            const url = new URL(uri);
            if (url.protocol !== "https:" || !(url.hostname === "adobe.com" || url.hostname.endsWith(".adobe.com"))) return fail("Adobe fallback must cite official Adobe documentation.");
          }
          if (tier === "TUTORIAL" && !uri.startsWith("https://drive.google.com/")) return fail("First tier must reference the user's Tutorial Drive.");
          if (input.authority !== "CHATGPT_DIRECT") return fail("ChatGPT must directly review the source and choose its method steps (authority:CHATGPT_DIRECT).");
          if (input.compiledResearchSourceId !== undefined || input.compilation !== undefined) return fail("Machine-compiled research removed; submit directly analyzed source steps.");
          const steps = input.outcome === "NO_MATCH" ? [] : (input.steps ?? []).map((step: Packet) => ({
            stepId: str(step.stepId, "stepId"), tool: str(step.tool, "AE tool"), action: str(step.action, "method action"),
            effectIds: list(step.effectIds, "covered effectIds"),
          }));
          if (input.outcome !== "NO_MATCH") {
            list(steps.map((step: Packet) => step.stepId), "method stepIds");
            if (steps.some((step: Packet) => step.effectIds.some((id: string) => !effectIds.includes(id)))) return fail("Method steps can cover only scanned effects.");
          }
          if (input.outcome === "SUFFICIENT" && !effectIds.every((id: string) => steps.some((step: Packet) => step.effectIds.includes(id)))) return fail("SUFFICIENT must cover every scanned effect.");
          const source = { authority: "CHATGPT_DIRECT", tier, outcome: input.outcome, query, uri, locator, title, limitation, evidence, steps };
          const sourceId = "clip-source:" + hash(source);
          if (!priorSources.some((source) => source.sourceId === sourceId)) {
            priorSources.push({ ...source, sourceId });
            clip = { ...clip, sources: priorSources, plan: null };
          }
        } else if (input.action === "PLAN") {
          if (!Array.isArray(input.bindings) || !input.bindings.length) return fail("Map every effect to consulted method steps.");
          const bindings = input.bindings.map((binding: Packet) => {
            const effectId = str(binding.effectId, "binding effectId");
            if (!effectIds.includes(effectId)) return fail("Plan effect is outside the scanned clip.");
            const sourceId = str(binding.sourceId, "binding sourceId");
            const source = clip.sources.find((source: Packet) => source.sourceId === sourceId);
            const stepIds = list(binding.stepIds, "binding stepIds");
            if (!source || source.outcome === "NO_MATCH" || stepIds.some((id) => !source.steps.some((step: Packet) => step.stepId === id && step.effectIds.includes(effectId)))) return fail("Each binding must use consulted source steps covering that effect.");
            return { effectId, sourceId, stepIds, adaptation: str(binding.adaptation, "raw-footage adaptation"),
              methods: source.steps.filter((step: Packet) => stepIds.includes(step.stepId)) };
          });
          if (!effectIds.every((id: string) => bindings.some((binding: Packet) => binding.effectId === id))) return fail("Plan has uncovered effects; continue research.");
          const comparisonChecks = list(input.comparisonChecks, "render/reference comparisonChecks");
          const plan = { clipId, scanHash: clip.scanHash, bindings, comparisonChecks, assignmentHash: saved.assignmentHash };
          clip = { ...clip, plan: { ...plan, planId: "clip-plan:" + hash(plan), status: "READY" } };
        } else return fail("action must be SCAN, SOURCE or PLAN.");
      }
      return { ...saved, clips: { ...saved.clips, [clipId]: clip } };
    });
  }

  async admit(assignment: Packet, body: Packet, queuedExecution = false): Promise<Packet> {
    if (assignment.status !== "RUNNING") return fail("Cancelled, unclaimed or terminal assignment cannot edit.");
    const context = body.researchContext;
    if (!context || context.assignmentId !== assignment.assignmentId || typeof context.claimedBy !== "string") {
      return fail("AE editing needs researchContext identifying the current assignment and issued worker.");
    }
    const lease = assignment.controllerLease;
    if (!queuedExecution && (!lease || lease.owner !== context.claimedBy || Date.parse(lease.expiresAt) <= Date.now())) {
      return fail("Heartbeat/claim the assignment and pass researchContext.claimedBy for its current live controller.");
    }
    const declaredTargets = new Set<string>();
    const collectTargets = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(collectTargets); return; }
      for (const [key, item] of Object.entries(value)) {
        if (["researchContext", "workflowContext", "methodApplications", "workflowPlan"].includes(key)) continue;
        if ((key === "clipId" || key === "shotId") && typeof item === "string") declaredTargets.add(item);
        else collectTargets(item);
      }
    };
    collectTargets(body);
    if (context.clipIds !== undefined && !Array.isArray(context.clipIds)
      || context.plans !== undefined && !Array.isArray(context.plans)) {
      return fail("clipIds and optional plans must be arrays.");
    }
    for (const id of context.clipIds ?? []) declaredTargets.add(str(id, "clipId"));
    for (const ref of context.plans ?? []) declaredTargets.add(str(ref.clipId, "clipId"));
    const ids = [...declaredTargets];
    ids.forEach((id) => requireDirectPracticeShot(assignment, id));
    // Media integrity is enforced by the coordinator and source-import validator.
    // Tutorial artifacts and old research plans cannot block unrelated construction.
    const saved = context.plans?.length ? await this.snapshot(assignment) : { current: true, clips: {} };
    const plans = ids.map(clipId => {
      const ref = context.plans?.find((p: Packet) => p.clipId === clipId);
      const plan = saved.current ? saved.clips[clipId]?.plan : null;
      return plan?.planId === ref?.planId && plan?.status === "READY" ? plan : { clipId, planId: null };
    });
    return { assignmentId: assignment.assignmentId, clipIds: ids, plans, researchRequired: false, requestHash: hash(body) };
  }

  async audit(assignment: Packet, admission: Packet, outcome: string, evidenceRefs: readonly string[] = []): Promise<void> {
    await this.mutate(assignment, async (saved) => ({ ...saved, audit: [...saved.audit, {
      kind: "AE_EXECUTION", at: new Date().toISOString(), outcome, requestHash: admission.requestHash,
      plans: admission.plans.map((plan: Packet) => ({ clipId: plan.clipId, planId: plan.planId })), evidenceRefs,
    }] }));
  }
}
