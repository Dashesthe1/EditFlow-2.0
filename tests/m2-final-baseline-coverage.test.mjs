import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/cep-baseline-coverage-cli.ts";
const runnerPath = "scripts/windows/run-m2-final-baseline-coverage.ps1";
const selfHostedPath = "scripts/windows/run-m2-ae-self-hosted.ps1";

test("final baseline proof covers missing positive structural M2 routes", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /execute\("comp\.update_settings"/);
  assert.match(source, /transform_anchor_point/);
  assert.match(source, /anchorPoint: \[150, 155\]/);
  assert.match(source, /execute\("layer\.remove"/);
  assert.match(source, /layer_remove_structural/);
  assert.match(source, /execute\("effect\.remove"/);
  assert.match(source, /effect_remove/);
  assert.match(source, /execute\("comp\.remove"/);
  assert.match(source, /comp_remove_structural/);
});

test("final baseline proof exercises keyframe create, update-at-existing-time, and typed delete", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /keyframe_create/);
  assert.match(source, /keyframe_update_existing_time/);
  assert.match(source, /keyframes: \[\{ time: 0\.5, value: \[184, 168\] \}\]/);
  assert.match(source, /removeKeyIndices: \[2\]/);
  assert.match(source, /mode.*REMOVE_KEY_INDICES/);
  assert.match(source, /removedKeyTimes/);
  assert.match(source, /P2_keyframe_crud/);
});

test("final baseline proof imports real generated media and restores it with fixed Undo", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /createSilentWav/);
  assert.match(source, /m2-baseline-media-proof\.wav/);
  assert.match(source, /new AeFilesystemPolicyV11\(\[artifactDir\]\)/);
  assert.match(source, /execute\("media\.import"/);
  assert.match(source, /media_import_structural/);
  assert.match(source, /client\.undoLast/);
  assert.match(source, /media_import_undo_removed/);
  assert.match(source, /media_import_undo_restored_count/);
  assert.match(source, /mediaCleanupUsesFixedUndo: true/);
});

test("final baseline proof requires bounded cleanup and baseline item-count restoration", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /cleanupComp\(targetStable\)/);
  assert.match(source, /cleanupComp\(sourceStable\)/);
  assert.match(source, /final_media_absent/);
  assert.match(source, /final_item_count_restored/);
  assert.match(source, /cleanupComplete/);
});

test("Windows runner compiles and executes only the fixed final baseline CLI against the existing bounded host", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /Resolve-RunningAfterFx/);
  assert.match(source, /bridge-config\.json/);
  assert.match(source, /npm run build:test-runtime/);
  assert.match(source, /cep-baseline-coverage-cli\.js/);
  assert.match(source, /final-baseline-result\.json/);
  assert.match(source, /cleanupComplete/);
});

test("self-hosted M2 workflow runs final coverage after bounded acceptance and before owned AE cleanup", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  const mainAcceptance = source.indexOf("& $Acceptance");
  const finalCoverage = source.indexOf("& $FinalBaselineAcceptance");
  const cleanup = source.indexOf('Get-Process -Name "AfterFX"', finalCoverage);
  assert.ok(mainAcceptance >= 0 && finalCoverage > mainAcceptance && cleanup > finalCoverage);
  assert.match(source, /run-m2-final-baseline-coverage\.ps1/);
  assert.match(source, /same authenticated AE session/);
});
