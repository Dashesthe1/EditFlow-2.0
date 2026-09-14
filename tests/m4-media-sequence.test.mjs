import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_MEDIA_SEQUENCE_PROTOCOL_VERSION_V25,
  AE_MEDIA_SEQUENCE_COMMANDS_V25,
  capabilityForMediaSequenceCommandV25,
  isAeMediaSequenceMutationCommandV25,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_5.js";

test("protocol 2.5 is media-sequence-specific and mutation classification is exact", () => {
  assert.equal(AE_MEDIA_SEQUENCE_PROTOCOL_VERSION_V25, "2.5.0");
  assert.deepEqual(AE_MEDIA_SEQUENCE_COMMANDS_V25, [
    "media.sequence.import",
    "media.sequence.readback",
  ]);
  assert.equal(capabilityForMediaSequenceCommandV25("media.sequence.import"), "ae.media.sequence.import");
  assert.equal(capabilityForMediaSequenceCommandV25("media.sequence.readback"), "ae.media.sequence.readback");
  assert.equal(isAeMediaSequenceMutationCommandV25("media.sequence.import"), true);
  assert.equal(isAeMediaSequenceMutationCommandV25("media.sequence.readback"), false);
});

test("protocol 2.5 host performs native sequence import, exact readback, revision gating, and rollback", async () => {
  const source = await readFile("packages/adapters/ae-cep/host/editflow_host_m4_media_sequence.jsx", "utf8");
  assert.match(source, /options\.sequence=true/);
  assert.match(source, /options\.forceAlphabetical=false/);
  assert.match(source, /mainSource\.conformFrameRate=Number\(payload\.frameRate\)/);
  assert.match(source, /expectedHostProjectRevision/);
  assert.match(source, /expectedFrameCount/);
  assert.match(source, /MEDIA_SEQUENCE_READBACK_MISMATCH/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.match(source, /MEDIA_SEQUENCE_ROLLBACK_READBACK_MISMATCH/);
  assert.match(source, /EDITFLOW_M4_MEDIA_SEQUENCE_P4_PROOF/);
  assert.doesNotMatch(source, /SetCursorPos|mouse_event|SendKeys|system\.callSystem/);
});

test("protocol 2.5 loader is additive over accepted protocol 2.4", async () => {
  const loader = await readFile("packages/adapters/ae-cep/host/editflow_host_current_v25.jsx", "utf8");
  assert.match(loader, /editflow_host_current_v24\.jsx/);
  assert.match(loader, /editflow_host_m4_media_sequence\.jsx/);
  assert.match(loader, /M4_MEDIA_SEQUENCE_MODULE_LOAD_FAILED/);
  assert.match(loader, /EditFlow2_HOST_PROTOCOL_25 = true/);
});

test("media-sequence live proof stays warm-process-safe and popup-supervisor compatible", async () => {
  const runner = await readFile("scripts/windows/run-m4-media-sequence-v25-live.ps1", "utf8");
  const proof = await readFile("scripts/windows/m4-media-sequence-v25-live-proof.jsx", "utf8");
  assert.match(runner, /Start-Process -FilePath \$AfterFxPath -ArgumentList \$Arguments/);
  assert.match(proof, /editflow_host_current_v25\.jsx/);
  assert.match(proof, /M4_MEDIA_SEQUENCE_P4_FAILURE_INJECTION/);
  assert.match(proof, /HOST_REVISION_CONFLICT/);
  assert.match(proof, /itemCountRestored/);
  assert.doesNotMatch(runner, /Stop-Process.*AfterFX|taskkill/i);
  assert.doesNotMatch(proof, /app\.quit\s*\(|app\.project\.close\s*\(/);
});
