import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { EditGptTrackerVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-tracker-visual-driver.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupPath = path.join(root, "proofs", "artifacts", "m4-tracker-repair-resume-backward-fixture.json");
const setup = JSON.parse(await readFile(setupPath, "utf8"));
if (!setup.ok) throw new Error(`backward repair/resume fixture setup failed: ${JSON.stringify(setup)}`);
const userProfile = process.env.USERPROFILE;
const executablePath = process.env.EDITGPT_PYTHON || (userProfile ? path.join(userProfile, "editgpt", ".venv", "Scripts", "python.exe") : null);
if (!executablePath) throw new Error("EDITGPT_PYTHON or USERPROFILE is required for the local EditGPT proof runtime.");
const driver = new EditGptTrackerVisualDriverV1({
  executablePath,
  scriptPath: path.join(root, "packages", "adapters", "ae-cep", "runtime", "editgpt_tracker_visual_driver.py"),
  workingDirectory: root,
  evidenceDirectory: path.join(root, "proofs", "artifacts", "m4-tracker-repair-resume-backward-visual"),
  timeoutMs: 120000,
  analysisWindowSeconds: 1.5,
});
const result = await driver.analyze({
  direction: "BACKWARD",
  trackerIndex: 1,
  pointIndex: 1,
  requiredPointIndices: [1],
  compHostId: setup.fixtureCompId,
  layerHostId: setup.layerId,
  expectedCompName: setup.compName,
  expectedLayerName: setup.layerName,
  expectedTrackerName: setup.trackerName,
  expectedControl: "TRACKER_ANALYZE_BACKWARD",
});
const artifactsDir = path.join(root, "proofs", "artifacts");
await mkdir(artifactsDir, { recursive: true });
await writeFile(path.join(artifactsDir, "m4-tracker-repair-resume-backward-driver-live.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result));
process.exitCode = result.status === "COMPLETED" ? 0 : 2;
