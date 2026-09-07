import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scripts = [
  "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls_p12_fixture.jsx",
  "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls_p12_cleanup.jsx",
];

for (const scriptPath of scripts) {
  test(`${scriptPath} resolves proof artifacts from the repository root`, async () => {
    const source = await readFile(scriptPath, "utf8");

    assert.match(source, /currentFile\.parent\.parent\.parent\.parent\.parent/);
    assert.doesNotMatch(source, /currentFile\.parent\.parent\.parent\.parent;/);
    assert.match(source, /repoRoot\.fsName \+ "\/proofs\/artifacts\/m3-layer-controls-p1-p2"/);
  });
}
