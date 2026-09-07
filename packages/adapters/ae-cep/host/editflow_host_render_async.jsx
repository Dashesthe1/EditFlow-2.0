/* EditFlow 2.0 asynchronous render.capture override for protocol 1.1.
 *
 * Windows After Effects can hold the scripting boundary while a scripted render
 * starts. render.capture therefore performs only bounded queue preparation inside
 * the CEP evalScript request. The actual RenderQueue.renderAsync() call is launched
 * later from one fixed app.scheduleTask global driver after CEP has received the
 * command response.
 *
 * The global driver writes RUNNING before invoking renderAsync(), then drives the
 * same job to DONE/FAILED with fixed polling after renderAsync() returns. If the
 * target AE build does not expose renderAsync(), the command fails closed. There is
 * never a silent fallback to blocking RenderQueue.render().
 */
(function () {
  "use strict";

  var PROTOCOL = "1.1.0";
  var BUILD = "0.1.0-dev.4-renderasync3";
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

  /* app.scheduleTask executes this function in AE's global workspace. It must be
   * self-contained: do not add references to wrapper-local helpers or variables.
   */
  $.global.EditFlow2_driveAsyncRender = function () {
    var job = $.global.EditFlow2_activeRenderJob;
    if (!job || job.mode !== "ASYNC_HOST_RENDER_V3") return;
    if (job.state !== "SCHEDULED" && job.state !== "RUNNING") return;

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
      /* Build the complete payload before opening/truncating the durable marker.
       * The synchronous SCHEDULED writers already prove EditFlow2_JSON is present
       * in the installed host. Reusing that clean-room runtime here avoids a
       * second hand-written serializer at the delayed global execution boundary.
       * If serialization ever fails, the previous durable marker remains intact.
       */
      if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.stringify !== "function") {
        throw new Error("EditFlow clean-room JSON runtime is unavailable in the async render driver.");
      }
      var payload = $.global.EditFlow2_JSON.stringify({
        schemaVersion: 1,
        jobId: job.jobId,
        status: status,
        ok: ok,
        outputPath: job.outputPath,
        error: errorMessage || null,
        completedAtMs: taskNowMs(),
        queueItemRemoved: job.queueItemRemoved === true
      });
      var marker = new File(job.completionPath);
      marker.encoding = "UTF-8";
      if (!marker.open("w")) throw new Error("Unable to open render lifecycle marker: " + marker.fsName);
      try {
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
    function taskScheduleDrive(delayMs) {
      var taskId = app.scheduleTask("$.global.EditFlow2_driveAsyncRender()", delayMs, false);
      if (typeof taskId !== "number") throw new Error("After Effects did not return an async render driver task identifier.");
      job.driveTaskId = taskId;
    }

    try {
      if (job.state === "SCHEDULED") {
        job.state = "RUNNING";
        job.startedAtMs = taskNowMs();
        taskWriteMarker("RUNNING", false, null);

        if (!app.project || !app.project.renderQueue || typeof app.project.renderQueue.renderAsync !== "function") {
          taskFinish(false, "RenderQueue.renderAsync became unavailable before scheduled render start.");
          return;
        }

        /* This call is deliberately outside the CEP evalScript request. Some AE
         * Windows builds hold the scripting call while renderAsync starts/runs; CEP
         * must already have received the SCHEDULED response before we cross here. */
        app.project.renderQueue.renderAsync();
        job.renderAsyncReturnedAtMs = taskNowMs();
        taskScheduleDrive(250);
        return;
      }

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
        taskScheduleDrive(250);
        return;
      }

      if (!statusDone && job.renderAsyncReturnedAtMs !== null
          && taskNowMs() - job.renderAsyncReturnedAtMs < 2000) {
        taskScheduleDrive(250);
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
    } catch (driverError) {
      taskFinish(false, "Async render driver failed: " + taskString(driverError));
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
          mode: "ASYNC_HOST_RENDER_V3",
          queueItemRemoved: false,
          scheduledAtMs: nowMs(),
          startedAtMs: null,
          renderAsyncReturnedAtMs: null,
          driveTaskId: null
        };
        $.global.EditFlow2_activeRenderJob = job;
        writeImmediateMarker(job, "SCHEDULED", false, null);

        /* Critical transport boundary: only schedule the global driver here. Never
         * invoke renderAsync() directly from the CEP dispatch path. */
        var driveTaskId = app.scheduleTask("$.global.EditFlow2_driveAsyncRender()", 25, false);
        if (typeof driveTaskId !== "number") throw new Error("After Effects did not return an async render driver task identifier.");
        job.driveTaskId = driveTaskId;

        var response = responseBase(request, started, beforeRevision);
        response.outcome = "APPLIED";
        response.readback = {
          jobId: job.jobId,
          state: "SCHEDULED",
          outputPath: job.outputPath,
          completionPath: job.completionPath,
          taskId: job.driveTaskId,
          mode: "SCHEDULED_HOST_JOB_V1",
          renderMethod: "RenderQueue.renderAsync.scheduled"
        };
        response.hostProjectRevision = app.project.revision;
        response.diagnostics.durationMs = nowMs() - started;
        response.diagnostics.hostRevisionAfter = app.project.revision;
        response.diagnostics.notes.push("CEP dispatch only prepares and schedules the fixed async render driver; RenderQueue.renderAsync() executes after evalScript returns.");
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
          request, started, beforeRevision, "FAILED", "ADAPTER_FAILURE", "ASYNC_RENDER_SCHEDULE_FAILED",
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