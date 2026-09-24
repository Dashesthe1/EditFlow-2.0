import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LocalPracticeMediaMatcherV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

test("Practice reference analysis preserves explicit excluded Finish tail evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "editflow-practice-tail-"));
  const runnerPath = path.join(directory, "runner.mjs");
  const scriptPath = path.join(directory, "practice-media-match.py");
  const finishPath = path.join(directory, "finish.mp4");
  await writeFile(scriptPath, "# fake analyzer\n", "utf8");
  await writeFile(finishPath, "finish bytes", "utf8");

  await writeFile(runnerPath, [
    'import { writeFile } from "node:fs/promises";',
    'const args = process.argv.slice(3);',
    'const outputIndex = args.indexOf("--output");',
    'const referenceIndex = args.indexOf("--reference-id");',
    'const videoIndex = args.indexOf("--video");',
    'const artifact = {',
    '  schema: "editflow.practice-reference-analysis.v1",',
    '  referenceId: args[referenceIndex + 1],',
    '  sourcePath: args[videoIndex + 1],',
    '  styleFingerprint: "style:without-static-tail",',
    '  video: { fps: 30, frameCount: 300, width: 1080, height: 1080, durationMs: 8000, sourceDurationMs: 10000 },',
    '  shots: [{ shotId: "shot:0001", order: 0, referenceStartMs: 0, referenceEndMs: 8000, evidenceRefs: ["shot-proof"] }],',
    '  excludedRanges: [{',
    '    kind: "STATIC_LOW_INFORMATION_TAIL",',
    '    referenceStartMs: 8000,',
    '    referenceEndMs: 10000,',
    '    confidence: 0.97,',
    '    evidenceRefs: ["tail-metrics-proof", "tail-confidence-proof"],',
    '  }],',
    '  evidenceRefs: ["reference-proof", "practice-reference-excluded-range-ms:8000-10000:STATIC_LOW_INFORMATION_TAIL"],',
    '};',
    'await writeFile(args[outputIndex + 1], JSON.stringify(artifact), "utf8");',
  ].join("\n"), "utf8");

  try {
    const matcher = new LocalPracticeMediaMatcherV1({
      artifactDir: path.join(directory, "artifacts"),
      scriptPath,
      python: { executable: process.execPath, prefixArgs: [runnerPath] },
    });
    const result = await matcher.analyzeFinish({
      mediaId: "finish:tail-regression",
      mediaKind: "VIDEO",
      uri: finishPath,
    });

    assert.equal(result.video?.durationMs, 8000);
    assert.equal(result.video?.sourceDurationMs, 10000);
    assert.equal(result.shots.length, 1);
    assert.equal(result.shots[0].referenceEndMs, 8000);
    assert.equal(result.excludedRanges?.length, 1);
    assert.deepEqual(result.excludedRanges?.[0], {
      kind: "STATIC_LOW_INFORMATION_TAIL",
      referenceStartMs: 8000,
      referenceEndMs: 10000,
      confidence: 0.97,
      evidenceRefs: ["tail-metrics-proof", "tail-confidence-proof"],
    });
    assert.ok(result.evidenceRefs.some((ref) =>
      ref === "practice-reference-excluded-range-ms:8000-10000:STATIC_LOW_INFORMATION_TAIL"
    ));
    assert.ok(result.evidenceRefs.some((ref) =>
      ref.startsWith("practice-reference-artifact:")
    ));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
