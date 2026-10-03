import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalPracticeMediaMatcherV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";

const ffmpeg = process.env.EDITFLOW_FFMPEG_PATH || execFileSync(
  process.platform === "win32" ? "py" : "python3",
  process.platform === "win32" ? ["-3.12", "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"]
    : ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"],
  { encoding: "utf8" }).trim();

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-incremental-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "raw.mp4");
  const finishPath = path.join(root, "reference.mp4");
  const release = path.join(root, "release");
  const counter = path.join(root, "runs");
  const scriptPath = path.join(root, "stub.cjs");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10",
    "-t", "4", "-pix_fmt", "yuv420p", "-y", sourcePath]);
  await writeFile(finishPath, "reference-only-fixture");
  const proof = { anchorCount: 3, strongAnchorCount: 3, strongAnchorFraction: 1,
    meanSupport: 0.9, minimumSupport: 0.8, maximumInlierCount: 30, meanInlierRatio: 0.9, meanCoverage: 0.5 };
  const stub = `
const fs = require("node:fs");
const args = process.argv.slice(2);
const value = (key) => args[args.indexOf(key) + 1];
const targets = args.flatMap((arg, i) => arg === "--shot-id" ? [args[i + 1]] : []);
const release = ${JSON.stringify(release)};
fs.appendFileSync(${JSON.stringify(counter)}, args[0] + ":" + targets.join(",") + "\\n");
async function main() {
  let data;
  if (args[0] === "reference") data = {
    schema: "editflow.practice-reference-analysis.v1", referenceId: value("--reference-id"),
    sourcePath: value("--video"), styleFingerprint: "style:test", perceptualSignature: "ref",
    shots: [1, 2].map((n) => ({ shotId: "shot:" + n, order: n - 1,
      referenceStartMs: (n - 1) * 1000, referenceEndMs: n * 1000, evidenceRefs: [] })), evidenceRefs: [] };
  else if (args[0] !== "match") data = {
    schema: "editflow.practice-source-index.v1", sourceId: value("--source-id"),
    sourcePath: value("--video"), sourceSha256: "raw:test", perceptualSignature: "raw", evidenceRefs: [] };
  else {
    const ref = JSON.parse(fs.readFileSync(value("--reference-json")));
    const source = JSON.parse(fs.readFileSync(value("--source-index-json")));
    const seed = args.includes("--seed-matches") ? JSON.parse(fs.readFileSync(value("--seed-matches"))).matches : [];
    const matches = new Map(seed.map((match) => [match.shotId, match]));
    for (const n of [1, 2]) {
      const shotId = "shot:" + n;
      if (targets.length && !targets.includes(shotId)) continue;
      const match = { shotId, sourceId: source.sourceId, sourcePath: source.sourcePath,
        sourceStartMs: n * 1000, sourceEndMs: n * 1000 + 500, direction: "FORWARD",
        playbackRate: 1, confidence: n === 1 ? 0.99 : 0.6,
        geometricProof: ${JSON.stringify(proof)}, evidenceRefs: ["fixture:raw-match"] };
      matches.set(shotId, match);
      console.log(JSON.stringify({ schema: "editflow.practice-match-progress.v1", match }));
      if (n === 1 && !targets.length) {
        const deadline = Date.now() + 15000;
        while (!fs.existsSync(release)) {
          if (Date.now() > deadline) throw Error("Clip was not materialized before next shot");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    }
    data = { schema: "editflow.practice-scene-matches.v1", referenceId: ref.referenceId,
      matches: [...matches.values()], evidenceRefs: [] };
  }
  fs.writeFileSync(value("--output"), JSON.stringify(data));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
`;
  await writeFile(scriptPath, stub);
  const matcher = (signal) => new LocalPracticeMediaMatcherV1({ shotSelectionAuthority: "ISOLATED_LEGACY_TEST", artifactDir: path.join(root, "artifacts"),
    analysisCacheDir: path.join(root, "cache"), scriptPath, ffmpegPath: ffmpeg,
    python: { executable: process.execPath, prefixArgs: [] }, materializeWorkingMedia: true,
    workingMediaHandleMs: 100, ...(signal ? { signal } : {}) });
  const analyze = async (m) => ({
    reference: await m.analyzeFinish({ mediaId: "ref", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: finishPath }),
    sourceIndex: await m.indexStart([{ mediaId: "raw", role: "START_SOURCE", mediaKind: "VIDEO", uri: sourcePath }]),
    minimumConfidence: 0.95 });
  return { root, matcher, analyze, release, counter };
}

test("one unresolved shot cannot suppress proven clip creation; resume reuses clips and targets only unresolved shots", async (t) => {
  const f = await fixture(t);
  let earlyClip = null;
  const m = f.matcher();
  const input = await f.analyze(m);
  const matches = await m.matchScenes({ ...input, onProgress: async (partial, stage) => {
    if (stage === "WORKING_MEDIA" && partial.length === 1) {
      earlyClip = partial[0].workingMedia.sourcePath;
      assert.ok((await stat(earlyClip)).size > 0);
      await writeFile(f.release, "continue");
    }
  } });
  assert.ok(earlyClip);
  assert.equal(matches[0].workingMedia.sourcePath, earlyClip);
  assert.equal(matches[1].workingMedia, undefined);
  const runs = await readFile(f.counter, "utf8");
  assert.match(runs, /match:shot:2/);
  const resumed = f.matcher();
  assert.deepEqual(await resumed.matchScenes(await f.analyze(resumed)), matches);
  assert.equal(await readFile(f.counter, "utf8"), runs);
});

test("abort retains the first bounded clip and a fresh controller resumes its cached progress", async (t) => {
  const f = await fixture(t);
  const abort = new AbortController();
  const m = f.matcher(abort.signal);
  let retainedClip;
  await assert.rejects(m.matchScenes({ ...await f.analyze(m), onProgress: async (partial, stage) => {
    if (stage === "WORKING_MEDIA" && partial.length === 1) {
      retainedClip = partial[0].workingMedia.sourcePath;
      await writeFile(f.release, "continue");
      abort.abort();
    }
  } }));
  assert.ok((await stat(retainedClip)).size > 0);
  const resumed = f.matcher();
  const matches = await resumed.matchScenes(await f.analyze(resumed));
  assert.equal(matches[0].workingMedia.sourcePath, retainedClip);
  assert.equal(matches[1].confidence, 0.6);
});
