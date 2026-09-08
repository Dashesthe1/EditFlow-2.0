import { readFile, writeFile } from "node:fs/promises";

const replaceExact = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing guarded block: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Guarded block is not unique: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const cliPath = "apps/desktop-host/src/m3-temporal-ease-p3-p4-cli.ts";
let cli = await readFile(cliPath, "utf8");

cli = replaceExact(
  cli,
  `  let cleanupUndoCount = 0;\n  let baselineEase: AeTemporalEaseStateV18 | null = null;\n  let strongEase: AeTemporalEaseStateV18 | null = null;`,
  `  let cleanupUndoCount = 0;\n  let nativeBaselineEase: AeTemporalEaseStateV18 | null = null;\n  let baselineEase: AeTemporalEaseStateV18 | null = null;\n  let strongEase: AeTemporalEaseStateV18 | null = null;`,
  "baseline evidence declarations",
);

cli = replaceExact(
  cli,
  `    const baselineRead = await dispatchV18("property.temporal_ease.readback", targetPayload(), null);\n    baselineEase = easeStateFromResponse(baselineRead);\n    checks.p3_baseline_ease_captured = baselineRead.outcome === "NO_OP"\n      && baselineEase !== null\n      && baselineEase.inEase.length === 1\n      && baselineEase.outEase.length === 1\n      && interpolationIsManualBezier(baselineRead);\n    if (baselineEase === null || !checks.p3_baseline_ease_captured) throw new Error("Unable to capture exact AE baseline KeyframeEase state.");\n\n    const baselineCompletion = await renderComp(baselineRenderPath);`,
  `    const nativeBaselineRead = await dispatchV18("property.temporal_ease.readback", targetPayload(), null);\n    nativeBaselineEase = easeStateFromResponse(nativeBaselineRead);\n    checks.p3_native_baseline_ease_captured = nativeBaselineRead.outcome === "NO_OP"\n      && nativeBaselineEase !== null\n      && nativeBaselineEase.inEase.length === 1\n      && nativeBaselineEase.outEase.length === 1\n      && interpolationIsManualBezier(nativeBaselineRead);\n    if (nativeBaselineEase === null || !checks.p3_native_baseline_ease_captured) throw new Error("Unable to capture the native AE KeyframeEase state/cardinality.");\n\n    // AE 25.6.6 can expose a native manual-BEZIER baseline influence of 0 even\n    // though KeyframeEase writes correctly require Adobe's documented minimum\n    // influence of 0.1. P3/P4 therefore retain the native readback as provenance\n    // but establish a legal deterministic protocol-1.8 baseline before rendering.\n    // This keeps P3 restoration on the public write path and gives P4 an exact\n    // writable pre-failure state to which the normal transaction undo can return.\n    baselineEase = contrastingEase(nativeBaselineEase, 20);\n    const baselineSet = await setEaseExact(baselineEase);\n    checks.p3_baseline_ease_established = easeStateMatches(baselineSet, baselineEase);\n    const baselineRead = await dispatchV18("property.temporal_ease.readback", targetPayload(), null);\n    checks.p3_baseline_ease_captured = baselineRead.outcome === "NO_OP"\n      && easeStateMatches(baselineRead, baselineEase)\n      && interpolationIsManualBezier(baselineRead);\n    if (!checks.p3_baseline_ease_established || !checks.p3_baseline_ease_captured) throw new Error("Unable to establish and read back the deterministic writable P3/P4 baseline ease.");\n\n    const baselineCompletion = await renderComp(baselineRenderPath);`,
  "native-to-writable baseline establishment",
);

cli = replaceExact(
  cli,
  `      && checks.manual_bezier_setup === true\n      && checks.p3_baseline_ease_captured === true\n      && checks.p3_contrast_state_differs_from_baseline === true`,
  `      && checks.manual_bezier_setup === true\n      && checks.p3_native_baseline_ease_captured === true\n      && checks.p3_baseline_ease_established === true\n      && checks.p3_baseline_ease_captured === true\n      && checks.p3_contrast_state_differs_from_baseline === true`,
  "P3 success predicate",
);

cli = replaceExact(
  cli,
  `        baselineEase,\n        strongEase,`,
  `        nativeBaselineEase,\n        baselineEase,\n        strongEase,`,
  "fixture ease evidence",
);

cli = replaceExact(
  cli,
  `          "baselineRender is the exact AE manual-BEZIER KeyframeEase state captured before protocol-1.8 mutation",\n          "easedRender must visibly differ from baselineRender at one or more intermediate frames while preserving the same keyframe times and values",\n          "restoredBaselineRender must return to the baseline motion/opacity timing after the exact captured KeyframeEase state is restored",`,
  `          "baselineRender is the exact deterministic writable protocol-1.8 manual-BEZIER baseline established after retaining AE's native ease readback/cardinality",\n          "easedRender must visibly differ from baselineRender at one or more intermediate frames while preserving the same keyframe times and values",\n          "restoredBaselineRender must return to the baseline motion/opacity timing after the exact deterministic writable KeyframeEase state is restored",`,
  "visual review wording",
);

await writeFile(cliPath, cli, "utf8");

const testPath = "tests/m3-temporal-ease-p3-p4-harness.test.mjs";
let testSource = await readFile(testPath, "utf8");
testSource = replaceExact(
  testSource,
  `test("P3 captures AE's actual manual-Bezier baseline ease before creating a deliberate zero-speed high-influence contrast", async () => {\n  const source = await readFile(cliPath, "utf8");\n  assert.match(source, /property\\.temporal_ease\\.readback/);\n  assert.match(source, /baselineEase = easeStateFromResponse/);\n  assert.match(source, /contrastingEase\\(baselineEase, 80\\)/);\n  assert.match(source, /speed: 0, influence/);`,
  `test("P3 retains AE's native ease then establishes a deterministic writable baseline before the high-influence contrast", async () => {\n  const source = await readFile(cliPath, "utf8");\n  assert.match(source, /property\\.temporal_ease\\.readback/);\n  assert.match(source, /nativeBaselineEase = easeStateFromResponse/);\n  assert.match(source, /baselineEase = contrastingEase\\(nativeBaselineEase, 20\\)/);\n  assert.match(source, /setEaseExact\\(baselineEase\\)/);\n  assert.match(source, /p3_native_baseline_ease_captured/);\n  assert.match(source, /p3_baseline_ease_established/);\n  assert.match(source, /contrastingEase\\(baselineEase, 80\\)/);\n  assert.match(source, /speed: 0, influence/);`,
  "P3 harness contract",
);
await writeFile(testPath, testSource, "utf8");
