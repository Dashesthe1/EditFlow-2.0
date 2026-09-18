import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

const requireFinite = (value, name) => {
  if (!Number.isFinite(value)) throw new Error(name + " must be finite.");
  return value;
};

const loadPng = async (path) => PNG.sync.read(await readFile(path));

const isBorderPixel = (x, y, width, height, borderWidth) =>
  x < borderWidth || y < borderWidth
  || x >= width - borderWidth || y >= height - borderWidth;

const inRoi = (x, y, width, height, roi) => {
  if (!roi) return false;
  const cx = roi.center[0] * width;
  const cy = roi.center[1] * height;
  const radius = roi.radiusPx;
  return Math.abs(x - cx) <= radius && Math.abs(y - cy) <= radius;
};

const frameMetrics = (baseline, edited, options) => {
  if (baseline.width !== edited.width || baseline.height !== edited.height) {
    throw new Error("Sparse visual frame dimensions do not match.");
  }
  const { width, height } = edited;
  const threshold = options.changeThreshold ?? 12;
  const borderWidth = options.borderWidth ?? 12;
  let absSum = 0, changed = 0, borderNearBlack = 0, borderCount = 0;
  let roiCount = 0, roiLumaSum = 0, roiLumaSqSum = 0;
  const pixelCount = width * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      let maxDelta = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(edited.data[offset + channel] - baseline.data[offset + channel]);
        absSum += delta;
        if (delta > maxDelta) maxDelta = delta;
      }
      if (maxDelta > threshold) changed += 1;
      if (isBorderPixel(x, y, width, height, borderWidth)) {
        borderCount += 1;
        if (edited.data[offset] < 12 && edited.data[offset + 1] < 12
          && edited.data[offset + 2] < 12) borderNearBlack += 1;
      }
      if (inRoi(x, y, width, height, options.roi)) {
        const luma = edited.data[offset] * 0.2126
          + edited.data[offset + 1] * 0.7152
          + edited.data[offset + 2] * 0.0722;
        roiCount += 1;
        roiLumaSum += luma;
        roiLumaSqSum += luma * luma;
      }
    }
  }
  const roiMean = roiCount ? roiLumaSum / roiCount : null;
  const roiVariance = roiCount
    ? Math.max(0, roiLumaSqSum / roiCount - roiMean * roiMean)
    : null;
  return {
    width,
    height,
    meanAbsDiff: absSum / (pixelCount * 3),
    changedPixelRatio: changed / pixelCount,
    borderNearBlackRatio: borderCount ? borderNearBlack / borderCount : 0,
    roiLumaStd: roiVariance === null ? null : Math.sqrt(roiVariance),
  };
};

export const evaluateSparseVisualProofV1 = async ({
  baselineFrames,
  editedFrames,
  anchorMs,
  rules = {},
}) => {
  requireFinite(anchorMs, "anchorMs");
  if (!Array.isArray(baselineFrames) || !Array.isArray(editedFrames)
    || baselineFrames.length === 0 || baselineFrames.length !== editedFrames.length) {
    throw new Error("Sparse visual proof requires paired baseline and edited frames.");
  }
  if (rules.roi !== undefined
    && (!Array.isArray(rules.roi.center) || rules.roi.center.length !== 2
      || !rules.roi.center.every(Number.isFinite)
      || !Number.isFinite(rules.roi.radiusPx) || rules.roi.radiusPx <= 0)) {
    throw new Error("Sparse visual ROI must contain a finite normalized center and positive radiusPx.");
  }
  const metrics = [];
  for (let index = 0; index < baselineFrames.length; index += 1) {
    const baseline = baselineFrames[index];
    const edited = editedFrames[index];
    if (baseline.timeMs !== edited.timeMs) throw new Error("Sparse visual frame times do not align.");
    metrics.push({
      timeMs: baseline.timeMs,
      ...frameMetrics(await loadPng(baseline.path), await loadPng(edited.path), rules),
    });
  }
  const issues = [];
  const peak = metrics.reduce((best, current) =>
    current.meanAbsDiff > best.meanAbsDiff ? current : best);
  if (rules.anchorToleranceMs !== undefined
    && Math.abs(peak.timeMs - anchorMs) > rules.anchorToleranceMs) {
    issues.push("VISUAL_PEAK_OUTSIDE_ANCHOR_WINDOW");
  }
  const anchor = metrics.find((frame) => frame.timeMs === anchorMs) ?? null;
  if ((rules.minAnchorToPeakRatio !== undefined
      || rules.minAnchorToTailRatio !== undefined) && anchor === null) {
    issues.push("ANCHOR_FRAME_MISSING");
  }
  if (anchor !== null && rules.minAnchorToPeakRatio !== undefined
    && anchor.meanAbsDiff < peak.meanAbsDiff * rules.minAnchorToPeakRatio) {
    issues.push("ANCHOR_VISUAL_STRENGTH_LOW");
  }
  if (rules.maxBorderNearBlackRatio !== undefined
    && metrics.some((frame) => frame.borderNearBlackRatio > rules.maxBorderNearBlackRatio)) {
    issues.push("BLACK_BORDER_OR_FRAME_EXPOSURE");
  }
  if (rules.minRoiLumaStd !== undefined
    && metrics.some((frame) => frame.roiLumaStd !== null
      && frame.roiLumaStd < rules.minRoiLumaStd)) {
    issues.push("SUBJECT_ROI_READABILITY_LOW");
  }
  if (Array.isArray(rules.tailTimesMs)
    && (rules.minPeakToTailRatio !== undefined
      || rules.minAnchorToTailRatio !== undefined)) {
    const tails = rules.tailTimesMs.map((timeMs) =>
      metrics.find((frame) => frame.timeMs === timeMs)).filter(Boolean);
    if (tails.length !== rules.tailTimesMs.length) {
      issues.push("TAIL_FRAME_MISSING");
    } else {
      if (rules.minPeakToTailRatio !== undefined && tails.some((tail) =>
        peak.meanAbsDiff < tail.meanAbsDiff * rules.minPeakToTailRatio)) {
        issues.push("VISUAL_PULSE_NOT_CONCENTRATED");
      }
      if (anchor !== null && rules.minAnchorToTailRatio !== undefined
        && tails.some((tail) =>
          anchor.meanAbsDiff < tail.meanAbsDiff * rules.minAnchorToTailRatio)) {
        issues.push("ANCHOR_PULSE_NOT_CONCENTRATED");
      }
    }
  }
  return {
    schema: "editflow.sparse-visual-assessment.v1",
    passed: issues.length === 0,
    anchorMs,
    anchor: anchor === null
      ? null
      : { timeMs: anchor.timeMs, meanAbsDiff: anchor.meanAbsDiff },
    peak: { timeMs: peak.timeMs, meanAbsDiff: peak.meanAbsDiff },
    metrics,
    issues,
  };
};
