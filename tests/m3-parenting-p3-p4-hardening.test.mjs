import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_parenting.jsx";
const cleanupPath = "packages/adapters/ae-cep/host/editflow_host_m3_parenting_proof_cleanup.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const cliPath = "apps/desktop-host/src/m3-parenting-p3-p4-cli.ts";

test("parenting direct route fails closed when five-point preserve geometry is unrepresentable", async () => {
  const source = await readFile(hostPath, "utf8");
  assert.match(source, /GEOMETRY_TOLERANCE\s*=\s*0\.05/);
  assert.match(source, /geometryEquivalent\(beforeGeometry, readback\.parenting\.compSpaceGeometry, GEOMETRY_TOLERANCE\)/);
  assert.match(source, /PARENT_PRESERVE_GEOMETRY_UNVERIFIABLE/);
  assert.match(source, /PARENT_PRESERVE_VISUAL_UNREPRESENTABLE/);
  assert.match(source, /HOST_LIMITATION/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.match(source, /Failed parenting mutation self-rolled back with AE Undo\./);
  const executableLines = source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//")
        && !trimmed.startsWith("/*")
        && !trimmed.startsWith("*")
        && !trimmed.startsWith("*/");
    })
    .join("\n");
  assert.doesNotMatch(executableLines, /setParentWithJump\s*\(/);
});

test("parenting P3/P4 visual harness exercises a representable rotated uniform-scale parent", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /scale:\s*\[135,\s*135\]/);
  assert.match(source, /representable direct-parent envelope/);
  assert.match(source, /rotated non-uniform parent scale can require shear/);
  assert.match(source, /protocol 1\.4 now fails closed and self-rolls back/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("parenting proof cleanup can discard only the exact restored disposable fixture", async () => {
  const source = await readFile(cleanupPath, "utf8");
  assert.match(source, /EDITFLOW_M3_PARENTING_P4_PROOF/);
  assert.match(source, /p4-post-rollback\.avi/);
  assert.match(source, /app\.project\.numItems !== 2/);
  assert.match(source, /_TARGET_COMP/);
  assert.match(source, /_SOURCE_MEDIA/);
  assert.match(source, /M3_PARENTING_P34_/);
  assert.match(source, /_PARENT_LAYER/);
  assert.match(source, /_CHILD_LAYER/);
  assert.match(source, /childLayer\.parent !== null/);
  assert.match(source, /CloseOptions\.DO_NOT_SAVE_CHANGES/);
  assert.match(source, /app\.newProject\(\)/);
  assert.match(source, /M3_PARENTING_P3_P4_REAL_AE/);
});

test("current host loader and CEP installer wire the parenting cleanup mode without weakening proof isolation", async () => {
  const [loader, installer] = await Promise.all([
    readFile(loaderPath, "utf8"),
    readFile(installerPath, "utf8"),
  ]);
  assert.match(installer, /editflow_host_m3_parenting_proof_cleanup\.jsx/);
  assert.match(loader, /editflow_host_m3_parenting_proof_cleanup\.jsx/);
  assert.match(loader, /EDITFLOW_M3_PARENTING_P4_PROOF/);
  assert.match(loader, /proofModeCount/);
  assert.match(loader, /proofModeCount > 1/);
  assert.match(loader, /m3ParentingProofMode/);
  assert.match(loader, /M3_PROOF_CLEANUP_MODULE_LOAD_FAILED/);
});
