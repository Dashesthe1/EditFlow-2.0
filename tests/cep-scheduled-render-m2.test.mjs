import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderHostPath = "packages/adapters/ae-cep/host/editflow_host_render_jobs.jsx";
const currentHostPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const acceptancePath = "apps/desktop-host/src/cep-write-acceptance-cli.ts";

test("render.capture returns from CEP before blocking AE render and schedules only a fixed global task", async () => {
  const source = await readFile(renderHostPath, "utf8");

  assert.match(source, /request\.command !== "render\.capture"/);
  assert.match(source, /\$\.global\.EditFlow2_runScheduledRender = function/);
  assert.match(source, /app\.project\.renderQueue\.render\(\)/);
  assert.match(source, /app\.scheduleTask\("EditFlow2_runScheduledRender\(\)", 25, false\)/);
  assert.match(source, /state: "SCHEDULED"/);
  assert.match(source, /mode: "SCHEDULED_HOST_JOB_V2_GLOBAL"/);
  assert.match(source, /completionPath: job\.completionPath/);
  assert.match(source, /payload\.outputPath \+ "\.editflow-render\.json"/);
  assert.doesNotMatch(source, /app\.scheduleTask\([^\n]*payload/);
});

test("scheduled entrypoint is self-contained for AE global-workspace execution", async () => {
  const source = await readFile(renderHostPath, "utf8");
  const start = source.indexOf("$.global.EditFlow2_runScheduledRender = function () {");
  const end = source.indexOf("$.global.EditFlow2_dispatch = function", start);
  assert.ok(start >= 0 && end > start);
  const scheduled = source.slice(start, end);

  assert.match(scheduled, /function taskNowMs\(\)/);
  assert.match(scheduled, /function taskString\(value\)/);
  assert.match(scheduled, /function taskWriteMarker\(status, ok, errorMessage\)/);
  assert.match(scheduled, /function taskCleanupQueueItem\(\)/);
  assert.doesNotMatch(scheduled, /\bnowMs\(\)/);
  assert.doesNotMatch(scheduled, /\basString\(/);
  assert.doesNotMatch(scheduled, /\bwriteImmediateMarker\(/);
});

test("scheduled render writes deterministic lifecycle evidence before, during, and after render", async () => {
  const source = await readFile(renderHostPath, "utf8");

  assert.match(source, /writeImmediateMarker\(job, "SCHEDULED", false, null\)/);
  assert.match(source, /taskWriteMarker\("RUNNING", false, null\)/);
  assert.match(source, /taskWriteMarker\(job\.state, ok, errorMessage\)/);
  assert.match(source, /completedAtMs:/);
  assert.match(source, /queueItemRemoved: job\.queueItemRemoved === true/);
});

test("bounded scheduled render isolates existing Render Queue, removes stale output, and reports cleanup", async () => {
  const source = await readFile(renderHostPath, "utf8");

  assert.match(source, /app\.project\.renderQueue\.numItems !== 0/);
  assert.match(source, /RENDER_QUEUE_NOT_EMPTY/);
  assert.match(source, /priorOutput\.exists/);
  assert.match(source, /priorOutput\.remove\(\)/);
  assert.match(source, /job\.rqItem\.remove\(\)/);
  assert.match(source, /queueItemRemoved: job\.queueItemRemoved === true/);
  assert.match(source, /RQItemStatus\.DONE/);
  assert.match(source, /output\.exists/);
});

test("current host and Windows installer require the scheduled render layer", async () => {
  const [currentHost, installer] = await Promise.all([
    readFile(currentHostPath, "utf8"),
    readFile(installerPath, "utf8"),
  ]);

  assert.match(currentHost, /editflow_host_render_jobs\.jsx/);
  const atomicityIndex = currentHost.indexOf("$.evalFile(atomicity)");
  const renderIndex = currentHost.indexOf("$.evalFile(renderJobs)");
  assert.ok(atomicityIndex >= 0 && renderIndex > atomicityIndex, "render job wrapper must sit after protocol/atomicity wrappers");
  assert.match(installer, /"editflow_host_render_jobs\.jsx"/);
});

test("M2 acceptance waits on filesystem completion marker instead of issuing host reads during render", async () => {
  const source = await readFile(acceptancePath, "utf8");

  assert.match(source, /waitForRenderCompletion/);
  assert.match(source, /RENDER_JOB_COMPLETION_TIMEOUT/);
  assert.match(source, /execute\("render\.capture"[\s\S]*\{ refreshAfter: false \}\)/);
  assert.match(source, /checks\.render_scheduled/);
  assert.match(source, /checks\.render_job_done/);
  assert.match(source, /renderCompletion\.queueItemRemoved === true/);

  const renderStart = source.indexOf('const renderSchedule = await execute("render.capture"');
  const markerWait = source.indexOf("await waitForRenderCompletion", renderStart);
  const refreshAfter = source.indexOf("await refreshState();", markerWait);
  assert.ok(renderStart >= 0 && markerWait > renderStart && refreshAfter > markerWait,
    "host state refresh must occur only after the scheduled render completion marker");
});
