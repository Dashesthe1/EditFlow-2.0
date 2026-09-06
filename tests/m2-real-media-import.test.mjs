import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/cep-media-import-acceptance-cli.ts";
const runnerPath = "scripts/windows/run-m2-media-import-acceptance.ps1";
const selfHostedPath = "scripts/windows/run-m2-ae-self-hosted.ps1";

test("real-AE media proof creates a bounded WAV and imports it through the typed v1.1 adapter", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /createSilentWav/);
  assert.match(source, /m2-media-import-proof\.wav/);
  assert.match(source, /new AeFilesystemPolicyV11\(\[artifactDir\]\)/);
  assert.match(source, /executePublic\("media\.import"/);
  assert.match(source, /stableId: mediaStableId/);
  assert.match(source, /kind === "FOOTAGE"/);
  assert.match(source, /media_import_structural_readback/);
});

test("real-AE media proof removes the imported item using only fixed transaction Undo", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /client\.undoLast/);
  assert.match(source, /transaction\.undo_last failed/);
  assert.match(source, /media_import_undo_removed/);
  assert.match(source, /media_import_undo_restored_count/);
  assert.match(source, /final_media_absent/);
  assert.match(source, /final_item_count_restored/);
  assert.match(source, /cleanupUsesFixedUndoCommand: true/);
  assert.doesNotMatch(source, /media\.remove/);
});

test("media import Windows runner requires the already-running bounded AE host and compiled fixed CLI", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /Resolve-RunningAfterFx/);
  assert.match(source, /bridge-config\.json/);
  assert.match(source, /npm run build:test-runtime/);
  assert.match(source, /cep-media-import-acceptance-cli\.js/);
  assert.match(source, /media-import-result\.json/);
  assert.match(source, /cleanupComplete/);
  assert.match(source, /M2 media import proof status/);
});

test("self-hosted M2 acceptance executes media import proof before its owned AE cleanup", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  const mainAcceptance = source.indexOf("& $Acceptance");
  const mediaAcceptance = source.indexOf("& $MediaImportAcceptance");
  const cleanup = source.indexOf('Get-Process -Name "AfterFX"', mediaAcceptance);
  assert.ok(mainAcceptance >= 0 && mediaAcceptance > mainAcceptance && cleanup > mediaAcceptance);
  assert.match(source, /run-m2-media-import-acceptance\.ps1/);
  assert.match(source, /same authenticated host session/);
});
