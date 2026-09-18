import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { evaluateSparseVisualProofV1 } from "./sparse-visual-evaluator.mjs";
import {
  TUTORIAL_001_VISUAL_ANCHOR_MS,
  TUTORIAL_001_VISUAL_RULES,
  framesFromSparseCaptureV1,
} from "./tutorial-001-visual-profile.mjs";

const INPUT = "proofs/diagnostics/m5-tutorial-001-live-adaptive-visual.json";
const OUTPUT = "proofs/diagnostics/m5-tutorial-001-sparse-visual-assessment.json";
const EVALUATOR_SOURCE = "scripts/proofs/sparse-visual-evaluator.mjs";
const PROFILE_SOURCE = "scripts/proofs/tutorial-001-visual-profile.mjs";

const hashFile = async (path) =>
  createHash("sha256").update(await readFile(path)).digest("hex");

const hashFrames = async (frames) =>
  Promise.all(frames.map(async (frame) => ({
    timeMs: frame.timeMs,
    sha256: await hashFile(frame.path),
  })));

const main = async () => {
  const liveEvidence = JSON.parse(await readFile(INPUT, "utf8"));
  if (!liveEvidence.visual?.baseline || !liveEvidence.visual?.edited) {
    throw new Error("Tutorial 001 live visual evidence is incomplete.");
  }
  if (liveEvidence.cleanup?.baselineFingerprintRestored !== true
    || liveEvidence.cleanup?.baselineItemCountRestored !== true
    || liveEvidence.cleanup?.baselineStableIdsRestored !== true) {
    throw new Error("Tutorial 001 live visual evidence did not restore the AE baseline.");
  }
  const baselineFrames = framesFromSparseCaptureV1(liveEvidence.visual.baseline);
  const editedFrames = framesFromSparseCaptureV1(liveEvidence.visual.edited);
  const assessment = await evaluateSparseVisualProofV1({
    baselineFrames,
    editedFrames,
    anchorMs: TUTORIAL_001_VISUAL_ANCHOR_MS,
    rules: TUTORIAL_001_VISUAL_RULES,
  });
  const evidence = {
    proof: "M5_TUTORIAL_001_SPARSE_VISUAL_ASSESSMENT_V1",
    sourceVisualProof: INPUT,
    liveVisualSourceCommit: liveEvidence.sourceCommit ?? null,
    liveVisualStartedAt: liveEvidence.startedAt ?? null,
    rules: TUTORIAL_001_VISUAL_RULES,
    evaluatorSourceHashes: {
      evaluator: await hashFile(EVALUATOR_SOURCE),
      tutorialProfile: await hashFile(PROFILE_SOURCE),
    },
    frameHashes: {
      baseline: await hashFrames(baselineFrames),
      edited: await hashFrames(editedFrames),
    },
    assessment,
    rollback: liveEvidence.cleanup ?? null,
    assessedAt: new Date().toISOString(),
  };
  await writeFile(OUTPUT, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  if (!assessment.passed) {
    throw new Error(
      "Tutorial 001 sparse visual assessment failed: " + assessment.issues.join(", "),
    );
  }
  console.log(JSON.stringify({ ok: true, evidence: OUTPUT, assessment }));
};

await main();
