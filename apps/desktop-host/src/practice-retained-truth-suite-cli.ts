import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluatePracticeRetainedTruthSuiteManifestV1,
} from "./practice-retained-truth-suite.js";

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value === undefined ? null : value;
};

const manifestPath = argument("--manifest");
if (manifestPath === null) {
  throw new TypeError(
    "Usage: practice-retained-truth-suite-cli --manifest <manifest.json> [--out <report.json>]",
  );
}

const report = await evaluatePracticeRetainedTruthSuiteManifestV1(manifestPath);
const outputPath = argument("--out");
if (outputPath !== null) {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(report, null, 2) + "\n", "utf8");
}

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (report.mode === "CERTIFICATION" && !report.certified) {
  process.exitCode = 2;
}
