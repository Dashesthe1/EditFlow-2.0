import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GptOrchestrationStoreV1, EditTypeRegistryFileV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";
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
  assert.equal(metadata.perceptualSignature, undefined, "Metadata must not perform visual classification");
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
  let service = new PracticePanelServerV1(config); await service.start();
  t.after(async () => { await service.stop(); await broker.stop(); await rm(root, { recursive: true, force: true }); });
  const endpoint = `http://127.0.0.1:${service.port}/v1/product/gpt/assignments/${encodeURIComponent(assignment.assignmentId)}/footage-selection`;
  const headers = { "X-EditFlow-Token": token, "Content-Type": "application/json" };
  const get = async () => (await fetch(endpoint, { headers })).json();
  const post = body => fetch(endpoint, { headers, method: "POST", body: JSON.stringify({ claimedBy: "controller", ...body }) });
  let state = await get();
  assert.equal(state.contract.authority, "CHATGPT_DIRECT"); assert.equal(state.legacyCandidatesDiscarded, true);
  assert.equal(state.searchState.rawMetadata.length, 1); assert.deepEqual(state.selections, []);
  assert.equal((await post({ action: "BROWSE", claimedBy: "old-chat", mediaId: "video:1:raw", timesMs: [2000] })).status, 409);
  assert.deepEqual(state.reference.shots, []);
  const times = [50,450,900];
  const rawTimes = times.map(time => time + 2000);
  const ref = await (await post({ action: "BROWSE", mediaId: "finish:1:reference", timesMs: times })).json();
  const raw = await (await post({ action: "BROWSE", mediaId: "video:1:raw", timesMs: rawTimes })).json();
  const outline = await post({action:"DEFINE_REFERENCE",authority:"CHATGPT_DIRECT",durationMs:1000,rationale:"Directly reviewed a one-second continuous action",shots:[{shotId:"shot:1",order:0,referenceStartMs:0,referenceEndMs:1000,observation:"Continuous pattern motion",inspections:[{evidenceId:ref.inspection.evidenceId,timeMs:450}]}]});
  assert.equal(outline.status,201); state=await get();
  assert.ok((await readFile(raw.inspection.contactSheetPath)).length > 1000);
  const selections = state.reference.shots.map((shot, index) => ({ shotId: shot.shotId, sourceId: "video:1:raw",
    sourceStartMs: 2000 + shot.referenceStartMs, sourceEndMs: 2000 + shot.referenceEndMs,
    direction: "FORWARD", playbackRate:1, confidence: .99, rationale: "Fixture compares the raw trim at three actual decoded moments.",
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
  await service.stop();
  // Simulate a host-issued render receipt. Rendering itself is tested by the AE driver suite.
  const renderPath=path.join(root,"actual-render.mp4"); await copyFile(finishPath,renderPath);
  const job={assignmentId:assignment.assignmentId,jobId:"production-job:render",kind:"LOCAL_RENDER",requestKey:"fixture",
    payload:{startMs:0,endMs:1000},dependencyIds:[],status:"SUCCEEDED",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),result:{renderPath}};
  await writeFile(path.join(root,"production-coordinator","jobs.jsonl"),[job,{...job,jobId:"production-job:partial",requestKey:"partial",payload:{startMs:0,endMs:500}}].map(j=>JSON.stringify(j)).join("\n")+"\n");
  await store.updatePreflight(assignment.assignmentId,{...updated.preflight,stage:"READY"},updated.practiceSceneMatches);
  const types=new EditTypeRegistryFileV1(config.editTypeRegistryFilePath);
  await types.update(registry=>registry.create({editTypeId:"test",title:"Test",choiceWords:["test"]}));
  service=new PracticePanelServerV1(config); await service.start();
  const base=`http://127.0.0.1:${service.port}/v1/product/gpt/assignments/${encodeURIComponent(assignment.assignmentId)}`;
  const request=async(path,body)=>fetch(base+path,{headers,method:"POST",body:JSON.stringify({claimedBy:"controller",...body})});
  await service.assertPracticeReconstructionReady();
  const renderReply=await request("/footage-selection",{action:"BROWSE_RENDER",renderJobId:job.jobId,timesMs:times});
  assert.equal(renderReply.status,201); const pixels=(await renderReply.json()).inspection;
  const checks=Object.fromEntries(["shots","timing","audio","framing","effects","transitions","color"].map(k=>[k,"Reviewed the actual output: "+k]));
  const finalReview={authority:"CHATGPT_DIRECT",verdict:"PASS",renderJobId:job.jobId,
    renderSha256:createHash("sha256").update(await readFile(renderPath)).digest("hex"),remainingIssues:[],checks,
    comparisons:times.map(time=>({clipId:"shot:1",renderTimeMs:time,renderEvidenceId:pixels.evidenceId,
      referenceTimeMs:time,referenceEvidenceId:ref.inspection.evidenceId,observation:"Corresponding motion and framing reviewed directly"}))};
  const complete=review=>request("/complete",{success:true,finalSummary:"Direct review passed",finalReview:review});
  assert.equal((await request("/complete",{success:true,finalSummary:"A numerical score says pass"})).status,400);
  assert.equal((await complete({...finalReview,renderSha256:"0".repeat(64)})).status,409);
  assert.equal((await complete({...finalReview,renderJobId:"production-job:partial"})).status,400);
  assert.equal((await complete({...finalReview,comparisons:[{...finalReview.comparisons[0],renderEvidenceId:"invented"}]})).status,400);
  assert.equal((await complete(finalReview)).status,400,"Completion must first retain a reviewed example");
  const lesson={authority:"CHATGPT_DIRECT",lessonId:"worked:timing",title:"Matched source timing",problem:"Match continuous raw motion",
    steps:[{action:"Apply selected source range",settings:{sourceStartMs:2000,sourceEndMs:3000,playbackRate:1},reason:"Direct pixel comparisons match",check:"Review the rendered motion"}],
    outcome:"WORKED",observation:"The render matches the selected action",explanation:"The explicitly chosen range preserves timing",
    whenToUse:["This observed motion"],adaptation:["Reinspect new footage"],mistakesToAvoid:["Do not guess the source moment"],evidenceRefs:[]};
  const saved=await request("/practice-notebook",{lesson,reviewEvidence:{renderJobId:job.jobId,inspections:[{evidenceId:pixels.evidenceId,timeMs:450}]}});
  assert.equal(saved.status,200); const notebook=(await saved.json()).practiceNotebook;
  assert.equal(notebook.examples[0].steps[0].settings.playbackRate,1);
  assert.ok(notebook.examples[0].evidenceRefs.includes("footage-inspection:"+pixels.evidenceId));
  const done=await complete(finalReview); assert.equal(done.status,200,JSON.stringify(await done.json()));
  const retained=(await types.load()).knowledge("test").gptLearning;
  assert.equal(retained.workedExamples.length,1); assert.equal(retained.chatgptReviews[0].verdict,"PASS");
});
