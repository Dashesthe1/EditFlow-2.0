import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildConstructionGraphV1,
  canonicalTransitionDnaV1,
  classifyEffectFamilyV1,
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  deriveConstructionActuationPlanV1,
  deriveEffectAnatomyV1,
  distinguishShutterFromFlashZoomV1,
  evaluateProfessionalFidelityGateV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const argv = process.argv.slice(2);
const required = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) {
    throw new Error(`Missing required argument ${name}`);
  }
  return path.resolve(argv[index + 1]);
};

const referencePath = required("--reference-evidence");
const renderPath = required("--render-evidence");
const outputPath = required("--output");
const tagIndex = argv.indexOf("--tag");
const tag = tagIndex >= 0 ? argv[tagIndex + 1] : path.basename(renderPath);
const load = async (file) => JSON.parse(await readFile(file, "utf8"));

const capabilities = [
  "ae.layer.duplicate",
  "ae.layer.time.offset",
  "ae.layer.opacity.set",
  "ae.subject.isolate",
  "ae.layer.matte.set",
  "ae.effect.displacement-map",
  "ae.effect.directional-blur",
  "ae.effect.exposure",
  "ae.effect.channel-shift",
  "ae.layer.blend_mode.set",
  "ae.layer.order.set",
  "ae.keyframe.temporal_ease.set",
  "ae.layer.transform.set",
  "ae.keyframe.spatial.set",
];

const reference = await load(referencePath);
const render = await load(renderPath);
if (reference.schema !== "editflow.dense-effect-evidence.v1"
  || render.schema !== "editflow.dense-effect-evidence.v1") {
  throw new Error("Local shutter proof requires dense-effect-evidence.v1 inputs.");
}

const referenceContract = distinguishShutterFromFlashZoomV1(reference);
if (!referenceContract.shutter) {
  throw new Error(`Bounded reference ${reference.sourceId} does not satisfy shutter DNA.`);
}

const dna = canonicalTransitionDnaV1(
  "SHUTTER_FRAGMENTATION",
  reference.evidenceRefs,
);
const anatomy = deriveEffectAnatomyV1(reference, "SHUTTER_FRAGMENTATION");
const graph = buildConstructionGraphV1(anatomy);
const compilation = compileConstructionGraphV1(graph, capabilities);
const comparison = compareSemanticVisualFidelityV1({
  reference,
  render,
  dna,
  alignment: "FRAME_ALIGNED",
});
const gate = evaluateProfessionalFidelityGateV1({
  comparison,
  compilation,
  synthesisPossible: true,
});
const actuationPlan = deriveConstructionActuationPlanV1({ graph, comparison });

const result = {
  schema: "editflow.m6.local-shutter-fidelity-proof.v1",
  executedAt: new Date().toISOString(),
  tag,
  result: gate.certified ? "CERTIFIED" : "REJECTED",
  reference: {
    sourceId: reference.sourceId,
    contentKey: reference.contentKey,
    analyzerFingerprint: reference.analyzerFingerprint,
    settingsFingerprint: reference.settingsFingerprint,
    range: reference.range,
    summary: reference.summary,
    shutterContract: referenceContract,
  },
  render: {
    sourceId: render.sourceId,
    contentKey: render.contentKey,
    analyzerFingerprint: render.analyzerFingerprint,
    settingsFingerprint: render.settingsFingerprint,
    range: render.range,
    summary: render.summary,
    classifiedFamily: classifyEffectFamilyV1(render),
    shutterContract: distinguishShutterFromFlashZoomV1(render),
  },
  comparison,
  gate,
  actuationPlan,
  evidenceBoundary: [
    "This proof compares one pre-isolated transition cut only; it does not use sequence-event detection or cross-cut H.264 context.",
    "Certification remains fail-closed on every defining Transition DNA invariant and the compiled capability graph.",
  ],
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  tag,
  certified: gate.certified,
  weightedFidelity: comparison.weightedFidelity,
  definingCoverage: comparison.definingCoverage,
  residualInvariantIds: gate.underDrivenInvariantIds,
  renderFamily: result.render.classifiedFamily,
}));
