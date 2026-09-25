import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { EditTypeRegistryFileV1 } from "../../../packages/practice-homework/src/index.js";
import {
  refreshPracticeHeldOutBenchmarkV1,
} from "./practice-held-out-certification.js";
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
    "Usage: practice-retained-truth-suite-cli --manifest <manifest.json> [--out <report.json>] [--edit-type-registry <edit-types.json> --repository-root <repo>]",
  );
}

const report = await evaluatePracticeRetainedTruthSuiteManifestV1(manifestPath);
const registryPath = argument("--edit-type-registry");
const repositoryRoot = argument("--repository-root");
if (registryPath !== null) {
  const registryFile = new EditTypeRegistryFileV1(registryPath);
  const registry = await registryFile.load();
  if (registry.get(report.editTypeId) === null) {
    throw new TypeError("Retained truth suite targets an unknown Edit Type: " + report.editTypeId);
  }
  registry.recordRetainedTruthSuite(report);
  const retained = registry.knowledge(report.editTypeId);
  if (report.certified
    && repositoryRoot !== null
    && (retained?.gptLearning.heldOutCases.length ?? 0) > 0) {
    refreshPracticeHeldOutBenchmarkV1({
      registry,
      editTypeId: report.editTypeId,
      repositoryRoot,
    });
  }
  await registryFile.save(registry);
}
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
