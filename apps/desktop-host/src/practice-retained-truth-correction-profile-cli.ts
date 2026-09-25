import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  compilePracticeSceneMatcherCorrectionProfileV1,
  type PracticeRetainedTruthSuiteReportV1,
} from "../../../packages/practice-homework/src/index.js";

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value === undefined ? null : value;
};

const requiredArgument = (name: string): string => {
  const value = argument(name);
  if (value === null || value.trim().length === 0) {
    throw new TypeError("Missing required argument: " + name);
  }
  return value;
};

const baselinePath = requiredArgument("--baseline");
const subsystem = argument("--subsystem") ?? "SOURCE_IDENTITY_RETRIEVAL";
const outputPath = requiredArgument("--out");
const parsed = JSON.parse(
  (await readFile(path.resolve(baselinePath), "utf8")).replace(/^\uFEFF/, ""),
) as Partial<PracticeRetainedTruthSuiteReportV1>;
if (parsed.schema !== "editflow.practice-retained-truth-suite-report.v1"
  || typeof parsed.editTypeId !== "string"
  || !Array.isArray(parsed.tuningPlan)) {
  throw new TypeError(
    "Matcher correction profile requires a retained-truth suite report with a tuning plan.",
  );
}

const baseline = parsed as PracticeRetainedTruthSuiteReportV1;
const directive = baseline.tuningPlan?.find((item) => item.subsystem === subsystem);
if (directive === undefined) {
  throw new TypeError(
    "Baseline retained-truth report has no correction directive for subsystem: "
      + subsystem,
  );
}

const profile = compilePracticeSceneMatcherCorrectionProfileV1({
  editTypeId: baseline.editTypeId,
  directive,
});
const resolved = path.resolve(outputPath);
await mkdir(path.dirname(resolved), { recursive: true });
await writeFile(resolved, JSON.stringify(profile, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(profile, null, 2) + "\n");
