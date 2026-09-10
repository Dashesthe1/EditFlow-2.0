import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_MARKER_MOTION_PROTOCOL_VERSION_V20 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_0.js";
import { buildMarkerMotionRequestV20 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-marker-motion.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const required = (name) => {
  const value = arg(name);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
};
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const nested = (value, key) => {
  const parent = record(value);
  return parent ? record(parent[key]) : null;
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonical(object[key])]));
};
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const stripBom = (value) => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const existsNonEmpty = async (filePath) => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};
const writeJson = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const markersFrom = (response) => {
  const readback = record(response?.readback);
  return Array.isArray(readback?.markers) ? readback.markers : [];
};
const compStateFrom = (response) => nested(nested(response?.readback, "compMotion"), "state");
const layerStateFrom = (response) => nested(nested(response?.readback, "layerMotion"), "state");
const projectHasStableItem = (project, stableId) => project?.items?.some((item) => item.stableId === stableId) ?? false;

const parseConfig = (value) => {
  const candidate = record(value);
  if (!candidate || candidate.schemaVersion !== 1 || candidate.host !== "127.0.0.1") throw new Error("Bridge config schema/host is invalid.");
  if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535) throw new Error("Bridge port is invalid.");
  if (typeof candidate.token !== "string" || candidate.token.length < 32) throw new Error("Bridge token is invalid.");
  if (candidate.protocolVersion !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("Bridge legacy protocol mismatch.");
  if (!Array.isArray(candidate.supportedProtocolVersions)
      || !candidate.supportedProtocolVersions.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20)
      || !candidate.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("Bridge config does not advertise protocol 2.0 plus 1.1 compatibility.");
  }
  if (typeof candidate.extensionId !== "string" || !candidate.extensionId || typeof candidate.extensionVersion !== "string" || !candidate.extensionVersion) {
    throw new Error("Bridge extension identity is invalid.");
  }
  return candidate;
};

const parseAccepted = (value) => {
  const candidate = record(value);
  const levels = record(candidate?.proofLevels);
  if (!candidate
      || candidate.proofId !== "M3_MARKER_MOTION_P1_P2_REAL_AE"
      || candidate.status !== "PASS"
      || candidate.ok !== true
      || candidate.cleanupComplete !== true
      || !levels
      || levels.P1_validation_rejection !== true
      || levels.P2_structural_readback !== true
      || levels.P3_visual_proof !== false
      || levels.P4_failure_injection_rollback !== false
      || levels.P5_save_reopen_reconnect_transfer !== false) {
    throw new Error("Accepted marker-motion P1/P2 artifact contract is invalid.");
  }
  return candidate;
};

const createBmp24 = (width, height, pixel) => {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const buffer = Buffer.alloc(54 + pixelBytes, 0);
  buffer.write("BM", 0, 2, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelBytes, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = 54 + (height - 1 - y) * rowStride;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      const offset = rowOffset + x * 3;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
    }
  }
  return buffer;
};

const parseCompletion = (value) => {
  const candidate = record(value);
  if (!candidate || candidate.schemaVersion !== 1 || typeof candidate.jobId !== "string") throw new Error("Render completion marker is invalid.");
  if (candidate.status !== "DONE" && candidate.status !== "FAILED") throw new Error("Render completion status is invalid.");
  return candidate;
};

