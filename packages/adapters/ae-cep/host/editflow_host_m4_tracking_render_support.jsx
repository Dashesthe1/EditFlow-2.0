/* M4 tracking render support. No public command surface. */
(function () {
  "use strict";
  var BUILD = "0.5.0-dev.1-m4-tracking-render";
  var PROFILE = "TRACKING_TIFF_SEQUENCE_V1";
  var TEMPLATE = "TIFF Sequence with Alpha";
  function nowMs() { return (new Date()).getTime(); }
  function text(value) { return value === null || value === undefined ? "" : String(value); }
  function norm(value) { var s = text(value); return $.os.indexOf("Windows") >= 0 ? s.toLowerCase() : s; }
  function samePath(a, b) { return norm(a) === norm(b); }
  function reject(request, code, message, details) {
    return $.global.EditFlow2_JSON.stringify({
      protocolVersion: request.protocolVersion || "1.1.0", requestId: request.requestId || "unknown",
      transactionId: request.transactionId || "unknown", operationId: request.operationId || "unknown",
      capabilityId: request.capabilityId || "unknown", command: request.command || "render.capture",
      outcome: "REJECTED", error: { category: "VALIDATION_ERROR", code: code, message: message, details: details || null },
      affectedObjects: [], readback: null, projectSnapshot: null, environmentProbe: null,
      hostProjectRevision: app.project ? app.project.revision : null,
      diagnostics: { adapterProtocolVersion: request.protocolVersion || "1.1.0", adapterBuild: BUILD, command: "render.capture", notes: [message] },
      proofArtifactRefs: []
    });
  }
  function cancel(job) {
    if (!job) return;
    if (typeof job.driveTaskId === "number") { try { app.cancelTask(job.driveTaskId); } catch (_) {} }
    if (job.rqItem) { try { job.rqItem.remove(); job.queueItemRemoved = true; } catch (_) { job.queueItemRemoved = false; } }
    if ($.global.EditFlow2_activeRenderJob === job) $.global.EditFlow2_activeRenderJob = null;
  }
  function fail(response, job, code, message, details) {
    cancel(job); response.outcome = "FAILED";
    response.error = { category: "ADAPTER_FAILURE", code: code, message: message, details: details || null };
    response.readback = null; response.proofArtifactRefs = [];
    if (!response.diagnostics) response.diagnostics = {};
    response.diagnostics.adapterBuild = BUILD;
    if (!response.diagnostics.notes) response.diagnostics.notes = [];
    response.diagnostics.notes.push(message);
    return $.global.EditFlow2_JSON.stringify(response);
  }
  function patternFor(pathValue) {
    var file = new File(pathValue), name = file.name, dot = name.lastIndexOf(".");
    if (dot <= 0) return null;
    var ext = name.substring(dot).toLowerCase();
    if (ext !== ".tif" && ext !== ".tiff") return null;
    return new File(file.parent.fsName + "/" + name.substring(0, dot) + "_[#####]" + ext);
  }
  function files(job) {
    var dir = new Folder(job.trackingSequenceDirectory), output = [], i;
    if (!dir.exists) return output;
    var candidates = dir.getFiles(job.trackingSequenceWildcardName);
    for (i = 0; i < candidates.length; i += 1) if (candidates[i] instanceof File) output.push(candidates[i]);
    output.sort(function (a, b) { var x = norm(a.fsName), y = norm(b.fsName); return x < y ? -1 : (x > y ? 1 : 0); });
    return output;
  }
  function removeStale(job) {
    var found = files(job), i;
    for (i = 0; i < found.length; i += 1) if (!found[i].remove()) throw new Error("Unable to remove stale tracking frame: " + found[i].fsName);
  }
  function marker(job, status, ok, errorMessage) {
    var f = new File(job.completionPath); f.encoding = "UTF-8";
    if (!f.open("w")) throw new Error("Unable to open tracking render lifecycle marker.");
    try { f.write($.global.EditFlow2_JSON.stringify({
      schemaVersion: 1, jobId: job.jobId, status: status, ok: ok, outputPath: job.outputPath,
      outputProfile: PROFILE, trackingSequencePattern: job.trackingSequencePattern,
      trackingSequenceManifestPath: job.trackingSequenceManifestPath, expectedFrameCount: job.trackingExpectedFrameCount,
      error: errorMessage || null, completedAtMs: nowMs(), queueItemRemoved: job.queueItemRemoved === true
    })); } finally { f.close(); }
    f = new File(job.completionPath); if (!f.exists || f.length <= 0) throw new Error("Tracking render lifecycle marker is missing or empty.");
  }
  function manifest(job) {
    if (!job || job.trackingEvidenceProfile !== PROFILE || job.trackingManifestPublished === true) return;
    if (job.state !== "DONE" && job.state !== "FAILED") return;
    var f = new File(job.trackingSequenceManifestPath); f.encoding = "UTF-8";
    if (!f.open("w")) throw new Error("Unable to open tracking sequence manifest.");
    try { f.write($.global.EditFlow2_JSON.stringify({
      schemaVersion: 1, profile: PROFILE, jobId: job.jobId, status: job.state,
      ok: job.state === "DONE" && job.trackingSequenceValidated === true,
      outputModuleTemplate: TEMPLATE, outputFormat: "TIFF Sequence", sequencePattern: job.trackingSequencePattern,
      expectedFrameCount: job.trackingExpectedFrameCount, framePaths: job.trackingFramePaths || [],
      error: job.terminalError || job.driverError || null, completedAtMs: job.completedAtMs || nowMs()
    })); } finally { f.close(); }
    f = new File(job.trackingSequenceManifestPath); if (!f.exists || f.length <= 0) throw new Error("Tracking sequence manifest is missing or empty.");
    job.trackingManifestPublished = true;
  }
  $.global.EditFlow2_M4TrackingRenderSupport = {
    BUILD: BUILD, PROFILE: PROFILE, TEMPLATE: TEMPLATE, text: text, samePath: samePath,
    reject: reject, fail: fail, patternFor: patternFor, files: files, removeStale: removeStale,
    marker: marker, manifest: manifest
  };
}());
