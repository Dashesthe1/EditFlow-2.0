import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const previewInstallerPath = "scripts/windows/install-editflow-cep-v110-preview.ps1";

test("former protocol 1.10 preview installer now verifies the accepted standard installation without patching", async () => {
  const source = await readFile(previewInstallerPath, "utf8");
  assert.match(source, /try\s*\{\s*& \$AcceptedInstaller -Port \$Port\s*\}\s*catch\s*\{/s);
  assert.match(source, /Accepted EditFlow CEP installer failed before protocol 1\.10 compatibility verification:/);
  assert.match(source, /editflow_host_m3_motion_render\.jsx/);
  assert.match(source, /editflow_host_current_v110\.jsx/);
  assert.match(source, /Accepted bridge\.js does not advertise protocol 1\.10 first/);
  assert.match(source, /compatibility verifier only/);
  assert.doesNotMatch(source, /\$LASTEXITCODE/);
  assert.doesNotMatch(source, /\.Replace\(/);
  assert.doesNotMatch(source, /Copy-Item/);
});
