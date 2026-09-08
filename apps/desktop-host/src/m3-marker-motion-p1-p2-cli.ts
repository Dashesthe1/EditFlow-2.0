import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11, type AeAdapterPublicCommandV11, type AeAdapterResponseV11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_MARKER_MOTION_PROTOCOL_VERSION_V20, type AeMarkerMotionCommandV20, type AeMarkerMotionResponseV20 } from "../../../packages/adapters/ae-cep/src/protocol-v2_0.js";
import { buildMarkerMotionRequestV20 } from "../../../packages/adapters/ae-cep/src/m3-marker-motion.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
import type { AeProjectSnapshot } from "../../../packages/ae-object-model/src/index.js";
import { LoopbackCepBroker } from "./loopback-cep.js";

interface BridgeConfig { readonly schemaVersion: 1; readonly host: "127.0.0.1"; readonly port: number; readonly token: string; readonly protocolVersion: "1.1.0"; readonly supportedProtocolVersions?: readonly string[]; readonly extensionId: string; readonly extensionVersion: string }
interface RecordedResponse { readonly protocolVersion: string; readonly command: string; readonly outcome: string; readonly error: unknown; readonly hostProjectRevision: number | null }
const argument = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const required = (name: string): string => { const value = argument(name); if (!value) throw new Error(`Missing required argument ${name}.`); return value; };
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nested = (value: unknown, key: string): Record<string, unknown> | null => { const parent = record(value); return parent === null ? null : record(parent[key]); };
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const all = (checks: Record<string, boolean>, names: readonly string[]): boolean => names.every((name) => checks[name] === true);
const writeJson = async (file: string, value: unknown): Promise<void> => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); };
const projectHasComp = (project: AeProjectSnapshot | null, stableId: string): boolean => project?.items.some((item) => item.kind === "COMPOSITION" && item.stableId === stableId) ?? false;

const parseConfig = (value: unknown): BridgeConfig => {
  const c = record(value);
  if (c === null || c["schemaVersion"] !== 1 || c["host"] !== "127.0.0.1" || !Number.isInteger(c["port"]) || typeof c["token"] !== "string" || c["token"].length < 32) throw new Error("Invalid bridge config.");
  const supported = c["supportedProtocolVersions"];
  if (!Array.isArray(supported) || !supported.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) throw new Error("Bridge config does not advertise protocols 2.0 and 1.1.");
  return c as unknown as BridgeConfig;
};

