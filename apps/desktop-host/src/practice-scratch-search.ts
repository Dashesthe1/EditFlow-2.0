import { ChatgptAeRenderDriverV1 } from "./chatgpt-ae-render-driver.js";


const numeric = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value)
  || Array.isArray(value) && value.length > 0 && value.length <= 4 && value.every((item) => typeof item === "number" && Number.isFinite(item));

export const validatePracticeScratchSearchV1 = (body: Record<string, any>): void => {
  if (typeof body.compStableId !== "string" || !body.compStableId || typeof body.clipId !== "string") throw new TypeError("Scratch search requires compStableId and clipId.");
  if (!Number.isFinite(body.startMs) || !Number.isFinite(body.endMs) || body.startMs < 0 || body.endMs <= body.startMs || body.endMs - body.startMs > 2000) {
    throw new TypeError("Scratch search must target a finite micro-window of at most two seconds.");
  }
  if (!Array.isArray(body.candidates) || body.candidates.length < 1 || body.candidates.length > 32) throw new TypeError("Scratch search needs 1–32 candidates.");
  const ids = new Set<string>();
  for (const candidate of body.candidates) {
    if (typeof candidate.candidateId !== "string" || !candidate.candidateId || ids.has(candidate.candidateId)) throw new TypeError("Scratch candidate IDs must be unique.");
    ids.add(candidate.candidateId);
    if (!Array.isArray(candidate.patches) || candidate.patches.length > 64) throw new TypeError("Scratch candidates need at most 64 patches.");
    for (const patch of candidate.patches) {
      if (!Number.isInteger(patch.layerIndex) || patch.layerIndex < 1
        || !Array.isArray(patch.propertyPath) || !patch.propertyPath.length || patch.propertyPath.length > 8
        || patch.propertyPath.some((item: unknown) => typeof item !== "string" || !item.startsWith("ADBE "))
        || patch.effectMatchName !== undefined && (typeof patch.effectMatchName !== "string" || !patch.effectMatchName.startsWith("ADBE "))) {
        throw new TypeError("Scratch patches need an exact layer index and native AE match-name property path.");
      }
      if (patch.keys !== undefined) {
        if (!Array.isArray(patch.keys) || !patch.keys.length || patch.keys.length > 32) throw new TypeError("Scratch keys must contain 1–32 numeric keyframes.");
        let priorTime = -Infinity;
        for (const key of patch.keys) {
          if (!Number.isFinite(key.timeMs) || key.timeMs < body.startMs || key.timeMs > body.endMs
            || key.timeMs <= priorTime || !numeric(key.value)) throw new TypeError("Scratch keys must be ordered, numeric, and inside the micro-window.");
          priorTime = key.timeMs;
        }
      } else if (!numeric(patch.value)) throw new TypeError("Scratch values must be finite numeric scalars/vectors.");
    }
  }
};

export const runPracticeScratchSearchV1 = async (input: {
  readonly body: Record<string, any>;
  readonly sessionId: string;
  readonly renderDriver: ChatgptAeRenderDriverV1;
  readonly signal: AbortSignal;
}) => {
  const body = input.body;
  validatePracticeScratchSearchV1(body);
  // Every candidate and resolution is supplied by GPT. No score, family label,
  // automated pruning, winner, or canonical mutation is produced here.
  const candidates = [];
  for (const candidate of body.candidates) {
    input.signal.throwIfAborted();
    const scale = candidate.resolutionScale ?? 1;
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1) throw new TypeError("Invalid explicitly requested render resolution.");
    const render = await input.renderDriver.renderSearchCandidate({ sessionId: input.sessionId,
      compStableId: body.compStableId, candidateId: candidate.candidateId,
      patches: candidate.patches, startMs: body.startMs, endMs: body.endMs, resolutionScale: scale });
    candidates.push({ candidateId: candidate.candidateId, renderPath: render.renderPath, evidenceRefs: render.evidenceRefs ?? [], resolutionScale: scale });
  }
  return { schema: "editflow.chatgpt-candidate-review.v1", authority: "CHATGPT_DIRECT", candidates,
    winner: null, reviewRequired: true, instruction: "Inspect every requested render and choose the result yourself. No automatic ranking, elimination or parameter correction. Submit a separate explicit canonical plan." };
};
