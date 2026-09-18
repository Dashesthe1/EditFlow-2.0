import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";

const supportPath = "packages/adapters/ae-cep/host/editflow_host_m4_tracking_render_support.jsx";
const wrapperPath = "packages/adapters/ae-cep/host/editflow_host_m4_tracking_render.jsx";

const createHarness = async () => {
  const [support, wrapper] = await Promise.all([readFile(supportPath, "utf8"), readFile(wrapperPath, "utf8")]);
  const files = new Map();
  const folders = new Set(["/proof"]);
  const normalize = (value) => String(value).replaceAll("\\", "/");

  class FakeFolder {
    constructor(value) { this.fsName = normalize(value); }
    get exists() { return folders.has(this.fsName); }
    getFiles(pattern) {
      const star = pattern.indexOf("*");
      const prefix = star >= 0 ? pattern.slice(0, star) : pattern;
      const suffix = star >= 0 ? pattern.slice(star + 1) : "";
      return [...files.keys()].filter((candidate) => {
        const parent = path.posix.dirname(candidate);
        const name = path.posix.basename(candidate);
        return parent === this.fsName && name.startsWith(prefix) && name.endsWith(suffix);
      }).map((candidate) => new FakeFile(candidate));
    }
  }

  class FakeFile {
    constructor(value) {
      this.fsName = normalize(value);
      this.name = path.posix.basename(this.fsName);
      this.parent = new FakeFolder(path.posix.dirname(this.fsName));
      this.encoding = "UTF-8";
      this._open = false;
    }
    get exists() { return files.has(this.fsName); }
    get length() { return files.get(this.fsName)?.length ?? 0; }
    open(mode) { this._open = mode === "w"; return this._open; }
    write(value) { if (!this._open) return false; files.set(this.fsName, String(value)); return true; }
    close() { this._open = false; }
    remove() { return files.delete(this.fsName); }
  }

  let moduleFile = new FakeFile("/proof/original.avi");
  let appliedTemplate = null;
  const module = {
    applyTemplate(value) { appliedTemplate = value; },
    get file() { return moduleFile; },
    set file(value) { moduleFile = value; },
    getSettings() { return { Format: "TIFF Sequence", Channels: "RGB + Alpha" }; },
  };
  const rqItem = {
    comp: { frameRate: 10 },
    timeSpanDuration: 0.4,
    status: "QUEUED",
    resolutionFactor: [1, 1],
    outputModule() { return module; },
    remove() { this.removed = true; },
    removed: false,
  };

  const globals = {};
  const project = { renderQueue: { rendering: false }, revision: 1 };
  globals.EditFlow2_JSON = JSON;
  globals.EditFlow2_dispatch = (requestJson) => {
    const request = JSON.parse(requestJson);
    const completionPath = `${request.payload.outputPath}.editflow-render.json`;
    globals.EditFlow2_activeRenderJob = {
      jobId: request.requestId,
      requestId: request.requestId,
      outputPath: request.payload.outputPath,
      completionPath,
      rqItem,
      state: "SCHEDULED",
      mode: "ASYNC_HOST_RENDER_V4",
      queueItemRemoved: false,
      driveTaskId: 123,
      terminalOk: null,
      terminalError: null,
      driverError: null,
    };
    return JSON.stringify({
      protocolVersion: "1.1.0", requestId: request.requestId, transactionId: request.transactionId,
      operationId: request.operationId, capabilityId: request.capabilityId, command: "render.capture",
      outcome: "APPLIED", error: null, affectedObjects: [],
      readback: { jobId: request.requestId, completionPath, outputPath: request.payload.outputPath },
      projectSnapshot: null, environmentProbe: null, hostProjectRevision: 1,
      diagnostics: { adapterProtocolVersion: "1.1.0", adapterBuild: "accepted", command: "render.capture", notes: [] },
      proofArtifactRefs: [completionPath],
    });
  };
  globals.EditFlow2_reconcileAsyncRender = () => {
    const job = globals.EditFlow2_activeRenderJob;
    if (!job) return "IDLE";
    if (job.driverError) {
      job.terminalOk = false; job.terminalError = job.driverError; job.state = "FAILED";
    } else {
      const output = new FakeFile(job.outputPath);
      job.terminalOk = output.exists && output.length > 0;
      job.terminalError = job.terminalOk ? null : "missing output";
      job.state = job.terminalOk ? "DONE" : "FAILED";
    }
    job.queueItemRemoved = true;
    globals.EditFlow2_lastRenderJob = job;
    globals.EditFlow2_activeRenderJob = null;
    return job.state;
  };

  const context = vm.createContext({
    $: { global: globals, os: "Windows" },
    app: { project },
    File: FakeFile,
    Folder: FakeFolder,
    GetSettingsFormat: { STRING: "STRING" },
    RQItemStatus: { DONE: "DONE" },
    JSON,
  });
  new vm.Script(support, { filename: supportPath }).runInContext(context);
  new vm.Script(wrapper, { filename: wrapperPath }).runInContext(context);
  return { globals, files, rqItem, module, get appliedTemplate() { return appliedTemplate; } };
};

