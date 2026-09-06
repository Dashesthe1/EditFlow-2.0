/* EditFlow 2.0 render output-path canonicalization for protocol 1.1.
 *
 * After Effects owns the concrete file extension selected by the active Output
 * Module. A caller may request `capture.avi` while an H.264 output module renders
 * `capture.mp4`. The async render layer must therefore verify and use the
 * OutputModule.file readback rather than assuming the requested extension survives.
 *
 * This wrapper runs synchronously after the async render.capture wrapper has
 * prepared the queue item but before its scheduled driver can execute. It permits
 * AE to canonicalize the filename/extension inside the already-authorized output
 * directory, but fails closed if the Output Module redirects to another directory.
 */
(function () {
  "use strict";

  var BUILD = "0.1.0-dev.4-renderpath1";
  var innerDispatch = $.global.EditFlow2_dispatch;

  if (typeof innerDispatch !== "function") {
    throw new Error("EditFlow render-path wrapper requires the async render dispatcher.");
  }
  if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.parse !== "function"
      || typeof $.global.EditFlow2_JSON.stringify !== "function") {
    throw new Error("EditFlow render-path wrapper requires the clean-room JSON runtime.");
  }

  function asString(value) { return value === null || value === undefined ? "" : String(value); }

  function normalizedPath(value) {
    var text = asString(value);
    return $.os.indexOf("Windows") >= 0 ? text.toLowerCase() : text;
  }

  function samePath(left, right) {
    return normalizedPath(left) === normalizedPath(right);
  }

  function cancelJob(job) {
    if (!job) return;
    if (typeof job.driveTaskId === "number") {
      try { app.cancelTask(job.driveTaskId); } catch (_) {}
    }
    if (job.rqItem) {
      try { job.rqItem.remove(); job.queueItemRemoved = true; } catch (_) { job.queueItemRemoved = false; }
    }
    $.global.EditFlow2_activeRenderJob = null;
  }

  function writeScheduledMarker(job) {
    var marker = new File(job.completionPath);
    marker.encoding = "UTF-8";
    if (!marker.open("w")) throw new Error("Unable to rewrite render lifecycle marker: " + marker.fsName);
    try {
      marker.write($.global.EditFlow2_JSON.stringify({
        schemaVersion: 1,
        jobId: job.jobId,
        status: "SCHEDULED",
        ok: false,
        outputPath: job.outputPath,
        error: null,
        completedAtMs: (new Date()).getTime(),
        queueItemRemoved: false
      }));
    } finally {
      marker.close();
    }
  }

  function failResponse(response, job, code, message, details) {
    cancelJob(job);
    response.outcome = "FAILED";
    response.error = {
      category: "ADAPTER_FAILURE",
      code: code,
      message: message,
      details: details || null
    };
    response.readback = null;
    if (response.diagnostics) {
      response.diagnostics.adapterBuild = BUILD;
      if (!response.diagnostics.notes) response.diagnostics.notes = [];
      response.diagnostics.notes.push(message);
    }
    return $.global.EditFlow2_JSON.stringify(response);
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return innerDispatch(requestJson); }

    var responseJson = innerDispatch(requestJson);
    if (!request || request.command !== "render.capture") return responseJson;

    var response = null;
    try { response = $.global.EditFlow2_JSON.parse(responseJson); } catch (_) { return responseJson; }
    if (!response || response.outcome !== "APPLIED") return responseJson;

    var job = $.global.EditFlow2_activeRenderJob;
    if (!job || job.requestId !== request.requestId || !job.rqItem) {
      return failResponse(response, job, "RENDER_JOB_READBACK_MISSING",
        "render.capture scheduled successfully but its active render job could not be read back.");
    }

    var requestedPath = request.payload && request.payload.outputPath ? asString(request.payload.outputPath) : "";
    if (!requestedPath) {
      return failResponse(response, job, "RENDER_OUTPUT_PATH_MISSING",
        "render.capture response could not be bound to its requested output path.");
    }

    var module = null;
    var actualFile = null;
    try {
      module = job.rqItem.outputModule(1);
      actualFile = module ? module.file : null;
    } catch (readbackError) {
      return failResponse(response, job, "RENDER_OUTPUT_READBACK_FAILED",
        "After Effects did not expose the active Output Module file readback.",
        { error: asString(readbackError) });
    }

    if (!actualFile || !actualFile.fsName) {
      return failResponse(response, job, "RENDER_OUTPUT_READBACK_MISSING",
        "After Effects returned no concrete Output Module file path for render.capture.");
    }

    var requestedFile = new File(requestedPath);
    var requestedParent = requestedFile.parent ? requestedFile.parent.fsName : "";
    var actualParent = actualFile.parent ? actualFile.parent.fsName : "";
    if (!requestedParent || !actualParent || !samePath(requestedParent, actualParent)) {
      return failResponse(response, job, "RENDER_OUTPUT_DIRECTORY_CHANGED",
        "After Effects Output Module redirected render.capture outside the authorized output directory.",
        { requestedParent: requestedParent, actualParent: actualParent });
    }

    var actualPath = actualFile.fsName;
    var staleActual = new File(actualPath);
    if (staleActual.exists && !staleActual.remove()) {
      return failResponse(response, job, "RENDER_OUTPUT_STALE_REMOVE_FAILED",
        "Unable to remove the pre-existing canonical render artifact before capture.",
        { actualOutputPath: actualPath });
    }

    job.requestedOutputPath = requestedFile.fsName;
    job.outputPath = actualPath;

    try {
      writeScheduledMarker(job);
    } catch (markerError) {
      return failResponse(response, job, "RENDER_OUTPUT_MARKER_REWRITE_FAILED",
        "Unable to bind the render lifecycle marker to After Effects' canonical output path.",
        { error: asString(markerError) });
    }

    if (!response.readback) response.readback = {};
    response.readback.requestedOutputPath = job.requestedOutputPath;
    response.readback.outputPath = job.outputPath;
    response.readback.outputPathCanonicalized = !samePath(job.requestedOutputPath, job.outputPath);
    try {
      var settings = module.getSettings(GetSettingsFormat.STRING);
      if (settings && settings.Format !== undefined) response.readback.outputFormat = asString(settings.Format);
    } catch (_) {}

    if (response.diagnostics) {
      response.diagnostics.adapterBuild = BUILD;
      if (!response.diagnostics.notes) response.diagnostics.notes = [];
      response.diagnostics.notes.push("render.capture uses OutputModule.file as the canonical artifact path; AE may change the filename extension but not its authorized directory.");
    }

    return $.global.EditFlow2_JSON.stringify(response);
  };
}());
