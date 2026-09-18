import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import type { AeCompositionSnapshot } from "../../../packages/ae-object-model/src/index.js";
import { readTiffGrayFrameV1 } from "../../../packages/point-tracker/src/tiff.js";
import { trackPointV1, type GrayFrameV1, type PointTrackResultV1 } from "../../../packages/point-tracker/src/index.js";
import { LoopbackCepBroker } from "./loopback-cep.js";

interface BridgeConfig {
  readonly schemaVersion: 1;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly protocolVersion: "1.1.0";
  readonly extensionId: string;
  readonly extensionVersion: string;
}

interface TrackingManifest {
  readonly schemaVersion: 1;
  readonly profile: "TRACKING_TIFF_SEQUENCE_V1";
  readonly jobId: string;
  readonly status: "DONE" | "FAILED";
  readonly ok: boolean;
  readonly expectedFrameCount: number;
  readonly framePaths: readonly string[];
  readonly error: string | null;
}

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const required = (name: string): string => {
  const value = argument(name);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
};
const stripBom = (value: string): string => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parseConfig = (value: unknown): BridgeConfig => {
  const v = record(value);
  if (!v || v["schemaVersion"] !== 1 || v["host"] !== "127.0.0.1" || v["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("Bridge config does not match protocol 1.1 loopback requirements.");
  if (!Number.isInteger(v["port"]) || Number(v["port"]) < 1 || Number(v["port"]) > 65535) throw new Error("Bridge config port is invalid.");
  if (typeof v["token"] !== "string" || v["token"].length < 32) throw new Error("Bridge config token is invalid.");
  if (typeof v["extensionId"] !== "string" || typeof v["extensionVersion"] !== "string") throw new Error("Bridge config extension identity is missing.");
  return v as unknown as BridgeConfig;
};

const parseManifest = (value: unknown): TrackingManifest => {
  const v = record(value);
  if (!v || v["schemaVersion"] !== 1 || v["profile"] !== "TRACKING_TIFF_SEQUENCE_V1") throw new Error("Tracking manifest schema/profile mismatch.");
  if (v["status"] !== "DONE" && v["status"] !== "FAILED") throw new Error("Tracking manifest status is invalid.");
  if (typeof v["jobId"] !== "string" || typeof v["ok"] !== "boolean" || !Number.isInteger(v["expectedFrameCount"])) throw new Error("Tracking manifest metadata is invalid.");
  if (!Array.isArray(v["framePaths"]) || !(v["framePaths"] as unknown[]).every((entry) => typeof entry === "string")) throw new Error("Tracking manifest framePaths are invalid.");
  if (v["error"] !== null && typeof v["error"] !== "string") throw new Error("Tracking manifest error is invalid.");
  return v as unknown as TrackingManifest;
};

const waitForTerminalJson = async (filePath: string, timeoutMs: number): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;
  let last = "not created";
  while (Date.now() < deadline) {
    try {
      const value = record(JSON.parse(stripBom(await readFile(filePath, "utf8"))) as unknown);
      if (value && (value["status"] === "DONE" || value["status"] === "FAILED")) return value;
      last = "marker not terminal";
    } catch (error) { last = error instanceof Error ? error.message : String(error); }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${filePath}: ${last}`);
};

const inside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const patchVariance = (frame: GrayFrameV1, x: number, y: number, radius = 3): number => {
  let sum = 0, sumSq = 0, count = 0;
  for (let py = y - radius; py <= y + radius; py += 1) for (let px = x - radius; px <= x + radius; px += 1) {
    const value = frame.data[py * frame.width + px] ?? 0;
    sum += value; sumSq += value * value; count += 1;
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
};

const seedCandidates = (frame: GrayFrameV1): readonly { x: number; y: number }[] => {
  const radius = 4;
  const step = Math.max(4, Math.floor(Math.min(frame.width, frame.height) / 32));
  const ranked: { x: number; y: number; score: number }[] = [];
  for (let y = radius; y < frame.height - radius; y += step) for (let x = radius; x < frame.width - radius; x += step) ranked.push({ x, y, score: patchVariance(frame, x, y) });
  ranked.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const chosen: { x: number; y: number }[] = [];
  for (const candidate of ranked) {
    if (candidate.score <= 1) break;
    if (chosen.every((prior) => Math.hypot(prior.x - candidate.x, prior.y - candidate.y) >= 10)) chosen.push({ x: candidate.x, y: candidate.y });
    if (chosen.length >= 24) break;
  }
  return chosen;
};

const displacement = (track: PointTrackResultV1): number => {
  const first = track.samples[0], last = track.samples[track.samples.length - 1];
  return first && last ? Math.hypot(last.point.x - first.point.x, last.point.y - first.point.y) : 0;
};

const selectTrack = (frames: readonly GrayFrameV1[]): { seed: { x: number; y: number }; track: PointTrackResultV1; displacement: number } => {
  const first = frames[0];
  if (!first) throw new Error("Decoded tracking sequence has no first frame.");
  const attempts: { seed: { x: number; y: number }; track: PointTrackResultV1; displacement: number; score: number }[] = [];
  for (const seedPx of seedCandidates(first)) {
    try {
      const seed = { x: seedPx.x / Math.max(1, first.width - 1), y: seedPx.y / Math.max(1, first.height - 1) };
      const track = trackPointV1(frames, { targetEntityId: "M4_REAL_AE_PROOF_FEATURE", initialPoint: seed, searchRadiusPx: 12, maxJumpPx: 9 });
      const motion = displacement(track);
      const status = track.status === "STABLE" ? 4 : track.status === "AT_RISK" ? 3 : track.status === "DRIFTING" ? 2 : 1;
      attempts.push({ seed, track, displacement: motion, score: status * 10 + track.confidence * 3 + Math.min(1, motion * 20) });
    } catch {}
  }
  attempts.sort((a, b) => b.score - a.score);
  const best = attempts[0];
  if (!best) throw new Error("No bounded textured seed could be tracked across the AE frame sequence.");
  return { seed: best.seed, track: best.track, displacement: best.displacement };
};

const main = async (): Promise<void> => {
  const configPath = required("--config");
  const resultPath = required("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  const requestedFrames = Number(argument("--frames") ?? "12");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10000) throw new Error("--timeout-ms must be at least 10000.");
  if (!Number.isInteger(requestedFrames) || requestedFrames < 4 || requestedFrames > 120) throw new Error("--frames must be an integer from 4 to 120.");

  const artifactDir = path.dirname(resultPath);
  await mkdir(artifactDir, { recursive: true });
  const config = parseConfig(JSON.parse(stripBom(await readFile(configPath, "utf8"))) as unknown);
  const broker = new LoopbackCepBroker({ port: config.port, token: config.token, commandTimeoutMs: Math.min(timeoutMs, 30000), commandLeaseMs: 2000, expectedExtensionId: config.extensionId });
  let failure: string | null = null;
  let report: Record<string, unknown> = {};

  try {
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`Broker bound unexpected port ${boundPort}.`);
    const panel = await broker.waitForPanel(timeoutMs);
    if (panel.protocolVersion !== config.protocolVersion) throw new Error("CEP panel did not negotiate protocol 1.1 for the proof.");
    const client = new AeCepAdapterClientV11(broker, undefined, new AeFilesystemPolicyV11([artifactDir]));
    const environment = await client.probe();
    const before = await client.observe("m4-tracking-real-ae-proof");
    const activeItem = before.project.items.find((item) => item.hostId === before.project.activeItemHostId);
    const comp: AeCompositionSnapshot | undefined = activeItem?.composition;
    if (!comp) throw new Error("M4 real-AE proof requires an active After Effects composition.");
    const availableFrames = Math.floor(comp.duration * comp.frameRate + 1e-6);
    const frameCount = Math.min(requestedFrames, availableFrames);
    if (frameCount < 4) throw new Error("Active composition does not contain four renderable frames.");

    const outputPath = path.join(artifactDir, "m4-tracking-proof.tif");
    const response = await client.executePublic("render.capture", {
      transactionId: `M4_TRACKING_PROOF_${Date.now()}`,
      operationId: "M4_TRACKING_RENDER",
      payload: { comp: { hostId: comp.hostId }, outputPath, outputProfile: "TRACKING_TIFF_SEQUENCE_V1", timeSpanStart: 0, timeSpanDuration: frameCount / comp.frameRate },
      expectedState: before.observed,
      readbackProfile: "M4_POINT_TRACK_REAL_AE_V1",
    });
    if (response.outcome !== "APPLIED") throw new Error(`Tracking render rejected: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    const readback = record(response.readback);
    const completionPath = readback?.["completionPath"], manifestPath = readback?.["trackingSequenceManifestPath"], jobId = readback?.["jobId"];
    if (readback?.["outputProfile"] !== "TRACKING_TIFF_SEQUENCE_V1" || readback?.["outputFormat"] !== "TIFF Sequence") throw new Error("Tracking render readback did not confirm the fixed TIFF profile.");
    if (typeof completionPath !== "string" || typeof manifestPath !== "string" || typeof jobId !== "string") throw new Error("Tracking render readback is missing lifecycle evidence paths.");
    if (!inside(artifactDir, completionPath) || !inside(artifactDir, manifestPath)) throw new Error("Tracking render evidence escaped the bounded artifact directory.");

    const completion = await waitForTerminalJson(completionPath, timeoutMs);
    if (completion["status"] !== "DONE" || completion["ok"] !== true || completion["queueItemRemoved"] !== true) throw new Error(`Tracking render did not finish cleanly: ${String(completion["error"] ?? completion["status"])}`);
    const manifest = parseManifest(await waitForTerminalJson(manifestPath, timeoutMs));
    if (!manifest.ok || manifest.jobId !== jobId || manifest.expectedFrameCount !== frameCount || manifest.framePaths.length !== frameCount) throw new Error("Tracking frame manifest did not match the scheduled render.");
    for (const framePath of manifest.framePaths) {
      if (!inside(artifactDir, framePath) || (await stat(framePath)).size <= 0) throw new Error(`Tracking frame is invalid or outside artifact root: ${framePath}`);
    }

    const frames: GrayFrameV1[] = [];
    for (let index = 0; index < manifest.framePaths.length; index += 1) frames.push(await readTiffGrayFrameV1(manifest.framePaths[index]!, {
      frameId: `AE_M4_${index}`, timeMs: index * 1000 / comp.frameRate, evidenceRefs: [manifestPath, `AE_RENDER_FRAME_${index}`],
    }));
    const selected = selectTrack(frames);
    const after = await client.observe("m4-tracking-real-ae-proof");
    const stableMotion = selected.track.status === "STABLE" && selected.track.confidence >= 0.72 && selected.displacement >= 0.0025;
    const structureUnchanged = before.observed.projectFingerprint === after.observed.projectFingerprint && before.project.itemCount === after.project.itemCount && before.project.activeItemHostId === after.project.activeItemHostId;
    const ok = stableMotion && structureUnchanged;
    report = {
      proofId: "M4_POINT_TRACK_REAL_AE_V1", ok, classification: ok ? "PASS" : "EVIDENCE_INSUFFICIENT",
      environment, panel, activeComposition: { hostId: comp.hostId, name: comp.name, width: comp.width, height: comp.height, frameRate: comp.frameRate, duration: comp.duration },
      renderReadback: readback, completion, manifest,
      decodedFrames: frames.map((frame) => ({ frameId: frame.frameId, width: frame.width, height: frame.height, timeMs: frame.timeMs })),
      selectedSeed: selected.seed, pointTrack: selected.track, normalizedDisplacement: selected.displacement,
      checks: { fixedTrackingProfile: true, exactFrameManifest: true, stableMotion, projectStructureUnchanged: structureUnchanged },
      proofLevels: { P1_typed_validation: true, P2_semantic_tracking_readback: stableMotion, P3_visual_external_review: false, P4_failure_recovery: false, P5_transfer: false },
      safety: { projectSavePerformed: false, projectOpenReplacePerformed: false, compositionMutationPerformed: false, renderQueueOwnedAndRemoved: completion["queueItemRemoved"] === true, artifactRoot: artifactDir },
    };
    if (!ok) process.exitCode = 2;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    report = { proofId: "M4_POINT_TRACK_REAL_AE_V1", ok: false, classification: "PROOF_FAILURE", error: failure, proofLevels: { P1_typed_validation: false, P2_semantic_tracking_readback: false, P3_visual_external_review: false, P4_failure_recovery: false, P5_transfer: false } };
    process.exitCode = 1;
  } finally {
    await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await broker.stop();
  }
};

await main();
