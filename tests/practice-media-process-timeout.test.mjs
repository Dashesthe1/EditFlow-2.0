import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LocalPracticeMediaMatcherV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

const processAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("Practice media timeout terminates the analyzer process tree", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "editflow-practice-timeout-"));
  const runnerPath = path.join(directory, "runner.mjs");
  const scriptPath = path.join(directory, "practice-media-match.py");
  const mediaPath = path.join(directory, "finish.mp4");
  const childPidPath = path.join(directory, "child.pid");
  await writeFile(scriptPath, "# fake analyzer\n", "utf8");
  await writeFile(mediaPath, "fake video bytes", "utf8");
  await writeFile(runnerPath, [
    'import { spawn } from "node:child_process";',
    'import { writeFile } from "node:fs/promises";',
    'import path from "node:path";',
    'const scriptPath = process.argv[2];',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    'await writeFile(path.join(path.dirname(scriptPath), "child.pid"), String(child.pid), "utf8");',
    'setInterval(() => {}, 1000);',
  ].join("\n"), "utf8");

  let childPid = null;
  try {
    const matcher = new LocalPracticeMediaMatcherV1({
      artifactDir: path.join(directory, "artifacts"),
      scriptPath,
      python: { executable: process.execPath, prefixArgs: [runnerPath] },
      analysisTimeoutMs: 500,
    });
    await assert.rejects(
      matcher.analyzeFinish({
        mediaId: "finish:timeout",
        mediaKind: "VIDEO",
        uri: mediaPath,
      }),
      /process tree was terminated/,
    );

    childPid = Number(await readFile(childPidPath, "utf8"));
    for (let attempt = 0; attempt < 40 && processAlive(childPid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(processAlive(childPid), false);
  } finally {
    if (childPid !== null && processAlive(childPid)) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});
