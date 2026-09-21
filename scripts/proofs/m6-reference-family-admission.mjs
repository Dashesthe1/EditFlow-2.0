import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCanonicalProfessionalBenchmarkV1,
  evaluateReferenceFamilyCandidateV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const value = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) {
    throw new Error("Missing required argument " + name);
  }
  return argv[index + 1];
};

const evidencePath = path.resolve(value("--evidence"));
const outputPath = path.resolve(value("--output"));
const family = value("--family");
const supportedFamilies = new Set(
  createCanonicalProfessionalBenchmarkV1().map((item) => item.family),
);
if (!supportedFamilies.has(family)) {
  throw new Error("Unsupported M6 benchmark family: " + family);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relative = (file) => path.relative(ROOT, file).replaceAll("\\", "/");
const evidenceBytes = await readFile(evidencePath);
const evidenceSha256 = sha256(evidenceBytes);
const evidence = JSON.parse(evidenceBytes.toString("utf8"));
if (evidence.schema !== "editflow.dense-effect-evidence.v1") {
  throw new Error("Unsupported dense evidence schema: " + evidence.schema);
}

const candidate = evaluateReferenceFamilyCandidateV1(evidence, family);
const sourceVideoRef = candidate.evidenceRefs.find((item) =>
  item.startsWith("video:sha256:")) ?? null;
const payload = {
  schema: "editflow.m6.reference-family-admission-proof.v1",
  authority: "SOURCE_ADMISSION_ONLY_NOT_PROFESSIONAL_FIDELITY",
  result: candidate.passed ? "ADMITTED" : "REJECTED",
  requestedFamily: family,
  sourceEvidence: {
    ref: relative(evidencePath),
    sha256: evidenceSha256,
    contentKey: evidence.contentKey,
    sourceId: evidence.sourceId,
    analyzerFingerprint: evidence.analyzerFingerprint,
    sourceVideoSha256: sourceVideoRef === null
      ? null
      : sourceVideoRef.slice("video:sha256:".length),
  },
  candidate,
  noOverclaim: candidate.passed
    ? "Admission means the reference window satisfies family-defining DNA and may enter reconstruction; it is not a fidelity pass."
    : "Rejected source windows must not enter benchmark reconstruction as evidence for the requested family.",
  proofSources: {
    evaluator: "packages/visual-effects-intelligence/src/reference-admission.ts",
    evaluatorSha256: sha256(await readFile(path.join(
      ROOT,
      "packages",
      "visual-effects-intelligence",
      "src",
      "reference-admission.ts",
    ))),
    generator: relative(fileURLToPath(import.meta.url)),
    generatorSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  result: payload.result,
  family,
  definingCoverage: candidate.definingCoverage,
  weightedContractScore: candidate.weightedContractScore,
  failures: candidate.failures,
}));
