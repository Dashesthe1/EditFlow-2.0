import { mkdir, readFile, writeFile } from "node:fs/promises";
import { EditGptTrackerVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-tracker-visual-driver.js";

const root = "C:\\Users\\Shadow\\EditFlow-2.0";
const setup = JSON.parse(await readFile(`${root}\\proofs\\artifacts\\m4-tracker-repair-resume-fixture.json`, "utf8"));
if (!setup.ok) throw new Error(`repair/resume fixture setup failed: ${JSON.stringify(setup)}`);
const driver = new EditGptTrackerVisualDriverV1({
  executablePath: "C:\\Users\\Shadow\\editgpt\\.venv\\Scripts\\python.exe",
  scriptPath: `${root}\\packages\\adapters\\ae-cep\\runtime\\editgpt_tracker_visual_driver.py`,
  workingDirectory: root,
  evidenceDirectory: `${root}\\proofs\\artifacts\\m4-tracker-repair-resume-visual`,
  timeoutMs: 120000,
  analysisWindowSeconds: 1.5,
});
const result = await driver.analyze({
  direction: "FORWARD",
  trackerIndex: 1,
  pointIndex: 1,
  requiredPointIndices: [1],
  compHostId: setup.fixtureCompId,
  layerHostId: setup.layerId,
  expectedCompName: setup.compName,
  expectedLayerName: setup.layerName,
  expectedTrackerName: setup.trackerName,
  expectedControl: "TRACKER_ANALYZE_FORWARD",
});
await mkdir(`${root}\\proofs\\artifacts`, { recursive: true });
await writeFile(`${root}\\proofs\\artifacts\\m4-tracker-repair-resume-driver-live.json`, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result));
process.exitCode = result.status === "COMPLETED" ? 0 : 2;
