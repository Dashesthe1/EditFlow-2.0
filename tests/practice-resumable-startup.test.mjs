import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";
import { GptOrchestrationStoreV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";

const token = "resumable-practice-token-0123456789abcdef";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };

test("concurrent offline starts persist one assignment and restart resumes the same blocked preflight", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-resumable-"));
  const media = path.join(root, "fixture.mp4");
  await writeFile(media, "fixture");
  const broker = new LoopbackCepBroker({ port: 0, token });
  await broker.start();
  const config = { port: 0, token, broker, repositoryRoot: process.cwd(),
    artifactDir: path.join(root, "artifacts"), learningMemoryFilePath: path.join(root, "memory.json"),
    editTypeRegistryFilePath: path.join(root, "types.json"), gptOrchestrationFilePath: path.join(root, "gpt.json") };
  let service = new PracticePanelServerV1({ ...config, productionSupervision: false });
  await service.start();
  t.after(async () => { await service.stop(); await broker.stop(); await rm(root, { recursive: true, force: true }); });
  const start = () => fetch(`http://127.0.0.1:${service.port}/v1/product/practice`, {
    method: "POST", headers, body: JSON.stringify({ editTypeId: "test", editTypeTitle: "Test",
      finishPath: media, videoPaths: [media] }),
  }).then(async (response) => { assert.equal(response.status, 202); return (await response.json()).run; });
  const [first, second] = await Promise.all([start(), start()]);
  assert.equal(first.assignmentId, second.assignmentId);
  await service.stop();
  const store = new GptOrchestrationStoreV1(config.gptOrchestrationFilePath);
  assert.equal((await store.listAssignments()).length, 1);
  service = new PracticePanelServerV1({ ...config, productionSupervision: false });
  await service.start();
  const handshake = await (await fetch(`http://127.0.0.1:${service.port}/v1/product/practice/resume-or-start`, { headers })).json();
  assert.equal(handshake.assignment.assignmentId, first.assignmentId);
  assert.equal(handshake.nextOperation, "RESUME_PREFLIGHT");
  assert.notEqual(handshake.preflight.stage, "READY");
  assert.ok(handshake.sourceMatch.contract.actions.includes("REFINE"));
  assert.equal(handshake.sourceMatch.retained,null);
  assert.ok(handshake.sourceAssembly.contract.actions.includes("CANCEL_ASSEMBLY"));
  if(!process.env.LOCALAPPDATA) {
    const jobId="source-match-00000000-0000-0000-0000-000000000001",dir=path.join(root,"EditFlow2","source-match-jobs",jobId);
    await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,"job.json"),JSON.stringify({jobId,assignmentId:first.assignmentId,status:"PARTIAL",createdAt:new Date().toISOString(),outputDir:dir}));
    await writeFile(path.join(dir,"report.json"),JSON.stringify({status:"PARTIAL",summary:{VERIFIED:1,LOCATED:1,UNRESOLVED:0},shots:[{shotId:"shot-002",status:"LOCATED",reason:"black boundary"}]}));
    const retained=await (await fetch(`http://127.0.0.1:${service.port}/v1/product/practice/resume-or-start`,{headers})).json();
    assert.equal(retained.assignment.assignmentId,first.assignmentId);
    assert.equal(retained.sourceMatch.retained.job.jobId,jobId);
    assert.equal(retained.nextOperation,"CHATGPT_REFINE_OR_INSPECT_UNRESOLVED_SHOTS");
    assert.equal(retained.sourceMatch.retained.remaining[0].shotId,"shot-002");
    const mismatch=await fetch(`http://127.0.0.1:${service.port}/v1/product/source-match`,{method:"POST",headers,body:JSON.stringify({action:"SUBMIT",assignmentId:first.assignmentId,referencePath:media,sourcePaths:[path.join(root,"foreign.mp4")],requestId:"foreign"})});
    assert.equal(mismatch.status,400);assert.match((await mismatch.json()).error,/ASSIGNMENT_RAW_SOURCES_REQUIRED/);
  }
  await assert.rejects(service.assertPracticeReconstructionReady(), /reconstruction is locked/);
  const again = await start();
  assert.equal(again.assignmentId, first.assignmentId);
});

