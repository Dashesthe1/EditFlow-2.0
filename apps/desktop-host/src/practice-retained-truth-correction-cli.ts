import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluatePracticeRetainedTruthCorrectionReplayV1,
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

const readReport = async (
  filePath: string,
): Promise<PracticeRetainedTruthSuiteReportV1> => {
  const parsed = JSON.parse(
    (await readFile(path.resolve(filePath), "utf8")).replace(/^\uFEFF/, ""),
  ) as Partial<PracticeRetainedTruthSuiteReportV1>;
  if (parsed.schema !== "editflow.practice-retained-truth-suite-report.v1"
    || typeof parsed.editTypeId !== "string"
    || !Array.isArray(parsed.cases)
    || !Array.isArray(parsed.tuningPlan)) {
    throw new TypeError(
      "Correction replay requires a retained-truth suite report with a tuning plan.",
    );
  }
  return parsed as PracticeRetainedTruthSuiteReportV1;
};

const baselinePath = requiredArgument("--baseline");
const candidatePath = requiredArgument("--candidate");
const subsystem = requiredArgument("--subsystem");
const baseline = await readReport(baselinePath);
const candidate = await readReport(candidatePath);
const directive = baseline.tuningPlan?.find((item) =>
  item.subsystem === subsystem);

if (directive === undefined) {
  throw new TypeError(
    "Baseline retained-truth report has no correction directive for subsystem: "
      + subsystem,
  );
}

const report = evaluatePracticeRetainedTruthCorrectionReplayV1({
  baseline,
  candidate,
  directive,
});
const outputPath = argument("--out");
if (outputPath !== null) {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(report, null, 2) + "\n", "utf8");
}

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!report.accepted) {
  process.exitCode = 2;
}
