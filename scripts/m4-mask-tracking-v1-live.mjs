import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { EditGptMaskVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-mask-visual-driver.js";

const root = process.cwd();
const fixture = JSON.parse(await readFile(path.join(root, "proofs/artifacts/m4-mask-tracking-v1-fixture.json"), "utf8"));
if (!fixture.ok || fixture.pathKeyCount !== 0) throw new Error(`mask fixture is not at zero-key baseline: ${JSON.stringify(fixture)}`);
const userProfile = process.env.USERPROFILE;
if (!userProfile) throw new Error("USERPROFILE is unavailable for the local EditGPT proof runtime.");
const driver = new EditGptMaskVisualDriverV1({
  executablePath: path.join(userProfile, "editgpt", ".venv", "Scripts", "python.exe"),
  scriptPath: path.join(root, "packages", "adapters", "ae-cep", "runtime", "editgpt_mask_tracking_visual_driver.py"),
  workingDirectory: root,
  evidenceDirectory: path.join(root, "proofs", "artifacts", "m4-mask-tracking-visual-runtime"),
  timeoutMs: 120000,
  analysisWindowSeconds: 3,
});
const result = await driver.analyze({
  direction: "FORWARD",
  compHostId: fixture.compHostId,
  layerHostId: fixture.layerHostId,
  maskStableId: fixture.maskStableId,
  expectedCompName: "EF2_M4_MASK_TRACK_FIXTURE",
  expectedLayerName: "EF2_M4_MASK_TRACK_TARGET",
  expectedMaskName: fixture.maskName,
  expectedControl: "MASK_ANALYZE_FORWARD",
});
await mkdir(path.join(root, "proofs", "artifacts"), { recursive: true });
await writeFile(
  path.join(root, "proofs", "artifacts", "m4-mask-tracking-v1-driver-result.json"),
  JSON.stringify(result, null, 2),
  "utf8",
);
console.log(JSON.stringify(result));
process.exitCode = result.status === "COMPLETED" ? 0 : 2;
