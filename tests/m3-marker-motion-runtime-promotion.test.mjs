import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installerPath = "scripts/windows/install-editflow-cep.ps1";
const verifierPath = "scripts/windows/install-editflow-cep-v20-preview.ps1";
const configPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v20.jsx";
const registryPath = "apps/desktop-host/src/ae-runtime-capabilities.ts";

test("standard CEP installer promotes protocol 2.0 as the single accepted marker-motion runtime", async () => {
  const source = await readFile(installerPath, "utf8");
  for (const token of [
    '"editflow_host_m3_marker_motion.jsx"',
    '"editflow_host_current_v20.jsx"',
    '$ExtensionVersion = "0.1.0-dev.10"',
    '$KnownV20 = \'var KNOWN_PROTOCOLS = ["2.0.0","1.9.0","1.8.0"',
    "editflow_host_current_v20.jsx",
    "EditFlow2_HOST_PROTOCOL_20",
    "acceptedV19Compatibility",
    'supportedProtocolVersions = @("2.0.0", "1.9.0", "1.8.0"',
    "Panel protocols advertised: 2.0.0, 1.9.0, 1.8.0",
  ]) assert.ok(source.includes(token), `standard installer missing ${token}`);
  assert.match(source, /refusing unverified protocol 2\.0 promotion/);
});

test("checked-in runtime config and desktop registry agree that 2.0 is accepted above 1.9", async () => {
  const [config, registry] = await Promise.all([
    readFile(configPath, "utf8"),
    readFile(registryPath, "utf8"),
  ]);
  assert.match(config, /supportedProtocolVersions: \["2\.0\.0","1\.9\.0","1\.8\.0"/);
  assert.match(config, /extensionVersion: "0\.1\.0-dev\.10"/);
  assert.match(config, /acceptedV19Compatibility/);
  assert.match(registry, /ae-cep\.m3\.marker-motion/);
  assert.match(registry, /adapterVersion: "2\.0\.0"/);
  assert.match(registry, /priority: 120/);
  assert.match(registry, /"2\.0\.0"/);
});

test("former v20 preview entry point delegates to and verifies the standard accepted installer", async () => {
  const source = await readFile(verifierPath, "utf8");
  assert.match(source, /& \$AcceptedInstaller -Port \$Port -SkipDebugMode/);
  assert.match(source, /Accepted CEP bridge does not advertise protocol 2\.0 first/);
  assert.match(source, /editflow_host_current_v20\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion\.jsx/);
  assert.match(source, /0\.1\.0-dev\.10/);
  assert.match(source, /no longer installs a separate preview runtime/);
  assert.doesNotMatch(source, /BridgeText\.Replace/);
});

test("v20 host loader stays additive over accepted v19 and fails closed only for protocol 2.0", async () => {
  const source = await readFile(loaderPath, "utf8");
  assert.match(source, /editflow_host_current_v19\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion\.jsx/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_20/);
  assert.match(source, /request\.protocolVersion === "2\.0\.0"/);
  assert.match(source, /M3_MARKER_MOTION_MODULE_LOAD_FAILED/);
  assert.match(source, /dispatchBeforeFailure/);
});
