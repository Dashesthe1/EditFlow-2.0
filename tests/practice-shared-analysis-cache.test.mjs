import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalPracticeMediaMatcherV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";

test("Practice shares immutable media analysis across sessions and invalidates changed media", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-shared-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const counter = path.join(root, "runs.txt");
  const scriptPath = path.join(root, "stub.cjs");
  const stub = [
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const value = (key) => args[args.indexOf(key) + 1];",
    "fs.appendFileSync(" + JSON.stringify(counter) + ", args[0] + '\\n');",
    "const common = { evidenceRefs: [] };",
    "const data = args[0] === 'audio-match'",
    "  ? { ...common, schema: 'editflow.practice-audio-match.v1', match: null }",
    "  : args[0] === 'reference'",
    "  ? { ...common, schema: 'editflow.practice-reference-analysis.v1',",
    "      referenceId: value('--reference-id'), sourcePath: value('--video'),",
    "      styleFingerprint: 'style:test', perceptualSignature: 'signature:test',",
    "      shots: [{ shotId: 'shot:1', order: 0, referenceStartMs: 0,",
    "        referenceEndMs: 1000, evidenceRefs: [] }] }",
    "  : { ...common, schema: 'editflow.practice-source-index.v1',",
    "      sourceId: value('--source-id'), sourcePath: value('--video'),",
    "      perceptualSignature: 'signature:source' };",
    "fs.writeFileSync(value('--output'), JSON.stringify(data));",
  ].join("\n");
  await writeFile(scriptPath, stub);
  const finishPath = path.join(root, "finish.mp4");
  const sourcePath = path.join(root, "source.mp4");
  const audioPath = path.join(root, "music.wav");
  await writeFile(finishPath, "reference-bytes");
  await writeFile(sourcePath, "source-bytes");
  await writeFile(audioPath, "audio-bytes");
  const finish = { mediaId: "finish:1", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: finishPath };
  const source = [
    { mediaId: "source:1", role: "START_SOURCE", mediaKind: "VIDEO", uri: sourcePath },
    { mediaId: "audio:1", role: "START_SOURCE", mediaKind: "AUDIO", uri: audioPath },
  ];
  const cache = path.join(root, "shared-cache");
  const matcher = (session) => new LocalPracticeMediaMatcherV1({
    artifactDir: path.join(root, session),
    analysisCacheDir: cache,
    scriptPath,
    python: { executable: process.execPath, prefixArgs: [] },
  });
  const first = matcher("first");
  const firstRef = await first.analyzeFinish(finish);
  const firstIndex = await first.indexStart(source);
  const second = matcher("second");
  const secondRef = await second.analyzeFinish(finish);
  const secondIndex = await second.indexStart(source);
  assert.equal((await readFile(counter, "utf8")).trim().split("\n").length, 2);
  assert.deepEqual(firstRef.evidenceRefs, secondRef.evidenceRefs);
  assert.deepEqual(firstIndex.evidenceRefs, secondIndex.evidenceRefs);
  await first.matchAudio({ reference: firstRef, sourceIndex: firstIndex, minimumConfidence: 0.95 });
  await second.matchAudio({ reference: secondRef, sourceIndex: secondIndex, minimumConfidence: 0.95 });
  assert.equal((await readFile(counter, "utf8")).trim().split("\n").length, 3);

  await writeFile(finishPath, "changed-reference-bytes");
  const third = matcher("third");
  const thirdRef = await third.analyzeFinish(finish);
  const thirdIndex = await third.indexStart(source);
  assert.equal((await readFile(counter, "utf8")).trim().split("\n").length, 4);
  await third.matchAudio({ reference: thirdRef, sourceIndex: thirdIndex, minimumConfidence: 0.95 });
  assert.equal((await readFile(counter, "utf8")).trim().split("\n").length, 5);

  await writeFile(sourcePath, "changed-source-bytes");
  await matcher("fourth").indexStart(source);
  assert.equal((await readFile(counter, "utf8")).trim().split("\n").length, 6);
});
