import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { EditTypeRegistryFileV1 } from "../../../packages/practice-homework/src/index.js";
import { recertifyPracticeRobustManifestV1 } from "./practice-robust-recertification.js";
import { resolvePracticeStatePathsV1 } from "./practice-state-paths.js";

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value === undefined ? null : value;
};

const manifestPath = argument("--manifest");
const repositoryRoot = argument("--repository-root");
if (manifestPath === null || repositoryRoot === null) {
  throw new TypeError(
    "Usage: practice-robust-recertification-cli "
      + "--manifest <retained-corpus.json> "
      + "--repository-root <repo> "
      + "[--state-dir <practice-state-dir>] "
      + "[--edit-type-registry <edit-types.json>] "
      + "[--out <report.json>]",
  );
}
const statePaths = resolvePracticeStatePathsV1(argument("--state-dir"));
const registryPath = argument("--edit-type-registry") ?? statePaths.editTypeRegistryFilePath;
const registryFile = new EditTypeRegistryFileV1(registryPath);
const registry = await registryFile.load();
const report = await recertifyPracticeRobustManifestV1({
  registry,
  manifestPath,
  repositoryRoot,
});
await registryFile.save(registry);

const outputPath = argument("--out");
if (outputPath !== null) {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(report, null, 2) + "\n", "utf8");
}

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!report.robustClaimAllowed || report.maturityStage !== "ROBUST") {
  process.exitCode = 2;
}