const waitForCompletion = async (completionPath, expectedJobId, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const completion = parseCompletion(JSON.parse(stripBom(await readFile(completionPath, "utf8"))));
      if (completion.jobId === expectedJobId) return completion;
      lastError = `stale completion ${completion.jobId}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  throw new Error(`RENDER_JOB_COMPLETION_TIMEOUT: ${expectedJobId}${lastError ? ` (${lastError})` : ""}`);
};

const main = async () => {
  const configPath = required("--config");
  const resultPath = required("--result");
  const acceptedPath = required("--accepted-p1-p2");
  const brokerReadyPath = arg("--broker-ready");
  const timeoutMs = Number(arg("--timeout-ms") ?? "90000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const artifactDir = path.dirname(resultPath);
  await mkdir(artifactDir, { recursive: true });
  const progressPath = path.join(artifactDir, "progress.jsonl");
  await writeFile(progressPath, "", "utf8");
  const progress = async (stage, details = {}) => {
    try {
      await appendFile(progressPath, `${JSON.stringify({ at: new Date().toISOString(), elapsedMs: Date.now() - startedAtMs, stage, ...details })}\n`, "utf8");
    } catch {}
  };

  const motionSourcePath = path.join(artifactDir, "p3-motion-source.bmp");
  const sequenceStartPath = path.join(artifactDir, "p3-sequence-0001.bmp");
  const motionNoBlurPath = path.join(artifactDir, "p3-motion-no-blur.avi");
  const motionShutter30Path = path.join(artifactDir, "p3-motion-shutter-30.avi");
  const motionShutter360Path = path.join(artifactDir, "p3-motion-shutter-360.avi");
  const frameMixPath = path.join(artifactDir, "p3-frame-mix.avi");
  const pixelMotionPath = path.join(artifactDir, "p3-pixel-motion.avi");
  const recoveryPath = path.join(artifactDir, "p4-recovery-baseline.avi");

  const checks = {};
  const responses = [];
  const p4Matrix = {};
  const cleanupErrors = [];
  let failureError = null;
  let classificationHint = "PRODUCT_FAILURE";
  let broker = null;
  let client = null;
  let state = null;
  let hostRevision = null;
  let baselineFingerprint = null;
  let baselineItemCount = null;
  let cleanupUndoCount = 0;
  let mutationStarted = false;
  let acceptedSha256 = null;
  let panel = null;
  let environment = null;

  const projectId = "m3-marker-motion-p3-p4-fast";
  const prefix = `M3_MARKER_MOTION_FAST_${Date.now()}`;
  await progress("proof.start", { prefix, timeoutMs });
  const transactionId = `${prefix}_TX`;
  const motionSourceStable = `${prefix}_MOTION_SOURCE`;
  const sequenceSourceStable = `${prefix}_SEQUENCE_SOURCE`;
  const motionCompStable = `${prefix}_MOTION_COMP`;
  const blendCompStable = `${prefix}_BLEND_COMP`;
  const motionLayerStable = `${prefix}_MOTION_LAYER`;
  const blendLayerStable = `${prefix}_BLEND_LAYER`;
  const temporaryItems = new Set([motionSourceStable, sequenceSourceStable, motionCompStable, blendCompStable]);
  let operationCounter = 0;
  let requestCounter = 0;

  const recordResponse = (response) => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error ?? null,
      hostProjectRevision: response.hostProjectRevision ?? null,
      notes: response.diagnostics?.notes ?? [],
    });
  };

  const refresh = async () => {
    if (!client) throw new Error("Setup client unavailable.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    return observed;
  };

  const executeV11 = async (command, payload, refreshAfter = true) => {
    if (!client || !state) throw new Error("Setup client unavailable.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_MARKER_MOTION_FAST_P3_P4",
    });
    recordResponse(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command}: ${response.error?.code ?? response.outcome}`);
    if (response.outcome === "APPLIED") mutationStarted = true;
    if (refreshAfter) await refresh();
    return response;
  };

  const dispatchV20 = async (command, payload, expectedRevision, readbackProfile = "M3_MARKER_MOTION_FAST_STRUCTURAL") => {
    if (!broker) throw new Error("Broker unavailable.");
    const response = await broker.dispatch(buildMarkerMotionRequestV20({
      requestId: `m3-marker-motion-fast-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V20_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordResponse(response);
    if (response.outcome === "APPLIED") mutationStarted = true;
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const readComp = async (stableId) => {
    const response = await dispatchV20("comp.motion.readback", { comp: { stableId } }, null);
    if (response.outcome !== "NO_OP") throw new Error(`comp.motion.readback failed: ${response.error?.code ?? response.outcome}`);
    return { response, state: compStateFrom(response) };
  };

  const readLayer = async (compStableId, layerStableId) => {
    const response = await dispatchV20("layer.motion.readback", { comp: { stableId: compStableId }, layer: { stableId: layerStableId } }, null);
    if (response.outcome !== "NO_OP") throw new Error(`layer.motion.readback failed: ${response.error?.code ?? response.outcome}`);
    return { response, state: layerStateFrom(response) };
  };

  const readMarkers = async (target) => {
    const response = await dispatchV20("marker.readback", { target }, null);
    if (response.outcome !== "NO_OP") throw new Error(`marker.readback failed: ${response.error?.code ?? response.outcome}`);
    return { response, markers: markersFrom(response) };
  };

  const setCompExact = async (stableId, requested) => {
    const response = await dispatchV20("comp.motion.set", { comp: { stableId }, state: requested }, hostRevision);
    if (response.outcome !== "APPLIED" && response.outcome !== "NO_OP") throw new Error(`comp.motion.set failed: ${response.error?.code ?? response.outcome}`);
    await refresh();
    const readback = await readComp(stableId);
    if (!equal(readback.state, requested)) throw new Error("Composition motion exact readback mismatch.");
  };

  const setLayerExact = async (compStableId, layerStableId, requested) => {
    const response = await dispatchV20("layer.motion.set", { comp: { stableId: compStableId }, layer: { stableId: layerStableId }, state: requested }, hostRevision);
    if (response.outcome !== "APPLIED" && response.outcome !== "NO_OP") throw new Error(`layer.motion.set failed: ${response.error?.code ?? response.outcome}`);
    await refresh();
    const readback = await readLayer(compStableId, layerStableId);
    if (readback.state?.motionBlur !== requested.motionBlur || readback.state?.frameBlendingType !== requested.frameBlendingType) throw new Error("Layer motion exact readback mismatch.");
  };

  const renderComp = async (compStableId, outputPath) => {
    const scheduled = await executeV11("render.capture", {
      comp: { stableId: compStableId },
      outputPath,
      timeSpanStart: 0,
      timeSpanDuration: 0.5,
    }, false);
    const readback = record(scheduled.readback);
    const jobId = readback?.jobId;
    const completionPath = readback?.completionPath;
    if (typeof jobId !== "string" || typeof completionPath !== "string") throw new Error("render.capture did not return its async completion contract.");
    const completion = await waitForCompletion(completionPath, jobId, Math.min(timeoutMs, 45_000));
    if (completion.ok !== true || completion.status !== "DONE" || completion.queueItemRemoved !== true || !(await existsNonEmpty(completion.outputPath))) {
      throw new Error(`Render ${jobId} failed or emitted no output: ${completion.error ?? completion.status}`);
    }
    await refresh();
    return completion;
  };

  const restoreWarmBaseline = async () => {
    if (!client || baselineFingerprint === null || baselineItemCount === null) return;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await client.observe(projectId);
      state = current.observed;
      hostRevision = current.hostRevision;
      if (current.observed.projectFingerprint === baselineFingerprint && current.project.itemCount === baselineItemCount) return;
      const response = await client.undoLast({
        transactionId,
        operationId: `${transactionId}_CLEANUP_${attempt + 1}`,
        expectedState: current.observed,
      });
      recordResponse(response);
      cleanupUndoCount += 1;
      if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`Cleanup undo failed: ${response.error?.code ?? response.outcome}`);
    }
    throw new Error("Cleanup undo budget exhausted before exact warm baseline restoration.");
  };

  const runP4 = async ({ name, command, payload, readback, project }) => {
    await progress(`p4.${name}.start`, { command });
    const beforeProject = await refresh();
    await progress(`p4.${name}.before_project`, { hostRevision: beforeProject.hostRevision });
    const beforeValue = await readback();
    await progress(`p4.${name}.before_readback`);
    const induced = await dispatchV20(command, payload(), beforeProject.hostRevision, "M3_MARKER_MOTION_P4_FAILURE_INJECTION");
    await progress(`p4.${name}.dispatch_returned`, { outcome: induced.outcome, errorCategory: induced.error?.category ?? null, errorCode: induced.error?.code ?? null });
    const notes = induced.diagnostics?.notes ?? [];
    const gateActive = induced.outcome === "FAILED"
      && induced.error?.category === "PROOF_INJECTION"
      && induced.error?.code === "M3_MARKER_MOTION_P4_INDUCED_FAILURE";
    if (!gateActive && induced.outcome === "APPLIED") classificationHint = "INFRASTRUCTURE_FAILURE";
    const responseValue = project(induced);
    const afterProject = await refresh();
    await progress(`p4.${name}.after_project`, { hostRevision: afterProject.hostRevision });
    const afterValue = await readback();
    const result = {
      inducedFailure: gateActive,
      rollbackNote: notes.some((note) => String(note).includes("rolled back through the transaction undo boundary")),
      responseReadbackRestored: equal(responseValue, beforeValue),
      structuralReadbackRestored: equal(afterValue, beforeValue),
      fingerprintRestored: afterProject.observed.projectFingerprint === beforeProject.observed.projectFingerprint,
      itemCountRestored: afterProject.project.itemCount === beforeProject.project.itemCount,
    };
    result.ok = Object.values(result).every((value) => value === true);
    p4Matrix[name] = result;
    await progress(`p4.${name}.complete`, result);
    if (!result.ok) throw new Error(`P4 ${name} rollback matrix failed: ${JSON.stringify(result)}`);
  };

  try {
    const acceptedBytes = await readFile(acceptedPath);
    const accepted = parseAccepted(JSON.parse(stripBom(acceptedBytes.toString("utf8"))));
    acceptedSha256 = createHash("sha256").update(acceptedBytes).digest("hex");
    checks.accepted_p1_p2 = accepted.ok === true;

    classificationHint = "INFRASTRUCTURE_FAILURE";
    const config = parseConfig(JSON.parse(stripBom(await readFile(configPath, "utf8"))));
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 8_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_MARKER_MOTION_PROTOCOL_VERSION_V20, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    if (await broker.start() !== config.port) throw new Error("CEP broker bound an unexpected port.");
    if (brokerReadyPath) {
      await writeJson(brokerReadyPath, {
        schemaVersion: 1,
        state: "LISTENING",
        port: config.port,
        readyAt: new Date().toISOString(),
      });
    }
    panel = await broker.waitForPanel(Math.min(timeoutMs, 10_000));
    checks.panel_v20 = panel.protocolVersion === AE_MARKER_MOTION_PROTOCOL_VERSION_V20;
    checks.panel_compat_v11 = panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_v20 || !checks.panel_compat_v11) throw new Error("Protocol 2.0 panel negotiation failed.");

    client = new AeCepAdapterClientV11(broker, () => `m3-marker-motion-fast-v11-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects";
    if (!checks.host_probe) throw new Error("Real After Effects host probe failed.");
    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;
    await writeJson(path.join(artifactDir, "warm-baseline.json"), { schemaVersion: 1, prefix, projectFingerprint: baselineFingerprint, itemCount: baselineItemCount, capturedAt: new Date().toISOString() });
    await progress("baseline.captured", { itemCount: baselineItemCount, projectFingerprint: baselineFingerprint });
    classificationHint = "PRODUCT_FAILURE";

    await writeFile(motionSourcePath, createBmp24(48, 48, (x, y) => {
      const cross = Math.abs(x - 24) <= 5 || Math.abs(y - 24) <= 5;
      return cross ? [248, 248, 248] : [18, 34, 82];
    }));
    for (let index = 0; index < 6; index += 1) {
      const framePath = path.join(artifactDir, `p3-sequence-${String(index + 1).padStart(4, "0")}.bmp`);
      const squareX = 5 + index * 11;
      await writeFile(framePath, createBmp24(96, 96, (x, y) => {
        const square = x >= squareX && x < squareX + 22 && y >= 34 && y < 56;
        const guide = y >= 72 && y < 75;
        return square ? [245, 245, 245] : (guide ? [48, 128, 240] : [8, 8, 16]);
      }));
    }
    checks.fixture_files = await existsNonEmpty(motionSourcePath) && await existsNonEmpty(sequenceStartPath);

    await executeV11("media.import", { path: motionSourcePath, stableId: motionSourceStable, sequence: false });
    await executeV11("media.import", { path: sequenceStartPath, stableId: sequenceSourceStable, sequence: true });
    await executeV11("comp.create", { stableId: motionCompStable, name: `${prefix} Motion`, width: 320, height: 180, pixelAspect: 1, duration: 0.5, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: motionLayerStable, comp: { stableId: motionCompStable }, item: { stableId: motionSourceStable }, duration: 0.5 });
    await executeV11("property.set_keyframes", {
      comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable }, propertyPath: ["ADBE Transform Group", "ADBE Position"],
      keyframes: [{ time: 0, value: [40, 90] }, { time: 0.5, value: [280, 90] }],
    });
    await executeV11("comp.create", { stableId: blendCompStable, name: `${prefix} Frame Blend`, width: 320, height: 180, pixelAspect: 1, duration: 0.5, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: blendLayerStable, comp: { stableId: blendCompStable }, item: { stableId: sequenceSourceStable } });
    await executeV11("layer.set_timing", { comp: { stableId: blendCompStable }, layer: { stableId: blendLayerStable }, timing: { stretch: 300 } });
    await executeV11("layer.set_transform", { comp: { stableId: blendCompStable }, layer: { stableId: blendLayerStable }, values: { position: [160, 90], scale: [180, 180] } });
    checks.fixture_created = true;

    const nativeMotionComp = (await readComp(motionCompStable)).state;
    const nativeMotionLayer = (await readLayer(motionCompStable, motionLayerStable)).state;
    const nativeBlendComp = (await readComp(blendCompStable)).state;
    const nativeBlendLayer = (await readLayer(blendCompStable, blendLayerStable)).state;
    if (!nativeMotionComp || !nativeMotionLayer || !nativeBlendComp || !nativeBlendLayer) throw new Error("Native motion baselines are unavailable.");

    const compMarker = {
      comment: "P3 impact", chapter: "Motion proof", url: "", frameTarget: "midpoint", cuePointName: "impact",
      duration: 0.125, eventCuePoint: true, label: 9, protectedRegion: true,
      parameters: { role: "visual-proof", surface: "composition" },
    };
    const layerMarker = {
      comment: "P3 layer cue", chapter: "Motion proof", url: "", frameTarget: "moving-layer", cuePointName: "cue",
      duration: 0, eventCuePoint: false, label: 3, protectedRegion: false,
      parameters: { role: "visual-proof", surface: "layer" },
    };
    const compMarkerTarget = { kind: "COMP", comp: { stableId: motionCompStable } };
    const layerMarkerTarget = { kind: "LAYER", comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable } };
    let markerResponse = await dispatchV20("marker.set", { target: compMarkerTarget, time: 0.25, marker: compMarker }, hostRevision);
    if (markerResponse.outcome !== "APPLIED" && markerResponse.outcome !== "NO_OP") throw new Error(`Composition marker fixture failed: ${markerResponse.error?.code ?? markerResponse.outcome}`);
    await refresh();
    markerResponse = await dispatchV20("marker.set", { target: layerMarkerTarget, time: 0.125, marker: layerMarker }, hostRevision);
    if (markerResponse.outcome !== "APPLIED" && markerResponse.outcome !== "NO_OP") throw new Error(`Layer marker fixture failed: ${markerResponse.error?.code ?? markerResponse.outcome}`);
    await refresh();
    const compMarkers = (await readMarkers(compMarkerTarget)).markers;
    const layerMarkers = (await readMarkers(layerMarkerTarget)).markers;
    checks.p3_comp_marker_structural = compMarkers.length === 1 && compMarkers[0]?.time === 0.25 && equal(compMarkers[0]?.marker, compMarker);
    checks.p3_layer_marker_structural = layerMarkers.length === 1 && layerMarkers[0]?.time === 0.125 && equal(layerMarkers[0]?.marker, layerMarker);

    const motionNoBlur = { ...nativeMotionComp, motionBlur: false, frameBlending: false };
    const motionLayerNoBlur = { motionBlur: false, frameBlendingType: "NO_FRAME_BLEND" };
    await setLayerExact(motionCompStable, motionLayerStable, motionLayerNoBlur);
    await setCompExact(motionCompStable, motionNoBlur);
    checks.p3_motion_no_blur = await existsNonEmpty((await renderComp(motionCompStable, motionNoBlurPath)).outputPath);

    const blurLayer = { motionBlur: true, frameBlendingType: "NO_FRAME_BLEND" };
    const narrow = { ...motionNoBlur, motionBlur: true, shutterAngle: 30, shutterPhase: -15, samplesPerFrame: 32, adaptiveSampleLimit: 128 };
    const wide = { ...narrow, shutterAngle: 360, shutterPhase: -180 };
    await setLayerExact(motionCompStable, motionLayerStable, blurLayer);
    await setCompExact(motionCompStable, narrow);
    checks.p3_motion_shutter_30 = await existsNonEmpty((await renderComp(motionCompStable, motionShutter30Path)).outputPath);
    await setCompExact(motionCompStable, wide);
    checks.p3_motion_shutter_360 = await existsNonEmpty((await renderComp(motionCompStable, motionShutter360Path)).outputPath);
    await setCompExact(motionCompStable, nativeMotionComp);
    await setLayerExact(motionCompStable, motionLayerStable, { motionBlur: nativeMotionLayer.motionBlur, frameBlendingType: nativeMotionLayer.frameBlendingType });

    const blendCompEnabled = { ...nativeBlendComp, motionBlur: false, frameBlending: true };
    await setCompExact(blendCompStable, blendCompEnabled);
    await setLayerExact(blendCompStable, blendLayerStable, { motionBlur: false, frameBlendingType: "FRAME_MIX" });
    checks.p3_frame_mix = await existsNonEmpty((await renderComp(blendCompStable, frameMixPath)).outputPath);
    await setLayerExact(blendCompStable, blendLayerStable, { motionBlur: false, frameBlendingType: "PIXEL_MOTION" });
    checks.p3_pixel_motion = await existsNonEmpty((await renderComp(blendCompStable, pixelMotionPath)).outputPath);
    await setLayerExact(blendCompStable, blendLayerStable, { motionBlur: nativeBlendLayer.motionBlur, frameBlendingType: nativeBlendLayer.frameBlendingType });
    await setCompExact(blendCompStable, nativeBlendComp);
    checks.p3_visual_artifact_emitted = ["p3_motion_no_blur", "p3_motion_shutter_30", "p3_motion_shutter_360", "p3_frame_mix", "p3_pixel_motion"].every((key) => checks[key] === true);
    await progress("p3.render_set.complete", { ok: checks.p3_visual_artifact_emitted });

    const compContrast = {
      ...nativeMotionComp,
      motionBlur: !nativeMotionComp.motionBlur,
      frameBlending: !nativeMotionComp.frameBlending,
      shutterAngle: nativeMotionComp.shutterAngle === 720 ? 180 : 720,
      shutterPhase: nativeMotionComp.shutterPhase === -360 ? 0 : -360,
      samplesPerFrame: nativeMotionComp.samplesPerFrame === 64 ? 16 : 64,
      adaptiveSampleLimit: nativeMotionComp.adaptiveSampleLimit === 256 ? 128 : 256,
    };
    const layerContrast = {
      motionBlur: !nativeMotionLayer.motionBlur,
      frameBlendingType: nativeMotionLayer.frameBlendingType === "PIXEL_MOTION" ? "FRAME_MIX" : "PIXEL_MOTION",
    };

    await runP4({
      name: "comp_motion_set",
      command: "comp.motion.set",
      payload: () => ({ comp: { stableId: motionCompStable }, state: compContrast }),
      readback: async () => (await readComp(motionCompStable)).state,
      project: compStateFrom,
    });
    await runP4({
      name: "layer_motion_set",
      command: "layer.motion.set",
      payload: () => ({ comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable }, state: layerContrast }),
      readback: async () => (await readLayer(motionCompStable, motionLayerStable)).state,
      project: layerStateFrom,
    });

    const injectedMarker = {
      comment: "P4 transient marker", chapter: "Rollback", url: "", frameTarget: "", cuePointName: "proof",
      duration: 0, eventCuePoint: false, label: 6, protectedRegion: false,
      parameters: { role: "rollback-injection" },
    };
    await runP4({
      name: "marker_set",
      command: "marker.set",
      payload: () => ({ target: compMarkerTarget, time: 0.375, marker: injectedMarker }),
      readback: async () => (await readMarkers(compMarkerTarget)).markers,
      project: markersFrom,
    });
    const beforeRemoveMarkers = (await readMarkers(compMarkerTarget)).markers;
    if (beforeRemoveMarkers.length !== 1 || typeof beforeRemoveMarkers[0]?.keyIndex !== "number") throw new Error("P4 marker.remove baseline marker is unavailable.");
    const removeKeyIndex = beforeRemoveMarkers[0].keyIndex;
    await runP4({
      name: "marker_remove",
      command: "marker.remove",
      payload: () => ({ target: compMarkerTarget, keyIndex: removeKeyIndex }),
      readback: async () => (await readMarkers(compMarkerTarget)).markers,
      project: markersFrom,
    });

    checks.p4_all_mutators = Object.values(p4Matrix).length === 4 && Object.values(p4Matrix).every((entry) => entry.ok === true);
    await setCompExact(motionCompStable, nativeMotionComp);
    await setLayerExact(motionCompStable, motionLayerStable, { motionBlur: nativeMotionLayer.motionBlur, frameBlendingType: nativeMotionLayer.frameBlendingType });
    await progress("p4.recovery_render.start");
    checks.p4_recovery_artifact = await existsNonEmpty((await renderComp(motionCompStable, recoveryPath)).outputPath);
    await progress("p4.recovery_render.complete", { ok: checks.p4_recovery_artifact });
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
    await progress("proof.error", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    await progress("cleanup.start", { mutationStarted, cleanupUndoCount });
    let cleanupComplete = false;
    if (client) {
      try {
        await restoreWarmBaseline();
        const finalState = await client.observe(projectId);
        checks.cleanup_temp_items_absent = [...temporaryItems].every((stableId) => !projectHasStableItem(finalState.project, stableId));
        checks.cleanup_item_count_restored = baselineItemCount !== null && finalState.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && finalState.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_temp_items_absent && checks.cleanup_item_count_restored && checks.cleanup_fingerprint_restored;
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      cleanupComplete = !mutationStarted;
    }
    if (broker) {
      try { await broker.stop(); } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (cleanupErrors.length > 0) cleanupComplete = false;
    await progress("cleanup.complete", { cleanupComplete, cleanupUndoCount, cleanupErrors });

    const p3Structural = checks.accepted_p1_p2 === true
      && checks.panel_v20 === true
      && checks.panel_compat_v11 === true
      && checks.host_probe === true
      && checks.fixture_files === true
      && checks.fixture_created === true
      && checks.p3_comp_marker_structural === true
      && checks.p3_layer_marker_structural === true
      && checks.p3_visual_artifact_emitted === true;
    const p4 = checks.p4_all_mutators === true && checks.p4_recovery_artifact === true;
    const ok = failureError === null && cleanupComplete && p3Structural && p4;
    const classification = ok ? "PASS" : classificationHint;
    const elapsedMs = Date.now() - startedAtMs;

    await writeJson(resultPath, {
      proofId: "M3_MARKER_MOTION_P3_P4_REAL_AE",
      classification,
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      message: ok
        ? "Fast warm marker/motion proof emitted bounded P3 visual artifacts, proved P4 rollback across all four mutator families, and restored the exact pre-proof project fingerprint."
        : (failureError ?? (cleanupErrors.join("; ") || "Marker/motion P3/P4 proof failed.")),
      lifecycle: process.env.EDITFLOW_AE_LIFECYCLE ?? null,
      startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs,
      speedTargetMs: 30_000,
      speedTargetMet: elapsedMs <= 30_000,
      visualReviewRequired: ok,
      cleanupComplete,
      cleanupUndoCount,
      acceptedP1P2: { path: acceptedPath, sha256: acceptedSha256 },
      proofLevels: {
        P1_validation_rejection: checks.accepted_p1_p2 === true,
        P2_structural_readback: checks.accepted_p1_p2 === true,
        P3_visual_artifact_emitted: checks.p3_visual_artifact_emitted === true,
        P3_visual_proof: false,
        P4_failure_injection_rollback: p4,
        P5_save_reopen_reconnect_transfer: false,
      },
      p4Matrix,
      panel,
      environment,
      checks,
      artifacts: {
        motionNoBlur: motionNoBlurPath,
        motionShutter30: motionShutter30Path,
        motionShutter360: motionShutter360Path,
        frameMix: frameMixPath,
        pixelMotion: pixelMotionPath,
        postRollback: recoveryPath,
      },
      visualReviewSpec: {
        sampleTimesSeconds: [0.125, 0.25, 0.375],
        expected: [
          "motionShutter30 and motionShutter360 must show viewer-visible motion blur relative to motionNoBlur, with the 360-degree shutter visibly broader at one or more intermediate frames",
          "frameMix and pixelMotion must visibly differ on the deliberately retimed numbered-image footage sequence",
          "postRollback must show the restored native motion baseline after all four proof-gated failure/rollback checks",
          "P3 remains false until retained outputs are independently decoded and visually reviewed",
        ],
      },
      responses,
      failureError,
      cleanupErrors,
    });
    if (!ok) process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
