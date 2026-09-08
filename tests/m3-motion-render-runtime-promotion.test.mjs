import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installerPath = "scripts/windows/install-editflow-cep.ps1";
const previewInstallerPath = "scripts/windows/install-editflow-cep-v110-preview.ps1";
const configTemplatePath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const hostLoaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v110.jsx";

test("standard CEP installer promotes transfer-accepted protocol 1.10 motion-render and fails closed on source drift", async () => {
  const source = await readFile(installerPath, "utf8");
  assert.match(source, /editflow_host_m3_motion_render\.jsx/);
  assert.match(source, /editflow_host_current_v110\.jsx/);
  assert.match(source, /\$KnownV110 = 'var KNOWN_PROTOCOLS = \["1\.10\.0","1\.9\.0"/);
  assert.match(source, /Replace\('editflow_host_current_v18\.jsx', 'editflow_host_current_v110\.jsx'\)/);
  assert.match(source, /Replace\('EditFlow2_HOST_PROTOCOL_18', 'EditFlow2_HOST_PROTOCOL_110'\)/);
  assert.match(source, /supportedProtocolVersions = @\("1\.10\.0", "1\.9\.0"/);
  assert.match(source, /acceptedV19Compatibility/);
  assert.match(source, /Protocol 1\.10 motion-render is P1-P5 transfer-accepted/);
  assert.match(source, /refusing unverified protocol 1\.10 promotion/);
});

test("checked-in runtime config and ordinary installer keep protocol 1.9 as explicit fallback compatibility", async () => {
  const source = await readFile(configTemplatePath, "utf8");
  assert.match(source, /supportedProtocolVersions: \["1\.10\.0","1\.9\.0"/);
  assert.match(source, /acceptedV19Compatibility/);
  assert.match(source, /supportedProtocolVersions: \["1\.9\.0","1\.8\.0"/);
  assert.match(source, /hostLoader: "editflow_host_current_v19\.jsx"/);
  assert.match(source, /hostFlag: "EditFlow2_HOST_PROTOCOL_19"/);
});

test("former v1.10 preview installer is a verifier only after production promotion", async () => {
  const source = await readFile(previewInstallerPath, "utf8");
  assert.match(source, /& \$AcceptedInstaller -Port \$Port/);
  assert.match(source, /var KNOWN_PROTOCOLS = \["1\.10\.0","1\.9\.0"/);
  assert.match(source, /editflow_host_current_v110\.jsx/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_110/);
  assert.match(source, /acceptedV19Compatibility/);
  assert.doesNotMatch(source, /\.Replace\(/);
  assert.doesNotMatch(source, /Copy-Item/);
});

test("v1.10 host loader remains additive and fail-closed to accepted v1.9", async () => {
  const source = await readFile(hostLoaderPath, "utf8");
  assert.match(source, /editflow_host_current_v19\.jsx/);
  assert.match(source, /editflow_host_m3_motion_render\.jsx/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_110/);
  assert.match(source, /M3_MOTION_RENDER_MODULE_LOAD_FAILED/);
  assert.match(source, /return dispatchBeforeFailure\(requestJson\)/);
  assert.match(source, /accepted protocol 1\.1-1\.9 dispatch remains available/);
});
