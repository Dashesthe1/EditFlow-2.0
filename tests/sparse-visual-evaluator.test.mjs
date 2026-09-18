import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";

import { evaluateSparseVisualProofV1 } from "../scripts/proofs/sparse-visual-evaluator.mjs";

const WIDTH = 20;
const HEIGHT = 20;
const TIMES = [0, 100, 200];

const baseRgb = (x, y) => {
  const hero = x >= 6 && x <= 14 && y >= 6 && y <= 14;
  if (!hero) return [80, 80, 80];
  const value = (x + y) % 2 === 0 ? 70 : 190;
  return [value, value, value];
};

const writePng = async (path, mutate = (rgb) => rgb) => {
  const image = new PNG({ width: WIDTH, height: HEIGHT });
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      const [r, g, b, a = 255] = mutate(baseRgb(x, y), x, y);
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = a;
    }
  }
  await writeFile(path, PNG.sync.write(image));
};
const buildFrames = async (dir, editedMutators) => {
  const baseline = [];
  const edited = [];
  for (const timeMs of TIMES) {
    const baselinePath = join(dir, "baseline-" + timeMs + ".png");
    const editedPath = join(dir, "edited-" + timeMs + ".png");
    await writePng(baselinePath);
    await writePng(editedPath, editedMutators.get(timeMs) ?? ((rgb) => rgb));
    baseline.push({ timeMs, path: baselinePath });
    edited.push({ timeMs, path: editedPath });
  }
  return { baseline, edited };
};

const RULES = {
  anchorToleranceMs: 0,
  changeThreshold: 12,
  borderWidth: 1,
  maxBorderNearBlackRatio: 0.01,
  roi: { center: [0.5, 0.5], radiusPx: 4 },
  minRoiLumaStd: 20,
  tailTimesMs: [0, 200],
  minPeakToTailRatio: 2,
};

