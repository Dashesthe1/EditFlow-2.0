import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderHostPath = "packages/adapters/ae-cep/host/editflow_host_render_jobs.jsx";
const currentHostPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const acceptancePath = "apps/desktop-host/src/cep-write-acceptance-cli.ts";

test("render.capture returns from CEP before the blocking AE render and uses only a fixed scheduled task", async () => {
  const source = await readFile(renderHostPath, "utf8");

  assert.match(source, /request\.command !== "render\.capture"/);
  assert.match(source, /\$\.global\.EditFlow2_runScheduledRender = function/);
  assert.match(source, /app\.project\.renderQueue\.render\(\)/);
  assert.match(source, /app\.scheduleTask\("\$\.global\.EditFlow2_runScheduledRender\(\)", 25, false\)/);
  assert.match(source, /state: "SCHEDULED"/);
  assert.match(source, /mode: "SCHEDULED_HOST_JOB_V1"/);
  assert.match(source, /completionPath: job\.completionPath/);
  assert.match(source, /payload\.outputPath \+ "\.editflow-render\.json"/);
  assert.doesNotMatch(source, /app\.scheduleTask\([^\n]*payload/);
});

test("bounded scheduled render isolates the existing Render Queue and reports cleanup in its completion marker", async () => {
  const source = await readFile(renderHostPath, "utf8");

  assert.match(source, /app\.project\.renderQueue\.numItems !== 0/);
  assert.match(source, /RENDER_QUEUE_NOT_EMPTY/);
  assert.match(source, /rqItem\.remove\(\)/);
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

test("M2 acceptance waits on the filesystem completion marker instead of issuing host reads during render", async () => {
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
