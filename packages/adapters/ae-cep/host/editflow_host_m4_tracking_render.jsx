/* M4 typed TIFF tracking evidence wrapper over accepted render.capture. */
(function () {
  "use strict";
  var MAX_FRAMES = 120;
  var RESOLUTION_FACTOR = 2;
  var innerDispatch = $.global.EditFlow2_dispatch;
  var innerReconcile = $.global.EditFlow2_reconcileAsyncRender;
  var S = $.global.EditFlow2_M4TrackingRenderSupport;
  if (typeof innerDispatch !== "function" || typeof innerReconcile !== "function") throw new Error("M4 tracking render requires the accepted async renderer.");
  if (!S || S.PROFILE !== "TRACKING_TIFF_SEQUENCE_V1") throw new Error("M4 tracking render support is unavailable.");

  function configure(request, response) {
    var job = $.global.EditFlow2_activeRenderJob;
    if (!job || job.requestId !== request.requestId || !job.rqItem) return S.fail(response, job, "M4_TRACKING_RENDER_JOB_MISSING", "Owned tracking render queue item is unavailable.");
    var pattern = S.patternFor(request.payload.outputPath);
    if (!pattern) return S.fail(response, job, "M4_TRACKING_TIFF_PATH_REQUIRED", "TRACKING_TIFF_SEQUENCE_V1 requires .tif or .tiff outputPath.");
    if (!pattern.parent || !pattern.parent.exists) return S.fail(response, job, "M4_TRACKING_OUTPUT_DIRECTORY_MISSING", "Tracking evidence output directory does not exist.");

    var comp = null, rate = 0, duration = 0;
    try { comp = job.rqItem.comp; rate = comp ? Number(comp.frameRate) : 0; duration = Number(job.rqItem.timeSpanDuration); } catch (_) {}
    var exact = rate * duration, expected = Math.round(exact);
    if (!(rate > 0) || !(duration > 0) || Math.abs(exact - expected) > 0.01 || expected < 1 || expected > MAX_FRAMES) {
      return S.fail(response, job, "M4_TRACKING_FRAME_BOUND_INVALID", "Tracking evidence requires an exact whole-frame span from 1 to " + MAX_FRAMES + " frames.", { frameRate: rate, duration: duration, exactFrames: exact });
    }

    var module = null, actual = null;
    try {
      job.rqItem.resolutionFactor = [RESOLUTION_FACTOR, RESOLUTION_FACTOR];
      module = job.rqItem.outputModule(1);
      module.applyTemplate(S.TEMPLATE);
      module.file = pattern;
      actual = module.file;
    } catch (error) {
      return S.fail(response, job, "M4_TRACKING_OUTPUT_TEMPLATE_UNAVAILABLE", "After Effects could not apply the fixed tracking TIFF template.", { error: S.text(error) });
    }
    if (!actual || !actual.fsName || !actual.parent || !S.samePath(actual.parent.fsName, pattern.parent.fsName)) return S.fail(response, job, "M4_TRACKING_OUTPUT_DIRECTORY_CHANGED", "After Effects redirected tracking evidence outside the authorized directory.");
    if (actual.name.indexOf("[#####]") < 0) return S.fail(response, job, "M4_TRACKING_SEQUENCE_TOKEN_LOST", "After Effects did not preserve the five-digit tracking sequence token.");
    var settings = null; try { settings = module.getSettings(GetSettingsFormat.STRING); } catch (_) {}
    var format = settings && settings.Format !== undefined ? S.text(settings.Format) : "";
    var channels = settings && settings.Channels !== undefined ? S.text(settings.Channels) : "";
    if (format.indexOf("TIFF") < 0 || channels.indexOf("Alpha") < 0) return S.fail(response, job, "M4_TRACKING_OUTPUT_TEMPLATE_MISMATCH", "Tracking output did not resolve to TIFF Sequence with alpha.", { format: format, channels: channels });

    job.trackingEvidenceProfile = S.PROFILE;
    job.trackingSequencePattern = actual.fsName;
    job.trackingSequenceDirectory = actual.parent.fsName;
    job.trackingSequenceWildcardName = actual.name.replace("[#####]", "*");
    job.trackingExpectedFrameCount = expected;
    job.trackingFramePaths = [];
    job.trackingSequenceValidated = false;
    job.trackingSequenceManifestPath = job.completionPath + ".frames.json";
    job.trackingManifestPublished = false;
    job.outputPath = job.trackingSequencePattern;
    try { S.removeStale(job); S.marker(job, "SCHEDULED", false, null); }
    catch (error) { return S.fail(response, job, "M4_TRACKING_EVIDENCE_SETUP_FAILED", "Unable to initialize bounded tracking frame evidence.", { error: S.text(error) }); }

    if (!response.readback) response.readback = {};
    response.readback.outputProfile = S.PROFILE;
    response.readback.outputModuleTemplate = S.TEMPLATE;
    response.readback.outputFormat = "TIFF Sequence";
    response.readback.outputPath = job.trackingSequencePattern;
    response.readback.trackingSequencePattern = job.trackingSequencePattern;
    response.readback.trackingSequenceManifestPath = job.trackingSequenceManifestPath;
    response.readback.expectedFrameCount = expected;
    response.readback.trackingResolutionFactor = [RESOLUTION_FACTOR, RESOLUTION_FACTOR];
    response.readback.outputPathCanonicalized = !S.samePath(request.payload.outputPath, job.trackingSequencePattern);
    if (!response.diagnostics) response.diagnostics = {};
    response.diagnostics.adapterBuild = S.BUILD;
    if (!response.diagnostics.notes) response.diagnostics.notes = [];
    response.diagnostics.notes.push("Fixed TIFF tracking profile applied above accepted render.capture.");
    if (!response.proofArtifactRefs) response.proofArtifactRefs = [];
    response.proofArtifactRefs.push(job.trackingSequenceManifestPath);
    return $.global.EditFlow2_JSON.stringify(response);
  }

  function prepare() {
    var job = $.global.EditFlow2_activeRenderJob;
    if (!job || job.trackingEvidenceProfile !== S.PROFILE || job.trackingSequenceValidated === true || job.state === "SCHEDULED") return;
    var rendering = false; try { rendering = app.project.renderQueue.rendering === true; } catch (_) {}
    if (rendering) return;
    var done = false; try { done = job.rqItem && job.rqItem.status === RQItemStatus.DONE; } catch (_) {}
    if (!done) return;
    try {
      var found = S.files(job), paths = [], i;
      if (found.length !== job.trackingExpectedFrameCount) throw new Error("Expected " + job.trackingExpectedFrameCount + " TIFF frames but found " + found.length + ".");
      for (i = 0; i < found.length; i += 1) { if (!found[i].exists || found[i].length <= 0) throw new Error("Tracking frame is missing or empty."); paths.push(found[i].fsName); }
      job.trackingFramePaths = paths; job.trackingSequenceValidated = true; job.outputPath = paths[0];
    } catch (error) { job.driverError = "M4 tracking sequence validation failed: " + S.text(error); }
  }

  function publish() {
    var job = $.global.EditFlow2_lastRenderJob;
    if (!job || job.trackingEvidenceProfile !== S.PROFILE || job.trackingManifestPublished === true) return;
    try { S.manifest(job); }
    catch (error) { job.trackingManifestError = S.text(error); job.state = "FAILED"; job.terminalOk = false; job.terminalError = "Tracking manifest publication failed: " + job.trackingManifestError; try { S.marker(job, "FAILED", false, job.terminalError); } catch (_) {} }
  }

  $.global.EditFlow2_reconcileAsyncRender = function () { try { prepare(); } catch (_) {} var state = innerReconcile(); publish(); return state; };
  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null; try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return innerDispatch(requestJson); }
    try { prepare(); } catch (_) {}
    if (!request || request.command !== "render.capture") { var ordinary = innerDispatch(requestJson); publish(); return ordinary; }
    var payload = request.payload || {};
    if (payload.outputProfile === undefined || payload.outputProfile === null || payload.outputProfile === "") { var standard = innerDispatch(requestJson); publish(); return standard; }
    if (payload.outputProfile !== S.PROFILE) return S.reject(request, "M4_RENDER_PROFILE_UNSUPPORTED", "render.capture outputProfile is not allow-listed for M4.", { requested: payload.outputProfile, supported: S.PROFILE });
    if (request.protocolVersion !== "1.1.0") return S.reject(request, "M4_TRACKING_RENDER_PROTOCOL_MISMATCH", "TRACKING_TIFF_SEQUENCE_V1 is carried only by typed render.capture protocol 1.1.0.");
    var responseJson = innerDispatch(requestJson), response = null;
    try { response = $.global.EditFlow2_JSON.parse(responseJson); } catch (_) { return responseJson; }
    if (!response || response.outcome !== "APPLIED") return responseJson;
    return configure(request, response);
  };
  $.global.EditFlow2_M4_TRACKING_RENDER_PROFILE = S.PROFILE;
  $.global.EditFlow2_M4_TRACKING_RENDER_MAX_FRAMES = MAX_FRAMES;
  $.global.EditFlow2_M4_TRACKING_RENDER_RESOLUTION_FACTOR = RESOLUTION_FACTOR;
}());