test("sparse visual evaluator accepts a localized readable anchor pulse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "editflow-visual-good-"));
  try {
    const invertHero = (rgb, x, y) =>
      x >= 6 && x <= 14 && y >= 6 && y <= 14
        ? rgb.map((value) => 255 - value)
        : rgb;
    const frames = await buildFrames(dir, new Map([[100, invertHero]]));
    const assessment = await evaluateSparseVisualProofV1({
      baselineFrames: frames.baseline,
      editedFrames: frames.edited,
      anchorMs: 100,
      rules: RULES,
    });
    assert.equal(assessment.passed, true, assessment.issues.join(", "));
    assert.equal(assessment.peak.timeMs, 100);
    assert.deepEqual(assessment.issues, []);
    assert.ok(assessment.metrics.every((frame) => frame.borderNearBlackRatio === 0));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sparse visual evaluator rejects black-frame exposure and unreadable ROI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "editflow-visual-black-"));
  try {
    const frames = await buildFrames(dir, new Map([[100, () => [0, 0, 0]]]));
    const assessment = await evaluateSparseVisualProofV1({
      baselineFrames: frames.baseline,
      editedFrames: frames.edited,
      anchorMs: 100,
      rules: RULES,
    });
    assert.equal(assessment.passed, false);
    assert.ok(assessment.issues.includes("BLACK_BORDER_OR_FRAME_EXPOSURE"));
    assert.ok(assessment.issues.includes("SUBJECT_ROI_READABILITY_LOW"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sparse visual evaluator rejects a visual peak displaced from the edit anchor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "editflow-visual-anchor-"));
  try {
    const invertHero = (rgb, x, y) =>
      x >= 6 && x <= 14 && y >= 6 && y <= 14
        ? rgb.map((value) => 255 - value)
        : rgb;
    const frames = await buildFrames(dir, new Map([[0, invertHero]]));
    const assessment = await evaluateSparseVisualProofV1({
      baselineFrames: frames.baseline,
      editedFrames: frames.edited,
      anchorMs: 100,
      rules: { ...RULES, tailTimesMs: undefined, minPeakToTailRatio: undefined },
    });
    assert.equal(assessment.passed, false);
    assert.ok(assessment.issues.includes("VISUAL_PEAK_OUTSIDE_ANCHOR_WINDOW"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sparse visual evaluator can require a strong anchor without conflating it with frame-difference peak time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "editflow-visual-anchor-strength-"));
  try {
    const invertHero = (rgb, x, y) =>
      x >= 6 && x <= 14 && y >= 6 && y <= 14
        ? rgb.map((value) => 255 - value)
        : rgb;
    const frames = await buildFrames(dir, new Map([[0, invertHero], [100, invertHero]]));
    const assessment = await evaluateSparseVisualProofV1({
      baselineFrames: frames.baseline,
      editedFrames: frames.edited,
      anchorMs: 100,
      rules: {
        ...RULES,
        anchorToleranceMs: undefined,
        tailTimesMs: [200],
        minPeakToTailRatio: 2,
        minAnchorToPeakRatio: 0.85,
        minAnchorToTailRatio: 1.5,
      },
    });
    assert.equal(assessment.peak.timeMs, 0);
    assert.equal(assessment.anchor.timeMs, 100);
    assert.equal(assessment.passed, true, assessment.issues.join(", "));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sparse visual evaluator rejects an anchor that is weak relative to a displaced visual peak", async () => {
  const dir = await mkdtemp(join(tmpdir(), "editflow-visual-anchor-weak-"));
  try {
    const invertHero = (rgb, x, y) =>
      x >= 6 && x <= 14 && y >= 6 && y <= 14
        ? rgb.map((value) => 255 - value)
        : rgb;
    const frames = await buildFrames(dir, new Map([[0, invertHero]]));
    const assessment = await evaluateSparseVisualProofV1({
      baselineFrames: frames.baseline,
      editedFrames: frames.edited,
      anchorMs: 100,
      rules: {
        ...RULES,
        anchorToleranceMs: undefined,
        tailTimesMs: [200],
        minPeakToTailRatio: 2,
        minAnchorToPeakRatio: 0.85,
        minAnchorToTailRatio: 1.5,
      },
    });
    assert.equal(assessment.passed, false);
    assert.ok(assessment.issues.includes("ANCHOR_VISUAL_STRENGTH_LOW"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sparse visual evaluator distinguishes transparent exposure from opaque dark content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "editflow-visual-alpha-"));
  try {
    const border = (_rgb, x, y, alpha) =>
      x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1
        ? [0, 0, 0, alpha]
        : baseRgb(x, y);
    const rules = {
      ...RULES,
      maxBorderNearBlackRatio: undefined,
      maxBorderTransparentRatio: 0.01,
    };

    const opaque = await buildFrames(dir, new Map([
      [100, (rgb, x, y) => border(rgb, x, y, 255)],
    ]));
    const opaqueAssessment = await evaluateSparseVisualProofV1({
      baselineFrames: opaque.baseline,
      editedFrames: opaque.edited,
      anchorMs: 100,
      rules,
    });
    assert.equal(opaqueAssessment.passed, true, opaqueAssessment.issues.join(", "));
    assert.equal(opaqueAssessment.metrics[1].borderTransparentRatio, 0);

    const transparent = await buildFrames(dir, new Map([
      [100, (rgb, x, y) => border(rgb, x, y, 0)],
    ]));
    const transparentAssessment = await evaluateSparseVisualProofV1({
      baselineFrames: transparent.baseline,
      editedFrames: transparent.edited,
      anchorMs: 100,
      rules,
    });
    assert.equal(transparentAssessment.passed, false);
    assert.ok(transparentAssessment.issues.includes("TRANSPARENT_BORDER_OR_FRAME_EXPOSURE"));
    assert.ok(transparentAssessment.metrics[1].borderTransparentRatio > 0.01);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
