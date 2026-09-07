/* EditFlow 2.0 asynchronous render.capture override for protocol 1.1.
 *
 * Windows After Effects can hold the scripting boundary while a scripted render
 * starts. render.capture therefore performs only bounded queue preparation inside
 * the CEP evalScript request. The actual RenderQueue.renderAsync() call is launched
 * later from one fixed app.scheduleTask global driver after CEP has received the
 * command response.
 *
 * Important AE 25.6.6 constraint: File writes issued from app.scheduleTask can open
 * successfully yet publish zero bytes. The scheduled task therefore performs no
 * lifecycle file I/O. It only starts the render and records host-global state. The
 * CEP panel invokes EditFlow2_reconcileAsyncRender through a normal evalScript after
 * the scripting engine is available again; that normal CEP context owns queue
 * cleanup and durable DONE/FAILED marker publication.
 */
(function () {
  "use strict";

  var PROTOCOL = "1.1.0";
  var BUILD = "0.1.0-dev.4-renderasync5";
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
      var payload = $.global.EditFlow2_JSON.stringify({
        schemaVersion: 1,
        jobId: job.jobId,
        status: status,
        ok: ok,
        outputPath: job.outputPath,
        error: errorMessage || null,
        completedAtMs: nowMs(),
        queueItemRemoved: job.queueItemRemoved === true
      });
      if (!marker.write(payload)) throw new Error("After Effects did not write the render lifecycle marker payload.");
    } finally {
      marker.close();
    }
    marker = new File(job.completionPath);
    if (!marker.exists || marker.length <= 0) {
      throw new Error("Render lifecycle marker is missing or empty after CEP publication: " + marker.fsName);
    }
  }

  function cleanupQueueItem(job) {
    if (!job || job.queueItemRemoved === true || !job.rqItem) return null;
    try {
      job.rqItem.remove();
      job.queueItemRemoved = true;
      return null;
    } catch (error) {
      job.queueItemRemoved = false;
      return asString(error);
    }
  }

  function publishTerminal(job) {
    writeImmediateMarker(
      job,
      job.terminalOk === true ? "DONE" : "FAILED",
      job.terminalOk === true,
      job.terminalError || null
    );
    job.state = job.terminalOk === true ? "DONE" : "FAILED";
    job.completedAtMs = nowMs();
    $.global.EditFlow2_lastRenderJob = job;
    $.global.EditFlow2_activeRenderJob = null;
    return job.state;
  }

  function beginTerminal(job, ok, errorMessage) {
    if (job.state !== "FINALIZING") {
      var cleanupError = cleanupQueueItem(job);
      if (cleanupError) {
        ok = false;
        errorMessage = (errorMessage ? errorMessage + " | " : "") + "Render queue cleanup failed: " + cleanupError;
      }
      job.terminalOk = ok === true;
      job.terminalError = errorMessage || null;
      job.state = "FINALIZING";
      job.completedAtMs = nowMs();
    }
    return publishTerminal(job);
  }

  function reconcileActiveRenderJob() {
    var job = $.global.EditFlow2_activeRenderJob;
    if (!job || job.mode !== "ASYNC_HOST_RENDER_V4") return "IDLE";

    if (job.state === "FINALIZING") return publishTerminal(job);
    if (job.state === "SCHEDULED") return "SCHEDULED";

    if (job.driverError) return beginTerminal(job, false, job.driverError);

    var rendering = false;
    try { rendering = app.project.renderQueue.rendering === true; } catch (_) { rendering = false; }
    if (rendering) return "RUNNING";

    var statusDone = false;
    var statusText = "unknown";
    try {
      if (job.rqItem) {
        statusDone = job.rqItem.status === RQItemStatus.DONE;
        statusText = asString(job.rqItem.status);
      }
    } catch (_) {}

    if (!statusDone && job.renderAsyncReturnedAtMs !== null
        && nowMs() - job.renderAsyncReturnedAtMs < 2000) {
      return "RUNNING";
    }

    if (!statusDone) {
      return beginTerminal(job, false, "After Effects async render stopped without DONE status (status=" + statusText + ").");
    }

    var output = new File(job.outputPath);
    if (!output.exists || output.length <= 0) {
      return beginTerminal(job, false, "After Effects async render reached DONE without a non-empty capture artifact.");
    }

    return beginTerminal(job, true, null);
  }

  /* Called by the CEP panel through a normal evalScript boundary. File I/O must
   * stay here (or in the dispatch path), never in app.scheduleTask callbacks. */
  $.global.EditFlow2_reconcileAsyncRender = function () {
    try {
      return reconcileActiveRenderJob();
    } catch (error) {
      var job = $.global.EditFlow2_activeRenderJob;
      if (job) {
        job.reconcileError = asString(error);
        job.reconcileAttempts = (job.reconcileAttempts || 0) + 1;
      }
      return "ERROR:" + asString(error);
    }
  };

  /* app.scheduleTask executes this function in AE's global workspace. Keep it
   * self-contained and deliberately free of File I/O. */
  $.global.EditFlow2_driveAsyncRender = function () {
    var job = $.global.EditFlow2_activeRenderJob;
    if (!job || job.mode !== "ASYNC_HOST_RENDER_V4" || job.state !== "SCHEDULED") return;

    function taskNowMs() { return (new Date()).getTime(); }
    function taskString(value) { return value === null || value === undefined ? "" : String(value); }

    job.state = "RUNNING";
    job.startedAtMs = taskNowMs();
    try {
      if (!app.project || !app.project.renderQueue || typeof app.project.renderQueue.renderAsync !== "function") {
        job.driverError = "RenderQueue.renderAsync became unavailable before scheduled render start.";
        job.renderAsyncReturnedAtMs = taskNowMs();
        job.state = "AWAITING_FINALIZE";
        return;
      }

      /* This call is deliberately outside the CEP evalScript request. Some AE
       * Windows builds hold the scripting call while renderAsync starts/runs; CEP
       * has already received the SCHEDULED response before we cross here. */
      app.project.renderQueue.renderAsync();
      job.renderAsyncReturnedAtMs = taskNowMs();
      job.state = "AWAITING_FINALIZE";
    } catch (driverError) {
      job.driverError = "Async render driver failed: " + taskString(driverError);
      job.renderAsyncReturnedAtMs = taskNowMs();
      job.state = "AWAITING_FINALIZE";
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

    /* Any ordinary CEP traffic is also a safe reconciliation opportunity. The
     * panel has a dedicated maintenance call, but this keeps recovery idempotent
     * across reconnects and older clients. */
    if (!request || request.command !== "render.capture") {
      try { reconcileActiveRenderJob(); } catch (_) {}
      return innerDispatch(requestJson);
    }

    try {
      try { reconcileActiveRenderJob(); } catch (_) {}

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
      var stagedCompletionFile = new File(completionPath + ".next");
      if (stagedCompletionFile.exists) {
        try { stagedCompletionFile.remove(); } catch (_) {}
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
          mode: "ASYNC_HOST_RENDER_V4",
          queueItemRemoved: false,
          scheduledAtMs: nowMs(),
          startedAtMs: null,
          renderAsyncReturnedAtMs: null,
          driveTaskId: null,
          terminalOk: null,
          terminalError: null,
          driverError: null,
          reconcileError: null,
          reconcileAttempts: 0
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
        response.diagnostics.notes.push("app.scheduleTask performs no lifecycle File I/O; the CEP panel reconciles queue state and publishes terminal evidence through a normal evalScript boundary.");
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