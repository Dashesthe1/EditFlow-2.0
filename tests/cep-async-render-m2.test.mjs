import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const asyncHostPath = "packages/adapters/ae-cep/host/editflow_host_render_async.jsx";
const outputPathHostPath = "packages/adapters/ae-cep/host/editflow_host_render_output_path.jsx";
const currentHostPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const acceptancePath = "apps/desktop-host/src/cep-write-acceptance-cli.ts";

test("async render override feature-detects renderAsync and never falls back to blocking render", async () => {
  const source = await readFile(asyncHostPath, "utf8");

  assert.match(source, /typeof app\.project\.renderQueue\.renderAsync !== "function"/);
  assert.match(source, /ASYNC_RENDER_UNAVAILABLE/);
  assert.match(source, /app\.project\.renderQueue\.renderAsync\(\)/);
  assert.doesNotMatch(source, /app\.project\.renderQueue\.render\(\)/);
  assert.match(source, /renderMethod: "RenderQueue\.renderAsync\.scheduled"/);
});

test("CEP render.capture dispatch schedules a fixed driver and never starts rendering inline", async () => {
  const source = await readFile(asyncHostPath, "utf8");
  const dispatchStart = source.indexOf("$.global.EditFlow2_dispatch = function (requestJson) {");
  assert.ok(dispatchStart >= 0);
  const dispatch = source.slice(dispatchStart);

  assert.match(dispatch, /writeImmediateMarker\(job, "SCHEDULED", false, null\)/);
  assert.match(dispatch, /app\.scheduleTask\("\$\.global\.EditFlow2_driveAsyncRender\(\)", 25, false\)/);
  assert.doesNotMatch(dispatch, /app\.project\.renderQueue\.renderAsync\(\)/);
  assert.match(dispatch, /state: "SCHEDULED"/);
  assert.match(dispatch, /mode: "SCHEDULED_HOST_JOB_V1"/);
  assert.match(dispatch, /ASYNC_HOST_RENDER_V3/);
});

test("scheduled global driver marks RUNNING before crossing renderAsync boundary", async () => {
  const source = await readFile(asyncHostPath, "utf8");
  const start = source.indexOf("$.global.EditFlow2_driveAsyncRender = function () {");
  const end = source.indexOf("$.global.EditFlow2_dispatch = function", start);
  assert.ok(start >= 0 && end > start);
  const driver = source.slice(start, end);

  const runningMarker = driver.indexOf('taskWriteMarker("RUNNING", false, null)');
  const renderAsync = driver.indexOf("app.project.renderQueue.renderAsync()");
  assert.ok(runningMarker >= 0 && renderAsync > runningMarker,
    "RUNNING evidence must be durable before renderAsync can hold the scripting engine");
  assert.match(driver, /job\.renderAsyncReturnedAtMs = taskNowMs\(\)/);
  assert.match(driver, /taskScheduleDrive\(250\)/);
  assert.match(driver, /app\.project\.renderQueue\.rendering === true/);
  assert.match(driver, /RQItemStatus\.DONE/);
  assert.match(driver, /taskFinish\(true, null\)/);
  assert.match(driver, /taskFinish\(false,/);
  assert.match(driver, /job\.rqItem\.remove\(\)/);
});

test("scheduled async driver is self-contained for AE global workspace", async () => {
  const source = await readFile(asyncHostPath, "utf8");
  const start = source.indexOf("$.global.EditFlow2_driveAsyncRender = function () {");
  const end = source.indexOf("$.global.EditFlow2_dispatch = function", start);
  assert.ok(start >= 0 && end > start);
  const driver = source.slice(start, end);

  assert.match(driver, /function taskNowMs\(\)/);
  assert.match(driver, /function taskString\(value\)/);
  assert.match(driver, /function taskQuote\(value\)/);
  assert.match(driver, /function taskWriteMarker\(status, ok, errorMessage\)/);
  assert.match(driver, /function taskCleanupQueueItem\(\)/);
  assert.match(driver, /function taskFinish\(ok, errorMessage\)/);
  assert.match(driver, /function taskScheduleDrive\(delayMs\)/);
  assert.doesNotMatch(driver, /EditFlow2_JSON/);
  assert.doesNotMatch(driver, /\bnowMs\(\)/);
  assert.doesNotMatch(driver, /\basString\(/);
  assert.doesNotMatch(driver, /\bwriteImmediateMarker\(/);
});

test("render output-path wrapper makes OutputModule.file authoritative without allowing directory escape", async () => {
  const source = await readFile(outputPathHostPath, "utf8");

  assert.match(source, /job\.rqItem\.outputModule\(1\)/);
  assert.match(source, /actualFile = module \? module\.file : null/);
  assert.match(source, /actualFile\.fsName/);
  assert.match(source, /requestedFile\.parent/);
  assert.match(source, /actualFile\.parent/);
  assert.match(source, /RENDER_OUTPUT_DIRECTORY_CHANGED/);
  assert.match(source, /job\.requestedOutputPath = requestedFile\.fsName/);
  assert.match(source, /job\.outputPath = actualPath/);
  assert.match(source, /response\.readback\.requestedOutputPath = job\.requestedOutputPath/);
  assert.match(source, /response\.readback\.outputPath = job\.outputPath/);
  assert.match(source, /outputPathCanonicalized/);
  assert.match(source, /writeScheduledMarker\(job\)/);
  assert.match(source, /staleActual\.remove\(\)/);
  assert.match(source, /app\.cancelTask\(job\.driveTaskId\)/);
  assert.doesNotMatch(source, /eval\s*\(/);
});

test("current host loads output-path canonicalization after async renderer and installer copies both layers", async () => {
  const [currentHost, installer] = await Promise.all([
    readFile(currentHostPath, "utf8"),
    readFile(installerPath, "utf8"),
  ]);

  assert.match(currentHost, /editflow_host_render_async\.jsx/);
  assert.match(currentHost, /editflow_host_render_output_path\.jsx/);
  const renderJobsIndex = currentHost.indexOf("$.evalFile(renderJobs)");
  const renderAsyncIndex = currentHost.indexOf("$.evalFile(renderAsync)");
  const renderPathIndex = currentHost.indexOf("$.evalFile(renderOutputPath)");
  assert.ok(renderJobsIndex >= 0 && renderAsyncIndex > renderJobsIndex,
    "async render override must supersede the earlier blocking render.capture wrapper");
  assert.ok(renderPathIndex > renderAsyncIndex,
    "OutputModule.file canonicalization must wrap the already-prepared async render job");
  assert.match(installer, /"editflow_host_render_async\.jsx"/);
  assert.match(installer, /"editflow_host_render_output_path\.jsx"/);
});

test("M2 acceptance verifies AE canonical output path inside artifact directory and records the real artifact", async () => {
  const source = await readFile(acceptancePath, "utf8");

  assert.match(source, /const renderOutputPath = renderReadback\?\.\["outputPath"\]/);
  assert.match(source, /renderReadback\?\.\["requestedOutputPath"\] === renderPath/);
  assert.match(source, /path\.relative\(artifactDir, renderOutputPath\)/);
  assert.match(source, /render_output_path_readback/);
  assert.match(source, /renderCompletion\.outputPath === renderOutputPath/);
  assert.match(source, /fileExistsNonEmpty\(renderOutputPath\)/);
  assert.match(source, /renderArtifactPath = renderOutputPath/);
  assert.match(source, /renderArtifact: checks\.render_capture === true \? renderArtifactPath : null/);
});
