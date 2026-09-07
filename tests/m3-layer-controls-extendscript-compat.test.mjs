import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls.jsx";

test("protocol 1.6 switch validation avoids Array.prototype methods unavailable in AE ExtendScript", async () => {
  const source = await readFile(hostPath, "utf8");

  assert.match(source, /function isKnownSwitchKey\(key\)/);
  assert.match(source, /for \(i = 0; i < SWITCH_KEYS\.length; i \+= 1\)/);
  assert.match(source, /SWITCH_KEYS\[i\] === key/);
  assert.match(source, /if \(!isKnownSwitchKey\(key\)\) reject\("LAYER_SWITCH_UNKNOWN"/);
  assert.doesNotMatch(source, /SWITCH_KEYS\.indexOf\s*\(/,
    "After Effects 25.6.6 ExtendScript does not provide Array.prototype.indexOf for this host array");
  assert.doesNotMatch(source, /SWITCH_KEYS\.(?:includes|forEach|map|filter|some|every|find)\s*\(/,
    "protocol 1.6 switch validation must remain ES3-compatible inside ExtendScript");
});
