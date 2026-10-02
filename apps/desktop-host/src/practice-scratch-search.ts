import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PracticeScratchCandidateRigV1 } from "../../../packages/practice-homework/src/scratch-candidate-rig.js";
import { classifyEffectFamilyV1, compareSemanticVisualFidelityV1, decomposeUnknownEffectV1, deriveEffectAnatomyV1 } from "../../../packages/visual-effects-intelligence/src/index.js";
import { PracticeM6AeRenderDriverCurrentV1 } from "./practice-m6-ae-render-driver.js";
import { PracticeM6LocalMediaAnalyzerV1 } from "./practice-m6-media.js";

const execFileAsync = promisify(execFile);
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
  readonly referencePath: string;
  readonly renderDriver: PracticeM6AeRenderDriverCurrentV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly signal: AbortSignal;
  readonly ffprobePath?: string;
}) => {
  const body = input.body;
  validatePracticeScratchSearchV1(body);
  const reference = await input.media.analyzeVideo({ videoPath: input.referencePath,
    sourceId: input.sessionId + ":scratch-reference:" + body.startMs + ":" + body.endMs,
    sourceKind: "REFERENCE", startMs: body.startMs, endMs: body.endMs });
  const family = classifyEffectFamilyV1(reference);
  const dna = family === "UNKNOWN" ? decomposeUnknownEffectV1(reference).dna : deriveEffectAnatomyV1(reference, family).dna;
  const state = await input.renderDriver.client.observe(input.renderDriver.projectId);
  const comp = state.project.items.find((item) => item.stableId === body.compStableId)?.composition;
  if (!comp) throw new TypeError("Scratch source comp is missing.");
  const fullDimensions = { width: comp.width, height: comp.height };
  const paths: Record<string, string> = {};
  // One AE writer, including scratch renders. Numeric candidates never edit the
  // canonical comp, and machine scores never satisfy a production proof gate.
  const rig = new PracticeScratchCandidateRigV1<Record<string, any>>(1);
  const result = await rig.search({
    candidates: body.candidates.map((candidate: Record<string, any>) => ({ candidateId: candidate.candidateId, value: candidate })),
    evaluate: async (candidate, stage) => {
      input.signal.throwIfAborted();
      const rendered = await input.renderDriver.renderSearchCandidate({ sessionId: input.sessionId,
        compStableId: body.compStableId, candidateId: candidate.candidateId + ":" + stage.id,
        patches: candidate.value.patches, startMs: body.startMs, endMs: body.endMs, resolutionScale: stage.resolutionScale });
      const probe = input.ffprobePath
        ? await execFileAsync(input.ffprobePath, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", rendered.renderPath], { timeout: 15_000 })
        : await execFileAsync(input.media.python.executable, [...input.media.python.prefixArgs, "-c",
          "import cv2,json,sys; c=cv2.VideoCapture(sys.argv[1]); print(json.dumps({'streams':[{'width':c.get(cv2.CAP_PROP_FRAME_WIDTH),'height':c.get(cv2.CAP_PROP_FRAME_HEIGHT)}]})); c.release()",
          rendered.renderPath], { timeout: 15_000 });
      const dimensions = JSON.parse(probe.stdout).streams?.[0];
      if (!dimensions?.width || !dimensions?.height) throw new TypeError("Scratch render dimensions could not be verified.");
      if (Math.abs(dimensions.width - fullDimensions.width * stage.resolutionScale) > 1
        || Math.abs(dimensions.height - fullDimensions.height * stage.resolutionScale) > 1) throw new TypeError("Scratch renderer did not honor the progressive-resolution funnel.");
      const render = await input.media.analyzeVideo({ videoPath: rendered.renderPath,
        sourceId: candidate.candidateId + ":" + stage.id + ":" + rendered.renderPath,
        sourceKind: "RENDER", startMs: 0, endMs: body.endMs - body.startMs });
      const comparison = compareSemanticVisualFidelityV1({ reference, render, dna, alignment: "SEMANTIC" });
      paths[stage.id + ":" + candidate.candidateId] = rendered.renderPath;
      return { score: comparison.weightedFidelity, definingCoverage: comparison.definingCoverage,
        evidenceRefs: [...rendered.evidenceRefs, ...render.evidenceRefs, "search-only:" + render.contentKey] };
    },
  });
  return { ...result, authority: "NON_AUTHORITATIVE_SEARCH_ONLY", reviewRequired: true, renderPaths: paths,
    referencePath: input.referencePath, window: [body.startMs, body.endMs] };
};
