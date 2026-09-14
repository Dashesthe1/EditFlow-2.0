(function () {
  "use strict";
  var rootPath = "__EDITFLOW_REPO_ROOT__";
  var firstFramePath = "__EDITFLOW_FIRST_FRAME__";
  var out = new File("__EDITFLOW_HOST_RESULT__");
  var loader = new File(rootPath + "/packages/adapters/ae-cep/host/editflow_host_current_v25.jsx");
  var result = { proof: "M4_MEDIA_SEQUENCE_V25_LIVE", ok: false, mutationStarted: false, cleanupComplete: false, checks: {} };
  var successItem = null;
  var rollbackItem = null;
  var baselineItems = app.project ? app.project.numItems : null;

  function write(value) {
    out.parent.create(); out.open("w"); out.encoding = "UTF-8";
    var codec = $.global.EditFlow2_JSON || $.global.JSON;
    out.write(codec ? codec.stringify(value) : String(value)); out.close();
  }
  function stableId(item) {
    try { var m = String(item.comment || "").match(/\[\[EDITFLOW2_STABLE:([^\]]+)\]\]/); return m ? m[1] : null; } catch (_) { return null; }
  }
  function findStable(id) {
    if (!app.project) return null;
    for (var i = 1; i <= app.project.numItems; i += 1) { var item = app.project.item(i); if (stableId(item) === id) return item; }
    return null;
  }
  function request(command, capability, payload, expectedRevision, profile, suffix) {
    return { protocolVersion: "2.5.0", requestId: "M4_MEDIA_SEQ_" + suffix, transactionId: "M4_MEDIA_SEQ_TX_" + suffix, operationId: "M4_MEDIA_SEQ_OP_" + suffix, capabilityId: capability, command: command, expectedHostProjectRevision: expectedRevision, payload: payload, readbackProfile: profile || null };
  }
  function dispatch(value) {
    return $.global.EditFlow2_JSON.parse($.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(value)));
  }
  function pathKey(value) { return String(value || "").replace(/\//g, "\\").toLowerCase(); }
  function exactSequence(readback, stable) {
    return !!readback && readback.stableId === stable && !readback.isStill && readback.frameCount === 3 && Math.abs(readback.frameRate - 12) < 0.0001 && Math.abs(readback.displayFrameRate - 12) < 0.0001 && pathKey(readback.path) === pathKey(firstFramePath);
  }

  try {
    if (!app.project) throw new Error("No After Effects project is open.");
    if (!loader.exists) throw new Error("Protocol 2.5 loader is missing.");
    var oldA = findStable("M4_MEDIA_SEQUENCE_SUCCESS"); if (oldA) oldA.remove();
    var oldB = findStable("M4_MEDIA_SEQUENCE_ROLLBACK"); if (oldB) oldB.remove();
    baselineItems = app.project.numItems;
    $.evalFile(loader);
    if (!$.global.EditFlow2_HOST_PROTOCOL_25) throw new Error("Protocol 2.5 did not load.");

    var revisionBefore = app.project.revision;
    result.mutationStarted = true;
    var applied = dispatch(request("media.sequence.import", "ae.media.sequence.import", { path: firstFramePath, stableId: "M4_MEDIA_SEQUENCE_SUCCESS", frameRate: 12, expectedFrameCount: 3 }, revisionBefore, null, "APPLY"));
    result.applied = applied; successItem = findStable("M4_MEDIA_SEQUENCE_SUCCESS");
    result.checks.applied = applied.outcome === "APPLIED";
    result.checks.exactApplyReadback = exactSequence(applied.readback, "M4_MEDIA_SEQUENCE_SUCCESS");

    var verify = dispatch(request("media.sequence.readback", "ae.media.sequence.readback", { item: { stableId: "M4_MEDIA_SEQUENCE_SUCCESS" } }, null, null, "VERIFY"));
    result.verify = verify;
    result.checks.independentReadback = verify.outcome === "NO_OP" && exactSequence(verify.readback, "M4_MEDIA_SEQUENCE_SUCCESS");

    var idempotent = dispatch(request("media.sequence.import", "ae.media.sequence.import", { path: firstFramePath, stableId: "M4_MEDIA_SEQUENCE_SUCCESS", frameRate: 12, expectedFrameCount: 3 }, app.project.revision, null, "IDEMPOTENT"));
    result.idempotent = idempotent;
    result.checks.idempotent = idempotent.outcome === "NO_OP" && exactSequence(idempotent.readback, "M4_MEDIA_SEQUENCE_SUCCESS");

    var stale = dispatch(request("media.sequence.import", "ae.media.sequence.import", { path: firstFramePath, stableId: "M4_MEDIA_SEQUENCE_STALE", frameRate: 12, expectedFrameCount: 3 }, revisionBefore, null, "STALE"));
    result.stale = stale;
    result.checks.staleRejected = stale.outcome === "REJECTED" && stale.error && stale.error.code === "HOST_REVISION_CONFLICT";

    $.setenv("EDITFLOW_M4_MEDIA_SEQUENCE_P4_PROOF", "1");
    var rollback = dispatch(request("media.sequence.import", "ae.media.sequence.import", { path: firstFramePath, stableId: "M4_MEDIA_SEQUENCE_ROLLBACK", frameRate: 12, expectedFrameCount: 3 }, app.project.revision, "M4_MEDIA_SEQUENCE_P4_FAILURE_INJECTION", "ROLLBACK"));
    $.setenv("EDITFLOW_M4_MEDIA_SEQUENCE_P4_PROOF", "");
    result.rollback = rollback; rollbackItem = findStable("M4_MEDIA_SEQUENCE_ROLLBACK");
    result.checks.rollbackFailedAsInjected = rollback.outcome === "FAILED" && rollback.error && rollback.error.code === "M4_MEDIA_SEQUENCE_P4_INDUCED_FAILURE";
    result.checks.rollbackRemovedImportedItem = rollbackItem === null;

    result.ok = result.checks.applied && result.checks.exactApplyReadback && result.checks.independentReadback && result.checks.idempotent && result.checks.staleRejected && result.checks.rollbackFailedAsInjected && result.checks.rollbackRemovedImportedItem;
  } catch (error) {
    result.error = String(error);
    try { $.setenv("EDITFLOW_M4_MEDIA_SEQUENCE_P4_PROOF", ""); } catch (_) {}
  } finally {
    try { successItem = findStable("M4_MEDIA_SEQUENCE_SUCCESS"); if (successItem) successItem.remove(); } catch (cleanupA) { result.cleanupError = String(cleanupA); }
    try { rollbackItem = findStable("M4_MEDIA_SEQUENCE_ROLLBACK"); if (rollbackItem) rollbackItem.remove(); } catch (cleanupB) { result.cleanupError = String(cleanupB); }
    result.after = { itemCount: app.project ? app.project.numItems : null, baselineItemCount: baselineItems };
    result.checks.itemCountRestored = result.after.itemCount === baselineItems;
    result.cleanupComplete = result.checks.itemCountRestored;
    result.ok = result.ok && result.cleanupComplete;
    write(result);
  }
}());
