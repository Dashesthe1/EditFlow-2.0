import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installerPath = "scripts/windows/install-editflow-cep.ps1";
const previewInstallerPath = "scripts/windows/install-editflow-cep-v19-preview.ps1";
const configTemplatePath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const hostLoaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v19.jsx";

test("standard protocol 1.10 installer preserves the transfer-accepted spatial Graph Editor tranche", async () => {
  const source = await readFile(installerPath, "utf8");
  for (const file of ["editflow_host_m3_spatial_graph.jsx", "editflow_host_m3_spatial_graph_proof_cleanup.jsx", "editflow_host_current_v19.jsx", "editflow_host_m3_motion_render.jsx", "editflow_host_current_v110.jsx"]) assert.match(source, new RegExp(file.replaceAll(".", "\\.")));
  assert.match(source, /\$KnownV18 = 'var KNOWN_PROTOCOLS = \["1\.8\.0"/);
  assert.match(source, /\$KnownV110 = 'var KNOWN_PROTOCOLS = \["1\.10\.0","1\.9\.0"/);
  assert.match(source, /Replace\(\$KnownV18, \$KnownV110\)/);
  assert.match(source, /Replace\('editflow_host_current_v18\.jsx', 'editflow_host_current_v110\.jsx'\)/);
  assert.match(source, /acceptedV19Compatibility/);
  assert.match(source, /hostLoader = "editflow_host_current_v19\.jsx"/);
  assert.match(source, /Panel protocols advertised: 1\.10\.0, 1\.9\.0/);
  assert.match(source, /refusing unverified protocol 1\.10 promotion/);
});

test("checked-in runtime config advertises 1.10 first while preserving explicit accepted 1.9 compatibility", async () => {
  const source = await readFile(configTemplatePath, "utf8");
  assert.match(source, /supportedProtocolVersions: \["1\.10\.0","1\.9\.0"/);
  assert.match(source, /acceptedV19Compatibility/);
  assert.match(source, /hostLoader: "editflow_host_current_v19\.jsx"/);
  assert.match(source, /hostFlag: "EditFlow2_HOST_PROTOCOL_19"/);
});

test("former v1.9 preview installer verifies compatibility beneath accepted v1.10 instead of patching", async () => {
  const source = await readFile(previewInstallerPath, "utf8");
  assert.match(source, /& \$AcceptedInstaller -Port \$Port/);
  assert.match(source, /editflow_host_current_v19\.jsx/);
  assert.match(source, /acceptedV19Compatibility/);
  assert.match(source, /protocol 1\.9 remains an accepted compatibility tranche/i);
  assert.doesNotMatch(source, /\.Replace\(/);
});

test("v1.9 host remains additive and fails closed to the accepted v1.8 dispatcher", async () => {
  const source = await readFile(hostLoaderPath, "utf8");
  assert.match(source, /editflow_host_current_v18\.jsx/);
  assert.match(source, /editflow_host_m3_spatial_graph\.jsx/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_19/);
  assert.match(source, /protocolVersion:\s*"1\.9\.0"/);
  assert.match(source, /M3_SPATIAL_GRAPH_MODULE_LOAD_FAILED/);
  assert.match(source, /return dispatchBeforeFailure\(requestJson\)/);
  assert.match(source, /accepted protocol 1\.1-1\.8 dispatch remains available/);
});