const main = async (): Promise<void> => {
  const configPath = required("--config"), resultPath = required("--result"), timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("--timeout-ms must be at least 10000.");
  const startedAt = new Date().toISOString(), artifactDir = path.dirname(resultPath);
  const checks: Record<string, boolean> = {}, responses: RecordedResponse[] = [], evidence: Record<string, unknown>[] = [], cleanupErrors: string[] = [];
  let failureError: string | null = null, cleanupComplete = false, broker: LoopbackCepBroker | null = null, client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null, project: AeProjectSnapshot | null = null, revision: number | null = null, baselineFingerprint: string | null = null, baselineItemCount: number | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null, environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  const prefix = `M3_MARKER_MOTION_P12_${Date.now()}`, transactionId = `${prefix}_TX`, sourceStable = `${prefix}_SOURCE`, targetStable = `${prefix}_TARGET`, layerStable = `${prefix}_LAYER`, projectId = "m3-marker-motion-p1-p2-real-ae";
  let operation = 0, request = 0;

  const refresh = async (): Promise<void> => { if (!client) throw new Error("Setup client unavailable."); const observed = await client.observe(projectId); state = observed.observed; project = observed.project; revision = observed.hostRevision; };
  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>): Promise<AeAdapterResponseV11> => {
    if (!client || !state) throw new Error("Setup client unavailable.");
    const response = await client.executePublic(command, { transactionId, operationId: `${transactionId}_V11_${++operation}`, payload, expectedState: state, readbackProfile: "M3_MARKER_MOTION_P1_P2_SETUP" });
    responses.push({ protocolVersion: response.protocolVersion, command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision });
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command}: ${response.error?.code ?? response.outcome}`);
    await refresh(); return response;
  };
  const dispatch = async (command: AeMarkerMotionCommandV20, payload: Readonly<Record<string, unknown>>, expectedRevision: number | null): Promise<AeMarkerMotionResponseV20> => {
    if (!broker) throw new Error("Broker unavailable.");
    const response = await broker.dispatch(buildMarkerMotionRequestV20({ requestId: `m3-marker-motion-${++request}`, transactionId, operationId: `${transactionId}_V20_${++operation}`, command, expectedHostProjectRevision: expectedRevision, payload, readbackProfile: "M3_MARKER_MOTION_P1_P2_STRUCTURAL" }));
    responses.push({ protocolVersion: response.protocolVersion, command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision });
    if (typeof response.hostProjectRevision === "number") revision = response.hostProjectRevision;
    return response;
  };
  const rejectWithoutMutation = async (name: string, action: () => Promise<AeMarkerMotionResponseV20>, code: string): Promise<void> => {
    if (!client) throw new Error("Setup client unavailable."); const before = await client.observe(projectId); const response = await action(); const after = await client.observe(projectId);
    state = after.observed; project = after.project; revision = after.hostRevision;
    checks[`${name}_rejected`] = response.outcome === "REJECTED" && response.error?.code === code;
    checks[`${name}_revision_unchanged`] = response.hostProjectRevision === before.hostRevision && after.hostRevision === before.hostRevision;
    checks[`${name}_fingerprint_unchanged`] = after.observed.projectFingerprint === before.observed.projectFingerprint;
  };
  const cleanupComp = async (stableId: string): Promise<void> => { try { if (client) { await refresh(); if (projectHasComp(project, stableId)) await executeV11("comp.remove", { comp: { stableId } }); } } catch (error) { cleanupErrors.push(`${stableId}: ${error instanceof Error ? error.message : String(error)}`); } };

  try {
    const config = parseConfig(JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, "")) as unknown);
    broker = new LoopbackCepBroker({ port: config.port, token: config.token, commandTimeoutMs: Math.min(timeoutMs, 30_000), commandLeaseMs: 2_000, expectedExtensionId: config.extensionId, supportedProtocolVersions: [AE_MARKER_MOTION_PROTOCOL_VERSION_V20, AE_ADAPTER_PROTOCOL_VERSION_V11] });
    if (await broker.start() !== config.port) throw new Error("CEP broker bound unexpected port.");
    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v20 = panel.protocolVersion === AE_MARKER_MOTION_PROTOCOL_VERSION_V20;
    checks.panel_supports_v11_v20 = panel.supportedProtocolVersions.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v20 || !checks.panel_supports_v11_v20) throw new Error("Protocol 2.0 negotiation failed.");
    client = new AeCepAdapterClientV11(broker, () => `m3-marker-motion-setup-${++request}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe(); checks.host_probe = environment.hostName === "Adobe After Effects";
    const baseline = await client.observe(projectId); state = baseline.observed; project = baseline.project; revision = baseline.hostRevision; baselineFingerprint = state.projectFingerprint; baselineItemCount = project.itemCount;
    await executeV11("comp.create", { stableId: sourceStable, name: `${prefix} Source`, width: 320, height: 180, pixelAspect: 1, duration: 2, frameRate: 24 });
    await executeV11("comp.create", { stableId: targetStable, name: `${prefix} Target`, width: 640, height: 360, pixelAspect: 1, duration: 2, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: layerStable, comp: { stableId: targetStable }, item: { stableId: sourceStable } });

    await rejectWithoutMutation("p1_stale_revision", () => dispatch("comp.motion.set", { comp: { stableId: targetStable }, state: { motionBlur: true, frameBlending: true, shutterAngle: 270, shutterPhase: -90, samplesPerFrame: 32, adaptiveSampleLimit: 128 } }, (revision ?? 0) + 1000), "HOST_REVISION_CONFLICT");
    await rejectWithoutMutation("p1_shutter_angle", () => dispatch("comp.motion.set", { comp: { stableId: targetStable }, state: { motionBlur: true, frameBlending: true, shutterAngle: 721, shutterPhase: 0, samplesPerFrame: 16, adaptiveSampleLimit: 128 } }, revision), "SHUTTER_ANGLE_INVALID");
    await rejectWithoutMutation("p1_layer_protected_region", () => dispatch("marker.set", { target: { kind: "LAYER", comp: { stableId: targetStable }, layer: { stableId: layerStable } }, time: 0.5, marker: { comment: "invalid", protectedRegion: true } }, revision), "LAYER_PROTECTED_REGION_FORBIDDEN");
    await rejectWithoutMutation("p1_bad_frame_blending", () => dispatch("layer.motion.set", { comp: { stableId: targetStable }, layer: { stableId: layerStable }, state: { motionBlur: true, frameBlendingType: "OPTICAL_FLOW" } }, revision), "FRAME_BLENDING_TYPE_INVALID");

    const compMotion = { motionBlur: true, frameBlending: true, shutterAngle: 270, shutterPhase: -90, samplesPerFrame: 32, adaptiveSampleLimit: 128 };
    const compSet = await dispatch("comp.motion.set", { comp: { stableId: targetStable }, state: compMotion }, revision);
    const compRead = await dispatch("comp.motion.readback", { comp: { stableId: targetStable } }, null);
    const compObserved = nested(nested(compRead.readback, "compMotion"), "state");
    checks.p2_comp_motion_exact = compSet.outcome === "APPLIED" && compRead.outcome === "NO_OP" && equal(compObserved, compMotion);
    const compRepeat = await dispatch("comp.motion.set", { comp: { stableId: targetStable }, state: compMotion }, revision);
    checks.p2_comp_motion_idempotent = compRepeat.outcome === "NO_OP";
    evidence.push({ kind: "compMotion", requested: compMotion, observed: compObserved });

    const layerMotion = { motionBlur: true, frameBlendingType: "PIXEL_MOTION" };
    const layerSet = await dispatch("layer.motion.set", { comp: { stableId: targetStable }, layer: { stableId: layerStable }, state: layerMotion }, revision);
    const layerRead = await dispatch("layer.motion.readback", { comp: { stableId: targetStable }, layer: { stableId: layerStable } }, null);
    const layerObserved = nested(nested(layerRead.readback, "layerMotion"), "state");
    checks.p2_layer_motion_exact = layerSet.outcome === "APPLIED" && layerRead.outcome === "NO_OP" && layerObserved?.["motionBlur"] === true && layerObserved?.["frameBlendingType"] === "PIXEL_MOTION" && layerObserved?.["frameBlending"] === true;
    const layerRepeat = await dispatch("layer.motion.set", { comp: { stableId: targetStable }, layer: { stableId: layerStable }, state: layerMotion }, revision);
    checks.p2_layer_motion_idempotent = layerRepeat.outcome === "NO_OP";
    evidence.push({ kind: "layerMotion", requested: layerMotion, observed: layerObserved });

    const compMarker = { comment: "Impact", chapter: "Climax", url: "https://example.invalid/editflow", frameTarget: "hero", cuePointName: "impact", duration: 0.25, eventCuePoint: true, label: 9, protectedRegion: true, parameters: { role: "accent", intensity: "high" } };
    const compTarget = { kind: "COMP", comp: { stableId: targetStable } };
    const compMarkerSet = await dispatch("marker.set", { target: compTarget, time: 0.5, marker: compMarker }, revision);
    const compMarkerRepeat = await dispatch("marker.set", { target: compTarget, time: 0.5, marker: compMarker }, revision);
    const compMarkerRead = await dispatch("marker.readback", { target: compTarget }, null);
    const compMarkers = record(compMarkerRead.readback)?.["markers"] as unknown[] | undefined;
    const compEntry = Array.isArray(compMarkers) ? record(compMarkers[0]) : null;
    checks.p2_comp_marker_exact = compMarkerSet.outcome === "APPLIED" && compMarkers?.length === 1 && compEntry?.["time"] === 0.5 && equal(compEntry?.["marker"], compMarker);
    checks.p2_comp_marker_idempotent = compMarkerRepeat.outcome === "NO_OP" && compMarkers?.length === 1;
    evidence.push({ kind: "compMarker", requested: compMarker, observed: compEntry });

    const layerMarker = { comment: "Layer cue", duration: 0, eventCuePoint: false, label: 3, protectedRegion: false, parameters: { owner: "EditFlow" } };
    const layerTarget = { kind: "LAYER", comp: { stableId: targetStable }, layer: { stableId: layerStable } };
    const layerMarkerSet = await dispatch("marker.set", { target: layerTarget, time: 1.25, marker: layerMarker }, revision);
    const layerMarkerRead = await dispatch("marker.readback", { target: layerTarget }, null);
    const layerMarkers = record(layerMarkerRead.readback)?.["markers"] as unknown[] | undefined;
    const layerEntry = Array.isArray(layerMarkers) ? record(layerMarkers[0]) : null;
    checks.p2_layer_marker_exact = layerMarkerSet.outcome === "APPLIED" && layerMarkers?.length === 1 && layerEntry?.["time"] === 1.25 && equal(layerEntry?.["marker"], { comment: "Layer cue", chapter: "", url: "", frameTarget: "", cuePointName: "", duration: 0, eventCuePoint: false, label: 3, protectedRegion: false, parameters: { owner: "EditFlow" } });
    const layerRemove = await dispatch("marker.remove", { target: layerTarget, keyIndex: 1 }, revision);
    checks.p2_layer_marker_remove_exact = layerRemove.outcome === "APPLIED" && (record(layerRemove.readback)?.["markers"] as unknown[] | undefined)?.length === 0;
    const compRemove = await dispatch("marker.remove", { target: compTarget, keyIndex: 1 }, revision);
    checks.p2_comp_marker_remove_exact = compRemove.outcome === "APPLIED" && (record(compRemove.readback)?.["markers"] as unknown[] | undefined)?.length === 0;

    checks.p1 = all(checks, ["p1_stale_revision_rejected", "p1_stale_revision_revision_unchanged", "p1_stale_revision_fingerprint_unchanged", "p1_shutter_angle_rejected", "p1_shutter_angle_revision_unchanged", "p1_shutter_angle_fingerprint_unchanged", "p1_layer_protected_region_rejected", "p1_layer_protected_region_revision_unchanged", "p1_layer_protected_region_fingerprint_unchanged", "p1_bad_frame_blending_rejected", "p1_bad_frame_blending_revision_unchanged", "p1_bad_frame_blending_fingerprint_unchanged"]);
    checks.p2 = all(checks, ["p2_comp_motion_exact", "p2_comp_motion_idempotent", "p2_layer_motion_exact", "p2_layer_motion_idempotent", "p2_comp_marker_exact", "p2_comp_marker_idempotent", "p2_layer_marker_exact", "p2_layer_marker_remove_exact", "p2_comp_marker_remove_exact"]);
  } catch (error) { failureError = error instanceof Error ? error.stack ?? error.message : String(error); }
  finally {
    await cleanupComp(targetStable); await cleanupComp(sourceStable);
    try { if (client) { await refresh(); checks.cleanup_item_count_restored = baselineItemCount !== null && project?.itemCount === baselineItemCount; checks.cleanup_fingerprint_restored = baselineFingerprint !== null && state?.projectFingerprint === baselineFingerprint; } } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
    cleanupComplete = cleanupErrors.length === 0 && checks.cleanup_item_count_restored === true && checks.cleanup_fingerprint_restored === true;
    if (broker) await broker.stop();
    const ok = failureError === null && cleanupComplete && checks.p1 === true && checks.p2 === true;
    await writeJson(resultPath, { proofId: "M3_MARKER_MOTION_P1_P2_REAL_AE", status: ok ? "PASS" : "FAILURE", ok, startedAt, completedAt: new Date().toISOString(), cleanupComplete, proofLevels: { P1_validation_rejection: checks.p1 === true, P2_structural_readback: checks.p2 === true, P3_visual_proof: false, P4_failure_injection_rollback: false, P5_save_reopen_reconnect_transfer: false }, panel, environment, fixture: { sourceStable, targetStable, layerStable }, checks, evidence, responses, failureError, cleanupErrors });
    if (!ok) process.exitCode = 1;
  }
};
void main().catch((error) => { console.error(error); process.exitCode = 1; });