test("controller leases block concurrent takeover, release and expiry preserve assignment checkpoints", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-lease-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "gpt.json");
  const store = new GptOrchestrationStoreV1(file);
  const assignment = await store.createAssignment({ sessionId: "practice:test", mode: "PRACTICE",
    editTypeId: "test", finish: { mediaId: "ref", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: "ref.mp4" },
    start: [{ mediaId: "raw", role: "START_SOURCE", mediaKind: "VIDEO", uri: "raw.mp4" }],
    artifactDir: root, knowledge: null,
    preflight: { stage: "BLOCKED", updatedAt: new Date().toISOString(), requireTransferNovelty: false,
      completedShotIds: ["shot:1"], unresolvedShotIds: ["shot:2"], reasons: ["needs refinement"], evidenceRefs: [] } });
  await store.claim(assignment.assignmentId, "controller-a");
  await assert.rejects(store.claim(assignment.assignmentId, "controller-b"), /lease is held/);
  await store.releaseController(assignment.assignmentId, "controller-a");
  await store.claim(assignment.assignmentId, "controller-b");
  const persisted = JSON.parse(await readFile(file, "utf8"));
  persisted.assignments[0].controllerLease.expiresAt = new Date(0).toISOString();
  await writeFile(file, JSON.stringify(persisted));
  const reclaimed = await new GptOrchestrationStoreV1(file).claim(assignment.assignmentId, "controller-c");
  assert.equal(reclaimed.assignmentId, assignment.assignmentId);
  assert.deepEqual(reclaimed.preflight.completedShotIds, ["shot:1"]);
  await store.requestCancel(assignment.assignmentId);
  await store.updatePreflight(assignment.assignmentId, { ...reclaimed.preflight, stage: "READY" });
  assert.equal((await store.getAssignment(assignment.assignmentId)).preflight.stage, "BLOCKED");
});

test("resuming an older assignment replaces retired footage guidance without losing editorial notes", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-policy-resume-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "gpt.json");
  const store = new GptOrchestrationStoreV1(file);
  const assignment = await store.createAssignment({ sessionId: "practice:policy", mode: "PRACTICE",
    editTypeId: "test", finish: { mediaId: "ref", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: "ref.mp4" },
    start: [{ mediaId: "raw", role: "START_SOURCE", mediaKind: "VIDEO", uri: "raw.mp4" }],
    artifactDir: root, knowledge: null });
  const persisted = JSON.parse(await readFile(file, "utf8"));
  persisted.assignments[0].chatMessage = [
    "Retained editorial note: keep the opening wide framing.",
    "For footage discovery, primarily use internet research: find scene and dialogue clues first.",
    "AWAITING_CHATGPT_SHOTS requires direct footage work now, not polling an algorithm.",
    "EDIT_PRODUCTION_QUEUE_POLICY_V3",
    "obsolete generated appendix"
  ].join("\n");
  await writeFile(file, JSON.stringify(persisted));
  const resumed = await new GptOrchestrationStoreV1(file).getAssignment(assignment.assignmentId);
  assert.equal(resumed.assignmentId, assignment.assignmentId);
  assert.match(resumed.chatMessage, /keep the opening wide framing/);
  assert.match(resumed.chatMessage, /use the user-authorized EditFlow Source Match Service first/);
  assert.match(resumed.chatMessage, /PREPARE_ASSEMBLY saves official timestamps/);
  assert.doesNotMatch(resumed.chatMessage, /primarily use internet research|not polling an algorithm|obsolete generated appendix/);
});

test("concurrent store instances serialize controller claims and readers always see complete checkpoints", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-atomic-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "gpt.json");
  const a = new GptOrchestrationStoreV1(file);
  const b = new GptOrchestrationStoreV1(file);
  const assignment = await a.createAssignment({ sessionId: "practice:atomic", mode: "PRACTICE",
    editTypeId: "test", finish: { mediaId: "ref", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: "ref.mp4" },
    start: [{ mediaId: "raw", role: "START_SOURCE", mediaKind: "VIDEO", uri: "raw.mp4" }],
    artifactDir: root, knowledge: null });
  const claims = await Promise.allSettled([a.claim(assignment.assignmentId, "a"), b.claim(assignment.assignmentId, "b")]);
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(claims.filter((result) => result.status === "rejected").length, 1);
  const checkpoint = { stage: "SCENE_MATCHING", updatedAt: new Date().toISOString(),
    requireTransferNovelty: false, completedShotIds: ["shot:1"], unresolvedShotIds: ["shot:2"],
    reasons: [], evidenceRefs: [] };
  await Promise.all([
    (async () => { for (let i = 0; i < 50; i++) await a.updatePreflight(assignment.assignmentId, checkpoint); })(),
    (async () => { for (let i = 0; i < 200; i++) assert.equal((await b.getAssignment(assignment.assignmentId)).assignmentId, assignment.assignmentId); })(),
  ]);
  assert.deepEqual((await b.getAssignment(assignment.assignmentId)).preflight.completedShotIds, ["shot:1"]);
});
