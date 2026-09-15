import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helperPath = new URL("../scripts/proofs/m4-sam31-checkpoint-materialize.py", import.meta.url);
const contractPath = new URL("../docs/M4_SAM31_LOCAL_PROVIDER_CONTRACT.md", import.meta.url);

test("SAM 3.1 checkpoint materializer is explicit, gated, and digest-bound", async () => {
  const py = await readFile(helperPath, "utf8");
  assert.match(py, /REPO_ID = "facebook\/sam3\.1"/);
  assert.match(py, /CHECKPOINT_FILENAME = "sam3\.1_multiplex\.pt"/);
  assert.match(py, /CHECKPOINT_ACCESS_REQUIRED/);
  assert.match(py, /hf_hub_download/);
  assert.match(py, /local_dir=str\(destination\)/);
  assert.match(py, /checkpointSha256/);
  assert.match(py, /sha256_file\(checkpoint_path\)/);
  assert.doesNotMatch(py, /print\([^\n]*token/);
});

test("live proof contract keeps authorization external and local checkpoint explicit", async () => {
  const doc = await readFile(contractPath, "utf8");
  assert.match(doc, /already-authorized explicit local SAM 3\.1 checkpoint/);
  assert.match(doc, /does not download or authorize a checkpoint on the operator's behalf/);
});