const request = () => JSON.stringify({
  protocolVersion: "1.1.0",
  requestId: "M4_VM_JOB",
  transactionId: "TX",
  operationId: "OP",
  capabilityId: "ae.render.capture",
  command: "render.capture",
  payload: {
    comp: { hostId: 1 },
    outputPath: "/proof/m4.tif",
    outputProfile: "TRACKING_TIFF_SEQUENCE_V1",
    timeSpanStart: 0,
    timeSpanDuration: 0.4,
  },
});

test("M4 runtime profile validates a real sequence before accepted single-file reconciliation", async () => {
  const harness = await createHarness();
  const response = JSON.parse(harness.globals.EditFlow2_dispatch(request()));
  assert.equal(response.outcome, "APPLIED");
  assert.equal(response.readback.outputProfile, "TRACKING_TIFF_SEQUENCE_V1");
  assert.equal(response.readback.expectedFrameCount, 4);
  assert.deepEqual(response.readback.trackingResolutionFactor, [2, 2]);
  assert.equal(harness.appliedTemplate, "TIFF Sequence with Alpha");

  for (let index = 0; index < 4; index += 1) harness.files.set(`/proof/m4_${String(index).padStart(5, "0")}.tif`, `frame-${index}`);
  harness.rqItem.status = "DONE";
  harness.globals.EditFlow2_activeRenderJob.state = "AWAITING_FINALIZE";
  const state = harness.globals.EditFlow2_reconcileAsyncRender();
  assert.equal(state, "DONE");
  const job = harness.globals.EditFlow2_lastRenderJob;
  assert.equal(job.outputPath, "/proof/m4_00000.tif");
  assert.deepEqual(Array.from(job.trackingFramePaths), [
    "/proof/m4_00000.tif", "/proof/m4_00001.tif", "/proof/m4_00002.tif", "/proof/m4_00003.tif",
  ]);
  const manifest = JSON.parse(harness.files.get("/proof/m4.tif.editflow-render.json.frames.json"));
  assert.equal(manifest.ok, true);
  assert.equal(manifest.expectedFrameCount, 4);
  assert.deepEqual(Array.from(manifest.framePaths), Array.from(job.trackingFramePaths));
});

test("M4 runtime profile fails closed before accepted reconciliation when sequence count is incomplete", async () => {
  const harness = await createHarness();
  const response = JSON.parse(harness.globals.EditFlow2_dispatch(request()));
  assert.equal(response.outcome, "APPLIED");
  for (let index = 0; index < 3; index += 1) harness.files.set(`/proof/m4_${String(index).padStart(5, "0")}.tif`, `frame-${index}`);
  harness.rqItem.status = "DONE";
  harness.globals.EditFlow2_activeRenderJob.state = "AWAITING_FINALIZE";
  const state = harness.globals.EditFlow2_reconcileAsyncRender();
  assert.equal(state, "FAILED");
  const job = harness.globals.EditFlow2_lastRenderJob;
  assert.match(job.terminalError, /Expected 4 TIFF frames but found 3/);
  const manifest = JSON.parse(harness.files.get("/proof/m4.tif.editflow-render.json.frames.json"));
  assert.equal(manifest.ok, false);
  assert.equal(manifest.framePaths.length, 0);
});
