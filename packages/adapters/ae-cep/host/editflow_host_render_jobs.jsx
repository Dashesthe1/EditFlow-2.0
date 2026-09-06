/* EditFlow 2.0 non-blocking render.capture wrapper for protocol 1.1.
 *
 * AE's RenderQueue.render() does not return until rendering completes. Calling it
 * directly from a CEP evalScript request monopolizes the host scripting call and
 * prevents the control plane from receiving a response. This layer converts the
 * fixed render.capture command into a scheduled host job: dispatch only prepares
 * an isolated render-queue item and schedules a fixed global function. The actual
 * blocking render runs after the CEP evalScript has returned, and completion is
 * reported through a sidecar JSON marker in the same allowed artifact directory.
 *
 * No caller-supplied script text is executed. app.scheduleTask receives one fixed
 * literal function call only.
 */
(function () {
  "use strict";

  var PROTOCOL = "1.1.0";
  var BUILD = "0.1.0-dev.4-renderjob1";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var innerDispatch = $.global.EditFlow2_dispatch;

  if (typeof innerDispatch !== "function") {
    throw new Error("EditFlow render-job wrapper requires the protocol 1.1 dispatcher.");
  }
  if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.stringify !== "function") {
    throw new Error("EditFlow render-job wrapper requires the clean-room JSON runtime.");
  }

  function nowMs() { return (new Date()).getTime(); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }

  function getStableId(commentText) {
    var text = asString(commentText);
    var start = text.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = text.indexOf(STABLE_SUFFIX, start);
    return end < 0 ? null : text.substring(start, end);
  }

  function hostId(target) {
    try { return typeof target.id === "number" ? target.id : null; } catch (_) { return null; }
  }

  function findItem(ref) {
    var project = app.project;
    var i, item;
    if (ref && typeof ref.hostId === "number" && project.itemByID) {
      try {
        item = project.itemByID(ref.hostId);
        if (item) return item;
      } catch (_) {}
    }
    for (i = 1; i <= project.numItems; i += 1) {
      item = project.item(i);
      if (ref && ref.stableId && getStableId(item.comment) === ref.stableId) return item;
      if (ref && typeof ref.hostId === "number" && hostId(item) === ref.hostId) return item;
    }
    return null;
  }

  function findComp(ref) {
    var item = findItem(ref);
    if (!item || !(item instanceof CompItem)) throw new Error("render.capture composition target could not be resolved.");
    return item;
  }

  function responseBase(request, started, beforeRevision) {
    return {
      protocolVersion: PROTOCOL,
      requestId: request && request.requestId ? request.requestId : "unknown",
      transactionId: request && request.transactionId ? request.transactionId : "unknown",
      operationId: request && request.operationId ? request.operationId : "unknown",
      capabilityId: request && request.capabilityId ? request.capabilityId : "unknown",
      command: request && request.command ? request.command : "render.capture",
      outcome: "FAILED",
      error: null,
      affectedObjects: [],
      readback: null,
      projectSnapshot: null,
      environmentProbe: null,
      hostProjectRevision: app.project ? app.project.revision : null,
      diagnostics: {
        adapterProtocolVersion: PROTOCOL,
        adapterBuild: BUILD,
        command: request && request.command ? request.command : "render.capture",
        durationMs: nowMs() - started,
        hostRevisionBefore: beforeRevision,
        hostRevisionAfter: app.project ? app.project.revision : null,
        notes: []
      },
      proofArtifactRefs: []
    };
  }

  function failureResponse(request, started, beforeRevision, outcome, category, code, message, details) {
    var response = responseBase(request, started, beforeRevision);
    response.outcome = outcome;
    response.error = {
      category: category,
      code: code,
      message: message,
      details: details || null
    };
    response.diagnostics.durationMs = nowMs() - started;
    response.diagnostics.hostRevisionAfter = app.project ? app.project.revision : null;
    return response;
  }

  function writeCompletionMarker(job, ok, errorMessage) {
    var marker = new File(job.completionPath);
    marker.encoding = "UTF-8";
    if (!marker.open("w")) throw new Error("Unable to open render completion marker: " + marker.fsName);
    try {
      marker.write($.global.EditFlow2_JSON.stringify({
        schemaVersion: 1,
        jobId: job.jobId,
        status: ok ? "DONE" : "FAILED",
        ok: ok,
        outputPath: job.outputPath,
        error: errorMessage || null,
        completedAtMs: nowMs(),
        queueItemRemoved: job.queueItemRemoved === true
      }));
    } finally {
      marker.close();
    }
  }

  function cleanupQueueItem(job) {
    if (!job || !job.rqItem) return null;
    try {
      job.rqItem.remove();
      job.queueItemRemoved = true;
      return null;
    } catch (error) {
      job.queueItemRemoved = false;
      return asString(error);
    }
  }

  $.global.EditFlow2_runScheduledRender = function () {
    var job = $.global.EditFlow2_activeRenderJob;
    if (!job || job.state !== "SCHEDULED") return;

    job.state = "RENDERING";
    var ok = false;
    var errorMessage = null;
    try {
      app.project.renderQueue.render();
      var output = new File(job.outputPath);
      var statusDone = false;
      try { statusDone = job.rqItem && job.rqItem.status === RQItemStatus.DONE; } catch (_) { statusDone = false; }
      if (!statusDone) throw new Error("After Effects render queue did not finish the EditFlow capture with DONE status.");
      if (!output.exists || output.length <= 0) throw new Error("After Effects render completed without a non-empty capture artifact.");
      ok = true;
    } catch (error) {
      errorMessage = asString(error);
    }

    var cleanupError = cleanupQueueItem(job);
    if (cleanupError) {
      ok = false;
      errorMessage = (errorMessage ? errorMessage + " | " : "") + "Render queue cleanup failed: " + cleanupError;
    }

    job.state = ok ? "DONE" : "FAILED";
    try {
      writeCompletionMarker(job, ok, errorMessage);
    } catch (markerError) {
      job.markerError = asString(markerError);
    }
    $.global.EditFlow2_lastRenderJob = job;
    $.global.EditFlow2_activeRenderJob = null;
  };

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    var started = nowMs();
    var beforeRevision = app.project ? app.project.revision : null;

    try {
      request = JSON.parse(requestJson);
    } catch (_) {
      return innerDispatch(requestJson);
    }

    if (!request || request.command !== "render.capture") return innerDispatch(requestJson);

    try {
      if (request.protocolVersion !== PROTOCOL) {
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "REJECTED", "VALIDATION_ERROR", "PROTOCOL_VERSION_MISMATCH",
          "Protocol 1.1.0 is required for scheduled render capture."
        ));
      }
      if (!app.project) {
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "REJECTED", "VALIDATION_ERROR", "PROJECT_NOT_OPEN",
          "render.capture requires an open After Effects project."
        ));
      }
      if (request.expectedHostProjectRevision !== null && request.expectedHostProjectRevision !== undefined
          && app.project.revision !== request.expectedHostProjectRevision) {
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "REJECTED", "STALE_PROJECT_STATE", "HOST_REVISION_MISMATCH",
          "After Effects project revision changed before render capture scheduling.",
          { expected: request.expectedHostProjectRevision, actual: app.project.revision }
        ));
      }
      if ($.global.EditFlow2_activeRenderJob) {
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "REJECTED", "CONFLICT", "RENDER_JOB_ALREADY_ACTIVE",
          "A bounded EditFlow render job is already active."
        ));
      }
      if (app.project.renderQueue.rendering) {
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "REJECTED", "CONFLICT", "AE_RENDER_ALREADY_ACTIVE",
          "After Effects is already rendering."
        ));
      }
      if (app.project.renderQueue.numItems !== 0) {
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "REJECTED", "CONFLICT", "RENDER_QUEUE_NOT_EMPTY",
          "Bounded render.capture refuses to alter or render pre-existing Render Queue items."
        ));
      }

      var payload = request.payload || {};
      if (!payload.outputPath || typeof payload.outputPath !== "string") {
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "REJECTED", "VALIDATION_ERROR", "OUTPUT_PATH_REQUIRED",
          "render.capture requires outputPath."
        ));
      }

      var comp = findComp(payload.comp);
      var completionPath = payload.outputPath + ".editflow-render.json";
      var completionFile = new File(completionPath);
      if (completionFile.exists) {
        try { completionFile.remove(); } catch (_) {}
      }

      var rqItem = null;
      try {
        rqItem = app.project.renderQueue.items.add(comp);
        if (payload.timeSpanStart !== undefined) rqItem.timeSpanStart = payload.timeSpanStart;
        if (payload.timeSpanDuration !== undefined) rqItem.timeSpanDuration = payload.timeSpanDuration;
        rqItem.render = true;
        var module = rqItem.outputModule(1);
        module.file = new File(payload.outputPath);

        var job = {
          jobId: request.requestId,
          requestId: request.requestId,
          outputPath: payload.outputPath,
          completionPath: completionPath,
          rqItem: rqItem,
          state: "SCHEDULED",
          queueItemRemoved: false,
          scheduledAtMs: nowMs(),
          taskId: null
        };
        $.global.EditFlow2_activeRenderJob = job;

        var taskId = app.scheduleTask("$.global.EditFlow2_runScheduledRender()", 25, false);
        if (typeof taskId !== "number") throw new Error("After Effects did not return a render task identifier.");
        job.taskId = taskId;

        var response = responseBase(request, started, beforeRevision);
        response.outcome = "APPLIED";
        response.readback = {
          jobId: job.jobId,
          state: "SCHEDULED",
          outputPath: job.outputPath,
          completionPath: job.completionPath,
          taskId: job.taskId,
          mode: "SCHEDULED_HOST_JOB_V1"
        };
        response.hostProjectRevision = app.project.revision;
        response.diagnostics.durationMs = nowMs() - started;
        response.diagnostics.hostRevisionAfter = app.project.revision;
        response.diagnostics.notes.push("Render execution was scheduled after CEP evalScript return; completion is reported by a fixed sidecar marker.");
        response.proofArtifactRefs = [job.completionPath];
        return JSON.stringify(response);
      } catch (setupError) {
        $.global.EditFlow2_activeRenderJob = null;
        if (rqItem) {
          try { rqItem.remove(); } catch (_) {}
        }
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "FAILED", "ADAPTER_FAILURE", "RENDER_JOB_SCHEDULE_FAILED",
          asString(setupError)
        ));
      }
    } catch (error) {
      return JSON.stringify(failureResponse(
        request, started, beforeRevision, "FAILED", "ADAPTER_FAILURE", "RENDER_CAPTURE_WRAPPER_FAILED",
        asString(error)
      ));
    }
  };
}());
