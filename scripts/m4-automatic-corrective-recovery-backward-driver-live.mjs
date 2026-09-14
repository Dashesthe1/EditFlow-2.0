import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { EditGptTrackerVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-tracker-visual-driver.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(await readFile(path.join(root, "proofs", "artifacts", "m4-automatic-corrective-recovery-fixture.json"), "utf8"));
const applied = JSON.parse(await readFile(path.join(root, "proofs", "artifacts", "m4-automatic-corrective-recovery-apply.json"), "utf8"));
const planned = JSON.parse(await readFile(path.join(root, "proofs", "artifacts", "m4-automatic-corrective-recovery-plan.json"), "utf8"));
if (!fixture.ok || fixture.proofDirection !== "BACKWARD" || !applied.ok || planned?.plan?.analysis?.direction !== "BACKWARD") {
  throw new Error(`automatic-corrective backward preconditions failed: ${JSON.stringify({ fixture, applied, planned })}`);
}
const userProfile = process.env.USERPROFILE;
const executablePath = process.env.EDITGPT_PYTHON || (userProfile ? path.join(userProfile, "editgpt", ".venv", "Scripts", "python.exe") : null);
if (!executablePath) throw new Error("EDITGPT_PYTHON or USERPROFILE is required for the local EditGPT proof runtime.");
const driver = new EditGptTrackerVisualDriverV1({
  executablePath,
  scriptPath: path.join(root, "packages", "adapters", "ae-cep", "runtime", "editgpt_tracker_visual_driver.py"),
  workingDirectory: root,
  evidenceDirectory: path.join(root, "proofs", "artifacts", "m4-automatic-corrective-recovery-backward-visual"),
  timeoutMs: 120000,
  analysisWindowSeconds: 1.5,
});
const result = await driver.analyze({
  direction: "BACKWARD",
  trackerIndex: 1,
  pointIndex: fixture.pointIndex,
  requiredPointIndices: [fixture.pointIndex],
  compHostId: fixture.fixtureCompId,
  layerHostId: fixture.layerId,
  expectedCompName: fixture.compName,
  expectedLayerName: fixture.layerName,
  expectedTrackerName: fixture.trackerName,
  expectedControl: "TRACKER_ANALYZE_BACKWARD",
});
await mkdir(path.join(root, "proofs", "artifacts"), { recursive: true });
await writeFile(path.join(root, "proofs", "artifacts", "m4-automatic-corrective-recovery-backward-driver-live.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ status: result.status, guardedVisualTargetVerified: result.guardedVisualTargetVerified, visualEvidenceId: result.visualEvidenceId ?? null, completion: result.proof?.completion ?? null }));
process.exitCode = result.status === "COMPLETED" && result.guardedVisualTargetVerified === true ? 0 : 2;
