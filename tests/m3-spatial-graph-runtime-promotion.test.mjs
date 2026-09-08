import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installerPath = "scripts/windows/install-editflow-cep.ps1";
const previewInstallerPath = "scripts/windows/install-editflow-cep-v19-preview.ps1";
const configTemplatePath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const hostLoaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v19.jsx";

test("standard CEP installer promotes the accepted spatial Graph Editor host to protocol 1.9", async () => {
  const source = await readFile(installerPath, "utf8");

  for (const file of [
    "editflow_host_m3_spatial_graph.jsx",
    "editflow_host_m3_spatial_graph_proof_cleanup.jsx",
    "editflow_host_current_v19.jsx",
  ]) {
    assert.match(source, new RegExp(file.replaceAll(".", "\\.")));
  }

  assert.match(source, /\$KnownV18 = 'var KNOWN_PROTOCOLS = \["1\.8\.0"/);
  assert.match(source, /\$KnownV19 = 'var KNOWN_PROTOCOLS = \["1\.9\.0","1\.8\.0"/);
  assert.match(source, /BridgeText\.Replace\(\$KnownV18, \$KnownV19\)/);
  assert.match(source, /Replace\('editflow_host_current_v18\.jsx', 'editflow_host_current_v19\.jsx'\)/);
  assert.match(source, /Replace\('EditFlow2_HOST_PROTOCOL_18', 'EditFlow2_HOST_PROTOCOL_19'\)/);
  assert.match(source, /supportedProtocolVersions = @\("1\.9\.0", "1\.8\.0"/);
  assert.match(source, /Panel protocols advertised: 1\.9\.0, 1\.8\.0/);
  assert.match(source, /refusing unverified protocol 1\.9 promotion/);
});

test("checked-in runtime config advertises 1.9 first while retaining the 1.1 safe fallback signal", async () => {
  const source = await readFile(configTemplatePath, "utf8");
  assert.match(source, /protocolVersion: "1\.1\.0"/);
  assert.match(source, /supportedProtocolVersions: \["1\.9\.0","1\.8\.0"/);
  assert.match(source, /acceptedV17Compatibility/);
  assert.match(source, /hostLoader: "editflow_host_current_v17\.jsx"/);
});

test("former preview installer now verifies the ordinary accepted v1.9 installation instead of patching it", async () => {
  const source = await readFile(previewInstallerPath, "utf8");
  assert.match(source, /& \$AcceptedInstaller/);
  assert.match(source, /editflow_host_current_v19\.jsx/);
  assert.match(source, /editflow_host_m3_spatial_graph\.jsx/);
  assert.match(source, /Accepted bridge\.js does not advertise protocol 1\.9 first/);
  assert.match(source, /compatibility verifier only/);
  assert.doesNotMatch(source, /\.Replace\(\$KnownV18, \$KnownV19\)/);
});

test("v1.9 host remains additive and fails closed to the accepted v1.8 dispatcher when its spatial module cannot load", async () => {
  const source = await readFile(hostLoaderPath, "utf8");
  assert.match(source, /editflow_host_current_v18\.jsx/);
  assert.match(source, /editflow_host_m3_spatial_graph\.jsx/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_19/);
  assert.match(source, /protocolVersion:\s*"1\.9\.0"/);
  assert.match(source, /spatial_graph_module_load_failed/);
  assert.match(source, /EditFlow2_v18_dispatch/);
});
