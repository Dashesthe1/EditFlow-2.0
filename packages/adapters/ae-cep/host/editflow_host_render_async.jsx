/* EditFlow 2.0 asynchronous render.capture override for protocol 1.1.
 *
 * Windows After Effects can freeze the scripting/UI boundary while
 * RenderQueue.render() is executing. This layer supersedes the earlier blocking
 * scheduled-render implementation for render.capture only. It feature-detects
 * RenderQueue.renderAsync(), starts the render without monopolizing the CEP
 * scripting call, and uses a fixed global polling task to produce terminal proof.
 *
 * If renderAsync() is unavailable, the command fails closed. It never silently
 * falls back to the known-blocking RenderQueue.render() path.
 */
(function () {
  "use strict";

  var PROTOCOL = "1.1.0";
  var BUILD = "0.1.0-dev.4-renderasync1";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var innerDispatch = $.global.EditFlow2_dispatch;

  if (typeof innerDispatch !== "function") {
    throw new Error("EditFlow async-render wrapper requires the protocol 1.1 dispatcher.");
  }
  if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.stringify !== "function") {
    throw new Error("EditFlow async-render wrapper requires the clean-room JSON runtime.");
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

  function writeImmediateMarker(job, status, ok, errorMessage) {
    var marker = new File(job.completionPath);
    marker.encoding = "UTF-8";
    if (!marker.open("w")) throw new Error("Unable to open render lifecycle marker: " + marker.fsName);
    try {
      marker.write($.global.EditFlow2_JSON.stringify({
        schemaVersion: 1,
        jobId: job.jobId,
        status: status,
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

  /* Runs only after renderAsync() has returned control to AE. The poller is fully
   * self-contained because app.scheduleTask executes in the global workspace.
   */
  $.global.EditFlow2_pollAsyncRender = function () {
    var job = $.global.EditFlow2_activeRenderJob;
    if (!job || job.mode !== "ASYNC_HOST_RENDER_V2" || job.state !== "RUNNING") return;

    function taskNowMs() { return (new Date()).getTime(); }
    function taskString(value) { return value === null || value === undefined ? "" : String(value); }
    function taskQuote(value) {
      var text = taskString(value);
      text = text.replace(/\\/g, "\\\\");
      text = text.replace(/"/g, "\\\"");
      text = text.replace(/\r/g, "\\r");
      text = text.replace(/\n/g, "\\n");
      text = text.replace(/\t/g, "\\t");
      return "\"" + text + "\"";
    }
    function taskWriteMarker(status, ok, errorMessage) {
      var marker = new File(job.completionPath);
      marker.encoding = "UTF-8";
      if (!marker.open("w")) throw new Error("Unable to open render lifecycle marker: " + marker.fsName);
      try {
        var payload = "{" +
          "\"schemaVersion\":1," +
          "\"jobId\":" + taskQuote(job.jobId) + "," +
          "\"status\":" + taskQuote(status) + "," +
          "\"ok\":" + (ok ? "true" : "false") + "," +
          "\"outputPath\":" + taskQuote(job.outputPath) + "," +
          "\"error\":" + (errorMessage ? taskQuote(errorMessage) : "null") + "," +
          "\"completedAtMs\":" + taskNowMs() + "," +
          "\"queueItemRemoved\":" + (job.queueItemRemoved === true ? "true" : "false") +
          "}";
        marker.write(payload);
      } finally {
        marker.close();
      }
    }
    function taskCleanupQueueItem() {
      if (!job.rqItem) return null;
      try {
        job.rqItem.remove();
        job.queueItemRemoved = true;
        return null;
      } catch (cleanupError) {
        job.queueItemRemoved = false;
        return taskString(cleanupError);
      }
    }
    function taskFinish(ok, errorMessage) {
      var cleanupError = taskCleanupQueueItem();
      if (cleanupError) {
        ok = false;
        errorMessage = (errorMessage ? errorMessage + " | " : "") + "Render queue cleanup failed: " + cleanupError;
      }
      job.state = ok ? "DONE" : "FAILED";
      job.completedAtMs = taskNowMs();
      try { taskWriteMarker(job.state, ok, errorMessage); } catch (_) {}
      $.global.EditFlow2_lastRenderJob = job;
      $.global.EditFlow2_activeRenderJob = null;
    }
    function taskScheduleNextPoll() {
      var taskId = app.scheduleTask("$.global.EditFlow2_pollAsyncRender()", 250, false);
      if (typeof taskId !== "number") throw new Error("After Effects did not return an async render poll task identifier.");
      job.pollTaskId = taskId;
    }

    try {
      var rendering = false;
      try { rendering = app.project.renderQueue.rendering === true; } catch (_) { rendering = false; }

      var statusDone = false;
      var statusText = "unknown";
      try {
        if (job.rqItem) {
          statusDone = job.rqItem.status === RQItemStatus.DONE;
          statusText = taskString(job.rqItem.status);
        }
      } catch (_) {}

      if (rendering) {
        taskScheduleNextPoll();
        return;
      }

      /* renderAsync() can return before AE flips RenderQueue.rendering. Give the
       * host a short startup grace period before treating a non-DONE status as a
       * terminal failure. */
      if (!statusDone && taskNowMs() - job.startedAtMs < 2000) {
        taskScheduleNextPoll();
        return;
      }

      if (!statusDone) {
        taskFinish(false, "After Effects async render stopped without DONE status (status=" + statusText + ").");
        return;
      }

      var output = new File(job.outputPath);
      if (!output.exists || output.length <= 0) {
        taskFinish(false, "After Effects async render reached DONE without a non-empty capture artifact.");
        return;
      }

      taskFinish(true, null);
    } catch (pollError) {
      taskFinish(false, "Async render polling failed: " + taskString(pollError));
    }
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
          "Protocol 1.1.0 is required for asynchronous render capture."
        ));
      }
      if (!app.project) {
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "REJECTED", "VALIDATION_ERROR", "PROJECT_NOT_OPEN",
          "render.capture requires an open After Effects project."
        ));
      }
      if (typeof app.project.renderQueue.renderAsync !== "function") {
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "REJECTED", "CAPABILITY_UNAVAILABLE", "ASYNC_RENDER_UNAVAILABLE",
          "This After Effects build does not expose RenderQueue.renderAsync(); refusing to fall back to blocking scripted render."
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
      var priorOutput = new File(payload.outputPath);
      if (priorOutput.exists) {
        try { priorOutput.remove(); } catch (_) {}
      }

      var rqItem = null;
      var job = null;
      try {
        rqItem = app.project.renderQueue.items.add(comp);
        if (payload.timeSpanStart !== undefined) rqItem.timeSpanStart = payload.timeSpanStart;
        if (payload.timeSpanDuration !== undefined) rqItem.timeSpanDuration = payload.timeSpanDuration;
        rqItem.render = true;
        var module = rqItem.outputModule(1);
        module.file = new File(payload.outputPath);

        job = {
          jobId: request.requestId,
          requestId: request.requestId,
          outputPath: payload.outputPath,
          completionPath: completionPath,
          rqItem: rqItem,
          state: "SCHEDULED",
          mode: "ASYNC_HOST_RENDER_V2",
          queueItemRemoved: false,
          scheduledAtMs: nowMs(),
          startedAtMs: null,
          pollTaskId: null
        };
        $.global.EditFlow2_activeRenderJob = job;
        writeImmediateMarker(job, "SCHEDULED", false, null);

        app.project.renderQueue.renderAsync();
        job.state = "RUNNING";
        job.startedAtMs = nowMs();
        writeImmediateMarker(job, "RUNNING", false, null);

        var pollTaskId = app.scheduleTask("$.global.EditFlow2_pollAsyncRender()", 250, false);
        if (typeof pollTaskId !== "number") throw new Error("After Effects did not return an async render poll task identifier.");
        job.pollTaskId = pollTaskId;

        var response = responseBase(request, started, beforeRevision);
        response.outcome = "APPLIED";
        response.readback = {
          jobId: job.jobId,
          state: "SCHEDULED",
          outputPath: job.outputPath,
          completionPath: job.completionPath,
          taskId: job.pollTaskId,
          mode: "SCHEDULED_HOST_JOB_V1",
          renderMethod: "RenderQueue.renderAsync"
        };
        response.hostProjectRevision = app.project.revision;
        response.diagnostics.durationMs = nowMs() - started;
        response.diagnostics.hostRevisionAfter = app.project.revision;
        response.diagnostics.notes.push("Render execution uses feature-detected RenderQueue.renderAsync() plus fixed global polling; blocking RenderQueue.render() is not used.");
        response.proofArtifactRefs = [job.completionPath];
        return JSON.stringify(response);
      } catch (setupError) {
        $.global.EditFlow2_activeRenderJob = null;
        if (job) {
          var cleanupError = cleanupQueueItem(job);
          if (cleanupError) setupError = asString(setupError) + " | Render queue cleanup failed: " + cleanupError;
          try { writeImmediateMarker(job, "FAILED", false, asString(setupError)); } catch (_) {}
        } else if (rqItem) {
          try { rqItem.remove(); } catch (_) {}
        }
        return JSON.stringify(failureResponse(
          request, started, beforeRevision, "FAILED", "ADAPTER_FAILURE", "ASYNC_RENDER_START_FAILED",
          asString(setupError)
        ));
      }
    } catch (error) {
      return JSON.stringify(failureResponse(
        request, started, beforeRevision, "FAILED", "ADAPTER_FAILURE", "ASYNC_RENDER_WRAPPER_FAILED",
        asString(error)
      ));
    }
  };
}());
