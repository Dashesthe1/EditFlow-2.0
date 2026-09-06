import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const proofPath = "proofs/ae/m2-disposable-p4-p5-proof.jsx";

test("P5 saved-project check is a strict boolean before final proof gating", async () => {
  const source = await readFile(proofPath, "utf8");
  assert.match(source, /checks\.saved_disposable_project = projectFile\.exists && !!\(save\.readback && save\.readback\.filePath\);/);
  assert.match(source, /checks\.saved_disposable_project === true/);
  assert.doesNotMatch(source, /checks\.saved_disposable_project = projectFile\.exists && save\.readback && save\.readback\.filePath;/);
});
