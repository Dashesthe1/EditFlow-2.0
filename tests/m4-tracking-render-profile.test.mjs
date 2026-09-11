import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const supportPath = "packages/adapters/ae-cep/host/editflow_host_m4_tracking_render_support.jsx";
const wrapperPath = "packages/adapters/ae-cep/host/editflow_host_m4_tracking_render.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_m4.jsx";
const acceptedLoaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v20.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";

test("M4 tracking render profile is fixed and fail-closed", async () => {
  const [support, wrapper] = await Promise.all([readFile(supportPath, "utf8"), readFile(wrapperPath, "utf8")]);
  assert.match(support, /PROFILE = "TRACKING_TIFF_SEQUENCE_V1"/);
  assert.match(support, /TEMPLATE = "TIFF Sequence with Alpha"/);
  assert.match(wrapper, /MAX_FRAMES = 120/);
  assert.match(wrapper, /RESOLUTION_FACTOR = 2/);
  assert.match(wrapper, /payload\.outputProfile === undefined/);
  assert.match(wrapper, /M4_RENDER_PROFILE_UNSUPPORTED/);
  assert.match(wrapper, /request\.protocolVersion !== "1\.1\.0"/);
  assert.doesNotMatch(wrapper, /payload\.template/);
  assert.doesNotMatch(wrapper, /payload\.outputModuleTemplate/);
  assert.doesNotThrow(() => new vm.Script(support, { filename: supportPath }));
  assert.doesNotThrow(() => new vm.Script(wrapper, { filename: wrapperPath }));
});

test("M4 TIFF sequence evidence is exact, bounded, and reconciles through the accepted renderer", async () => {
  const wrapper = await readFile(wrapperPath, "utf8");
  assert.match(wrapper, /job\.rqItem\.resolutionFactor = \[RESOLUTION_FACTOR, RESOLUTION_FACTOR\]/);
  assert.match(wrapper, /module\.applyTemplate\(S\.TEMPLATE\)/);
  assert.match(wrapper, /name\.replace\("\[#####\]", "\*"\)/);
  assert.match(wrapper, /Math\.abs\(exact - expected\) > 0\.01/);
  assert.match(wrapper, /found\.length !== job\.trackingExpectedFrameCount/);
  assert.match(wrapper, /found\[i\]\.length <= 0/);
  assert.match(wrapper, /job\.outputPath = paths\[0\]/);
  assert.match(wrapper, /trackingSequenceManifestPath/);
  assert.match(wrapper, /var state = innerReconcile\(\)/);
  assert.doesNotMatch(wrapper, /renderQueue\.render\(/);
  assert.doesNotMatch(wrapper, /renderQueue\.renderAsync\(/);
});

test("M4 loader remains additive over immutable accepted v20", async () => {
  const [loader, accepted] = await Promise.all([readFile(loaderPath, "utf8"), readFile(acceptedLoaderPath, "utf8")]);
  assert.match(loader, /editflow_host_current_v20\.jsx/);
  assert.match(loader, /editflow_host_m4_tracking_render_support\.jsx/);
  assert.match(loader, /editflow_host_m4_tracking_render\.jsx/);
  assert.match(loader, /EditFlow2_HOST_PROTOCOL_20/);
  assert.match(loader, /EditFlow2_HOST_M4 = true/);
  assert.doesNotMatch(accepted, /editflow_host_m4_tracking_render/);
  assert.doesNotThrow(() => new vm.Script(loader, { filename: loaderPath }));
});

test("standard installer deploys M4 above accepted protocol 2.0 without advertising a new protocol", async () => {
  const source = await readFile(installerPath, "utf8");
  assert.match(source, /"editflow_host_m4_tracking_render_support\.jsx"/);
  assert.match(source, /"editflow_host_m4_tracking_render\.jsx"/);
  assert.match(source, /"editflow_host_current_m4\.jsx"/);
  assert.match(source, /Replace\('editflow_host_current_v18\.jsx', 'editflow_host_current_v20\.jsx'\)/);
  assert.match(source, /Replace\('editflow_host_current_v20\.jsx', 'editflow_host_current_m4\.jsx'\)/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_20/);
  assert.match(source, /supportedProtocolVersions = @\("2\.0\.0", "1\.9\.0", "1\.8\.0"/);
});
