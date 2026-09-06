import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const asyncHostPath = "packages/adapters/ae-cep/host/editflow_host_render_async.jsx";
const currentHostPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";

test("async render override feature-detects renderAsync and never falls back to blocking render", async () => {
  const source = await readFile(asyncHostPath, "utf8");

  assert.match(source, /typeof app\.project\.renderQueue\.renderAsync !== "function"/);
  assert.match(source, /ASYNC_RENDER_UNAVAILABLE/);
  assert.match(source, /app\.project\.renderQueue\.renderAsync\(\)/);
  assert.doesNotMatch(source, /app\.project\.renderQueue\.render\(\)/);
  assert.match(source, /renderMethod: "RenderQueue\.renderAsync"/);
});

test("async render uses fixed global polling and terminal lifecycle proof", async () => {
  const source = await readFile(asyncHostPath, "utf8");

  assert.match(source, /\$\.global\.EditFlow2_pollAsyncRender = function/);
  assert.match(source, /app\.scheduleTask\("\$\.global\.EditFlow2_pollAsyncRender\(\)", 250, false\)/);
  assert.match(source, /app\.project\.renderQueue\.rendering === true/);
  assert.match(source, /RQItemStatus\.DONE/);
  assert.match(source, /taskFinish\(true, null\)/);
  assert.match(source, /taskFinish\(false,/);
  assert.match(source, /job\.rqItem\.remove\(\)/);
  assert.match(source, /queueItemRemoved/);
});

test("scheduled async poller is self-contained for AE global workspace", async () => {
  const source = await readFile(asyncHostPath, "utf8");
  const start = source.indexOf("$.global.EditFlow2_pollAsyncRender = function () {");
  const end = source.indexOf("$.global.EditFlow2_dispatch = function", start);
  assert.ok(start >= 0 && end > start);
  const poller = source.slice(start, end);

  assert.match(poller, /function taskNowMs\(\)/);
  assert.match(poller, /function taskString\(value\)/);
  assert.match(poller, /function taskQuote\(value\)/);
  assert.match(poller, /function taskWriteMarker\(status, ok, errorMessage\)/);
  assert.match(poller, /function taskCleanupQueueItem\(\)/);
  assert.match(poller, /function taskFinish\(ok, errorMessage\)/);
  assert.doesNotMatch(poller, /EditFlow2_JSON/);
  assert.doesNotMatch(poller, /\bnowMs\(\)/);
  assert.doesNotMatch(poller, /\basString\(/);
});

test("current host loads async override after legacy render-job layer and installer copies it", async () => {
  const [currentHost, installer] = await Promise.all([
    readFile(currentHostPath, "utf8"),
    readFile(installerPath, "utf8"),
  ]);

  assert.match(currentHost, /editflow_host_render_async\.jsx/);
  const renderJobsIndex = currentHost.indexOf("$.evalFile(renderJobs)");
  const renderAsyncIndex = currentHost.indexOf("$.evalFile(renderAsync)");
  assert.ok(renderJobsIndex >= 0 && renderAsyncIndex > renderJobsIndex,
    "async render override must supersede the earlier blocking render.capture wrapper");
  assert.match(installer, /"editflow_host_render_async\.jsx"/);
});
