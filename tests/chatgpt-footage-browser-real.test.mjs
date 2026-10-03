import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GptOrchestrationStoreV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";

test("direct browser decodes requested moments, produces timestamped sheets and rejects out-of-bounds requests", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "direct-browser-real-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const python = process.platform === "win32" ? "py" : "python3";
  const prefix = process.platform === "win32" ? ["-3.12"] : [];
  const ffmpeg = process.env.EDITFLOW_FFMPEG_PATH || execFileSync(python, [...prefix, "-c",
    "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();
  const video = path.join(root, "raw.mp4"), output = path.join(root, "browse.json");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-t", "6", "-y", video]);
  const script = path.resolve("scripts/practice/chatgpt-footage-browser.py");
  execFileSync(python, [...prefix, script, "metadata", "--video", video, "--source-id", "raw", "--output", path.join(root, "meta.json")]);
  const metadata = JSON.parse(await readFile(path.join(root, "meta.json"), "utf8"));
  assert.equal(metadata.video.durationMs, 6000);
  assert.equal(metadata.sourceSha256, createHash("sha256").update(await readFile(video)).digest("hex"));
  assert.equal(metadata.perceptualSignature.split(",").length, 16);
  execFileSync(python, [...prefix, script, "browse", "--video", video, "--output", output, "--times-json", "[100,2200,5100]", "--width", "640", "--ffmpeg", ffmpeg]);
  const packet = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(packet.frames.map((frame) => frame.timeMs), [100, 2200, 5100]);
  assert.equal(new Set(packet.frames.map((frame) => frame.sha256)).size, 3);
  for (const frame of packet.frames) assert.equal(createHash("sha256").update(await readFile(frame.path)).digest("hex"), frame.sha256);
  assert.ok((await readFile(packet.contactSheetPath)).length > 1000);
  assert.throws(() => execFileSync(python, [...prefix, script, "browse", "--video", video, "--output", output, "--times-json", "[6000]"], { stdio: "pipe" }), /Command failed/);
});

test("HTTP direct selection survives video/audio preflight and prepares only the GPT-selected ranges", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "direct-browser-http-"));
  const python = process.platform === "win32" ? "py" : "python3";
  const prefix = process.platform === "win32" ? ["-3.12"] : [];
  const ffmpeg = process.env.EDITFLOW_FFMPEG_PATH || execFileSync(python, [...prefix, "-c",
    "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();
  const video = path.join(root, "raw.mp4"), finishPath = path.join(root, "reference.mp4"), song = path.join(root, "song.mp3");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30", "-t", "6", "-y", video]);
  execFileSync(ffmpeg, ["-v", "error", "-ss", "2", "-i", video, "-t", "1", "-y", finishPath]);
  await import("node:fs/promises").then(fs => fs.writeFile(song, "raw song fixture"));
  const token = "direct-footage-http-token-0123456789abcdef";
  const broker = new LoopbackCepBroker({ port: 0, token }); await broker.start();
  const config = { port: 0, token, broker, productionSupervision: false, ffmpegPath: ffmpeg,
    repositoryRoot: process.cwd(), artifactDir: root, learningMemoryFilePath: path.join(root, "memory.json"),
    editTypeRegistryFilePath: path.join(root, "types.json"), gptOrchestrationFilePath: path.join(root, "gpt.json") };
  const store = new GptOrchestrationStoreV1(config.gptOrchestrationFilePath);
  const assignment = await store.createAssignment({ sessionId: "practice:direct-http", mode: "PRACTICE", editTypeId: "test",
    artifactDir: root, knowledge: null, finish: { mediaId: "finish:1:reference", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: finishPath },
    start: [{ mediaId: "video:1:raw", role: "START_SOURCE", mediaKind: "VIDEO", uri: video },
      { mediaId: "audio:1:song", role: "START_SOURCE", mediaKind: "AUDIO", uri: song }],
    preflight: { stage: "READY", updatedAt: new Date().toISOString(), requireTransferNovelty: false,
      completedShotIds: [], unresolvedShotIds: [], reasons: [], evidenceRefs: [] } });
  await store.claim(assignment.assignmentId, "controller");
  const service = new PracticePanelServerV1(config); await service.start();
  t.after(async () => { await service.stop(); await broker.stop(); await rm(root, { recursive: true, force: true }); });
  const endpoint = `http://127.0.0.1:${service.port}/v1/product/gpt/assignments/${encodeURIComponent(assignment.assignmentId)}/footage-selection`;
  const headers = { "X-EditFlow-Token": token, "Content-Type": "application/json" };
  const get = async () => (await fetch(endpoint, { headers })).json();
  const post = body => fetch(endpoint, { headers, method: "POST", body: JSON.stringify({ claimedBy: "controller", ...body }) });
  const state = await get();
  assert.equal(state.contract.authority, "CHATGPT_DIRECT"); assert.equal(state.legacyCandidatesDiscarded, true);
  assert.equal(state.searchState.rawMetadata.length, 1); assert.deepEqual(state.selections, []);
  assert.equal((await post({ action: "BROWSE", claimedBy: "old-chat", mediaId: "video:1:raw", timesMs: [2000] })).status, 409);
  const times = state.reference.shots.flatMap(shot => [0.05, .45, .9].map(f => shot.referenceStartMs + (shot.referenceEndMs - shot.referenceStartMs) * f));
  const rawTimes = times.map(time => time + 2000);
  const ref = await (await post({ action: "BROWSE", mediaId: "finish:1:reference", timesMs: times })).json();
  const raw = await (await post({ action: "BROWSE", mediaId: "video:1:raw", timesMs: rawTimes })).json();
  assert.ok((await readFile(raw.inspection.contactSheetPath)).length > 1000);
  const selections = state.reference.shots.map((shot, index) => ({ shotId: shot.shotId, sourceId: "video:1:raw",
    sourceStartMs: 2000 + shot.referenceStartMs, sourceEndMs: 2000 + shot.referenceEndMs,
    direction: "FORWARD", confidence: .99, rationale: "Fixture compares the raw trim at three actual decoded moments.",
    anchors: times.slice(index * 3, index * 3 + 3).map(referenceTimeMs => ({ referenceTimeMs,
      sourceTimeMs: referenceTimeMs + 2000, referenceEvidenceId: ref.inspection.evidenceId, sourceEvidenceId: raw.inspection.evidenceId,
      observation: "The same test pattern and motion phase are directly visible." })) }));
  const response = await post({ action: "SELECT", selections, search: { internetStatus: "UNAVAILABLE", reason: "Isolated synthetic video fixture has no online source.", strategies: ["chronological frames", "exact trim comparison"] } });
  assert.equal(response.status, 201); assert.equal((await response.json()).selections.length, selections.length);
  let updated;
  const deadline = Date.now() + 15000;
  do {
    updated = await store.getAssignment(assignment.assignmentId);
    if (["READY", "BLOCKED", "AWAITING_CHATGPT_SHOTS"].includes(updated.preflight.stage)) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (Date.now() < deadline);
  assert.deepEqual(updated.preflight.unresolvedShotIds, []);
  assert.equal(updated.practiceSceneMatches.length, selections.length);
  for (const match of updated.practiceSceneMatches) {
    assert.equal(match.selectionMode, "CHATGPT_DIRECT"); assert.ok((await readFile(match.workingMedia.sourcePath)).length > 1000);
    assert.equal(match.sourceStartMs, selections.find(selection => selection.shotId === match.shotId).sourceStartMs);
  }
  assert.equal(updated.assignmentId, assignment.assignmentId); assert.equal(updated.sessionId, assignment.sessionId);
});
