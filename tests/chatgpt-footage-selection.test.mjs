import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatgptFootageBrowserV1, GptOrchestrationStoreV1, hasVerifiedPracticeSourceIdentityV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-footage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const counter = path.join(root, "commands.txt");
  const referenceScript = path.join(root, "reference.cjs");
  await writeFile(referenceScript, `const fs=require('node:fs'); const a=process.argv.slice(2); const v=k=>a[a.indexOf(k)+1];
    fs.appendFileSync(${JSON.stringify(counter)}, a[0]+'\\n');
    if(a[0]!=='reference') throw Error('RAW RANKER MUST NEVER RUN');
    fs.writeFileSync(v('--output'),JSON.stringify({schema:'editflow.practice-reference-analysis.v1',referenceId:v('--reference-id'),
      sourcePath:v('--video'),styleFingerprint:'test',perceptualSignature:'abc',evidenceRefs:[],
      shots:[{shotId:'shot:1',order:0,referenceStartMs:0,referenceEndMs:1000,evidenceRefs:[]}]}));`);
  await writeFile(path.join(root, "chatgpt-footage-browser.py"), `const fs=require('node:fs');const crypto=require('node:crypto');const path=require('node:path');
    const a=process.argv.slice(2),v=k=>a[a.indexOf(k)+1],output=v('--output');
    fs.appendFileSync(${JSON.stringify(counter)},a[0]+'\\n');
    const video={fps:30,durationMs:10000};
    const result=a[0]==='metadata'?{schema:'editflow.practice-source-index.v1',sourceId:v('--source-id'),sourcePath:v('--video'),
      sourceSha256:'f'.repeat(64),perceptualSignature:'raw',video,evidenceRefs:[]}:
      {schema:'editflow.chatgpt-footage-inspection.v1',video,frames:JSON.parse(v('--times-json')).map((timeMs,i)=>{
        const p=output+'.'+i+'.png';fs.writeFileSync(p,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
        return {timeMs,path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')};})};
    fs.writeFileSync(output,JSON.stringify(result));`);
  const finish = { mediaId: "finish", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: path.join(root, "finish.mp4") };
  const raw = { mediaId: "raw", role: "START_SOURCE", mediaKind: "VIDEO", uri: path.join(root, "raw.mp4") };
  await writeFile(finish.uri, "reference fixture"); await writeFile(raw.uri, "raw fixture");
  const config = { artifactDir: path.join(root, "artifacts"), analysisCacheDir: path.join(root, "cache"),
    scriptPath: path.join(root, "chatgpt-footage-browser.py"), python: { executable: process.execPath, prefixArgs: [] }, ffmpegPath: process.execPath };
  const matcher = new ChatgptFootageBrowserV1(config);
  const initial = await matcher.readReference(finish), sourceIndex = await matcher.indexProvidedMedia([raw]);
  assert.deepEqual(initial.shots, []);
  const refPixels = await matcher.inspectFootage(finish, [0, 400, 900]);
  const reference = await matcher.defineReference(finish, {authority:"CHATGPT_DIRECT",durationMs:1000,rationale:"Observed a single shot",shots:[{shotId:"shot:1",order:0,referenceStartMs:0,referenceEndMs:1000,observation:"Single continuous action",inspections:[{evidenceId:refPixels.evidenceId,timeMs:400}]}]});
  const rawPixels = await matcher.inspectFootage(raw, [2000, 2400, 2900]);
  const selections = [{ shotId: "shot:1", sourceId: "raw", sourceStartMs: 2000, sourceEndMs: 3000,
    direction: "FORWARD", playbackRate: 1, confidence: .98, rationale: "Same subject, pose and action across the complete shot.",
    anchors: [0, 1, 2].map((i) => ({ referenceTimeMs: refPixels.frames[i].timeMs, sourceTimeMs: rawPixels.frames[i].timeMs,
      referenceEvidenceId: refPixels.evidenceId, sourceEvidenceId: rawPixels.evidenceId, observation: "Corresponding action moment." })) }];
  const search = { internetStatus: "CONSULTED", sources: [{ url: "https://example.org/script", query: "scene dialogue", finding: "Scene context narrows the raw interval." }],
    strategies: ["dialogue clues", "chronological review", "dense gesture comparison"] };
  return { root, counter, matcher, config, reference, sourceIndex, finish, raw, rawPixels,
    input: { reference, sourceIndex, finish, start: [raw], selections, search } };
}

test("production defaults to GPT choices, never runs index/ranking, and resumes exact retained selections", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.matcher.prepareSelectedFootage({ reference: f.reference, sourceIndex: f.sourceIndex, minimumConfidence: .95 }), []);
  await f.matcher.selectFootage(f.input);
  const matches = await f.matcher.prepareSelectedFootage({ reference: f.reference, sourceIndex: f.sourceIndex, minimumConfidence: .95 });
  assert.equal(matches.length, 1); assert.equal(matches[0].selectionMode, "CHATGPT_DIRECT");
  assert.equal(matches[0].sourceStartMs, 2000); assert.equal(matches[0].geometricProof, undefined);
  assert.ok(hasVerifiedPracticeSourceIdentityV1(matches[0]));
  const resumed = new ChatgptFootageBrowserV1({ ...f.config, analysisCacheDir: path.join(f.root, "other-cache") });
  const ref = await resumed.readReference(f.finish), index = await resumed.indexProvidedMedia([f.raw]);
  assert.equal(index.indexId, f.sourceIndex.indexId);
  assert.deepEqual(await resumed.prepareSelectedFootage({ reference: ref, sourceIndex: index, minimumConfidence: .95 }), matches);
  assert.doesNotMatch(await readFile(f.counter, "utf8"), /^(reference|index|match|audio-match)$/m);
  const audio = { mediaId: "song", role: "START_SOURCE", mediaKind: "AUDIO", uri: path.join(f.root, "song.mp3") };
  await writeFile(audio.uri, "raw audio");
  const withAudio = await resumed.indexProvidedMedia([f.raw, audio]);
  assert.equal(withAudio.indexId, index.indexId, "raw song does not invalidate visual decisions");
  assert.equal((await resumed.prepareSelectedFootage({ reference: ref, sourceIndex: withAudio, minimumConfidence: .95 })).length, 1);
  assert.equal((await resumed.footageSearchState(withAudio)).searchHistory.length, 1);
  await writeFile(f.rawPixels.frames[0].path, "changed retained pixels");
  await assert.rejects(resumed.prepareSelectedFootage({ reference: ref, sourceIndex: withAudio, minimumConfidence: .95 }), /real retained pixels/);
});

test("GPT selection rejects forged evidence, missing web research, unknown raw IDs and changed pixels/media", async (t) => {
  const f = await fixture(t);
  const mutate = (change) => { const input = structuredClone(f.input); change(input); return input; };
  await assert.rejects(f.matcher.selectFootage(mutate((i) => { i.selections[0].sourceId = "finish"; })), /provided raw/);
  await assert.rejects(f.matcher.selectFootage(mutate((i) => { i.search.sources = []; })), /internet research/);
  await assert.rejects(f.matcher.selectFootage(mutate((i) => { i.selections[0].anchors[0].sourceEvidenceId = "forged"; })), /issued/);
  await assert.rejects(f.matcher.selectFootage(mutate((i) => { i.selections[0].sourceEndMs = 20000; })), /exceeds/);
  await assert.rejects(f.matcher.selectFootage(mutate((i) => { i.selections[0].anchors[2].referenceTimeMs = 1100; })), /inside/);
  await assert.rejects(f.matcher.selectFootage(mutate((i) => { i.selections[0].temporalBehavior = "REVERSE"; })), /agree/);
  await writeFile(f.rawPixels.frames[0].path, "changed pixels");
  await assert.rejects(f.matcher.selectFootage(f.input), /real retained pixels/);
  await writeFile(f.raw.uri, "changed raw footage");
  await assert.rejects(f.matcher.selectFootage(f.input), /changed footage/);
});

test("subthreshold decisions survive correction and browsing caches repeated requests", async (t) => {
  const f = await fixture(t);
  const input = structuredClone(f.input); input.selections[0].confidence = .7;
  await f.matcher.selectFootage(input);
  assert.deepEqual(await f.matcher.prepareSelectedFootage({ reference: f.reference, sourceIndex: f.sourceIndex, minimumConfidence: .95 }), []);
  const packet = JSON.parse(await readFile(path.join(f.config.artifactDir, "chatgpt-selections.json"), "utf8"));
  assert.equal(packet.matches.length, 1);
  assert.equal((await f.matcher.footageSearchState(f.sourceIndex)).retainedDecisions[0].confidence, .7);
  const before = await readFile(f.counter, "utf8");
  await f.matcher.inspectFootage(f.raw, [2000, 2400, 2900]);
  assert.equal(await readFile(f.counter, "utf8"), before);
  await f.matcher.selectFootage(f.input);
  assert.equal((await f.matcher.prepareSelectedFootage({ reference: f.reference, sourceIndex: f.sourceIndex, minimumConfidence: .95 })).length, 1);
});

test("concurrent browser requests share one decode receipt across matcher instances", async (t) => {
  const f = await fixture(t), peer = new ChatgptFootageBrowserV1(f.config);
  const before = (await readFile(f.counter, "utf8")).split("\n").filter(line => line === "browse").length;
  const [first, second] = await Promise.all([f.matcher.inspectFootage(f.raw, [4000, 4500]), peer.inspectFootage(f.raw, [4000, 4500])]);
  assert.deepEqual(first, second);
  const after = (await readFile(f.counter, "utf8")).split("\n").filter(line => line === "browse").length;
  assert.equal(after - before, 1);
});

test("switching an active legacy assignment discards candidate authority and keeps its assignment/session/checkpoint", async (t) => {
  const f = await fixture(t), store = new GptOrchestrationStoreV1(path.join(f.root, "gpt.json"));
  const assignment = await store.createAssignment({ sessionId: "practice:retained", mode: "PRACTICE", editTypeId: "test",
    artifactDir: f.root, finish: f.finish, start: [f.raw], knowledge: null,
    preflight: { stage: "READY", updatedAt: new Date().toISOString(), requireTransferNovelty: false,
      totalShotIds: ["shot:1"], completedShotIds: ["shot:1"], unresolvedShotIds: [], reasons: [], evidenceRefs: [] } });
  // Seed a pre-upgrade record directly; new writes must reject this old format.
  const persisted = JSON.parse(await readFile(store.filePath, "utf8"));
  persisted.assignments[0].practiceSceneMatches = [{ shotId: "shot:1", sourceId: "raw", sourceStartMs: 2000, sourceEndMs: 3000,
      playbackRate: 1, direction: "FORWARD", confidence: .99, selectionMode: "VISUAL_BEST", evidenceRefs: [] }];
  await writeFile(store.filePath, JSON.stringify(persisted));
  const resumed = await store.getAssignment(assignment.assignmentId);
  assert.equal(resumed.sessionId, assignment.sessionId); assert.deepEqual(resumed.practiceSceneMatches, []);
  assert.equal(resumed.preflight.stage, "AWAITING_CHATGPT_SHOTS");
  assert.match(resumed.chatMessage, /CHATGPT DIRECT RAW FOOTAGE SELECTION V1/);
  assert.doesNotMatch(resumed.chatMessage, /A machine scene score narrows candidates/);
});

test("Practice writes reject every alternate selection method and direct labels without comparisons", async (t) => {
  const f = await fixture(t), store = new GptOrchestrationStoreV1(path.join(f.root, "gpt.json"));
  const create = { sessionId: "practice:only-direct", mode: "PRACTICE", editTypeId: "test",
    artifactDir: f.root, finish: f.finish, start: [f.raw], knowledge: null };
  const direct = (await f.matcher.selectFootage(f.input))[0];
  const assignment = await store.createAssignment({ ...create, practiceSceneMatches: [direct] });
  const preflight = { stage: "WORKING_MEDIA", updatedAt: new Date().toISOString(), requireTransferNovelty: false,
    completedShotIds: [], unresolvedShotIds: ["shot:1"], reasons: [], evidenceRefs: [] };
  for (const mode of ["VISUAL_BEST", "VISUAL_TEMPORAL", "VISUAL_GEOMETRIC", "AUTOMATIC", "ISOLATED_LEGACY_TEST", undefined]) {
    const alternate = { ...direct, selectionMode: mode };
    await assert.rejects(store.createAssignment({ ...create, sessionId: "alternate:" + mode,
      practiceSceneMatches: [alternate] }), /CHATGPT_DIRECT_REQUIRED/);
    await assert.rejects(store.updatePreflight(assignment.assignmentId, preflight, [alternate]), /CHATGPT_DIRECT_REQUIRED/);
  }
  await assert.rejects(store.updatePreflight(assignment.assignmentId, preflight,
    [{ ...direct, chatgptSelection: undefined }]), /CHATGPT_DIRECT_REQUIRED/);
  await assert.rejects(store.updatePreflight(assignment.assignmentId, preflight,
    [{ ...direct, sourceId: f.finish.mediaId }]), /CHATGPT_DIRECT_REQUIRED/);
  await assert.rejects(store.updatePreflight(assignment.assignmentId, preflight, [direct, direct]), /CHATGPT_DIRECT_REQUIRED/);
  assert.deepEqual((await store.getAssignment(assignment.assignmentId)).practiceSceneMatches, [direct]);
  assert.throws(() => new ChatgptFootageBrowserV1({ ...f.config, shotSelectionAuthority: "AUTOMATIC" }), /Unsupported/);
});

test("terminal assignment reads expose no legacy choices while preserving history on disk", async (t) => {
  const f = await fixture(t), store = new GptOrchestrationStoreV1(path.join(f.root, "gpt.json"));
  const assignment = await store.createAssignment({ sessionId: "practice:completed-history", mode: "PRACTICE", editTypeId: "test",
    artifactDir: f.root, finish: f.finish, start: [f.raw], knowledge: null });
  const persisted = JSON.parse(await readFile(store.filePath, "utf8"));
  const legacy = { ...f.input.selections[0], selectionMode: "VISUAL_BEST", evidenceRefs: [], playbackRate: 1 };
  persisted.assignments[0] = { ...persisted.assignments[0], status: "COMPLETED", finalRenderRef: "retained:final",
    practiceSceneMatches: [legacy] };
  await writeFile(store.filePath, JSON.stringify(persisted));
  const read = await store.getAssignment(assignment.assignmentId);
  assert.deepEqual(read.practiceSceneMatches, []);
  assert.equal(read.status, "COMPLETED"); assert.equal(read.finalRenderRef, "retained:final");
  assert.deepEqual(JSON.parse(await readFile(store.filePath, "utf8")).assignments[0].practiceSceneMatches, [legacy]);
});

test("Practice chat jobs cannot bypass direct selection through missing checkpoints or incomplete shot coverage", async (t) => {
  const f = await fixture(t);
  const token = "exclusive-footage-selection-test-0123456789abcdef";
  const broker = new LoopbackCepBroker({ port: 0, token }); await broker.start();
  const store = new GptOrchestrationStoreV1(path.join(f.root, "gpt.json"));
  const direct = (await f.matcher.selectFootage(f.input))[0];
  const assignment = await store.createAssignment({ sessionId: "practice:chat-gate", mode: "PRACTICE", editTypeId: "test",
    artifactDir: f.root, finish: f.finish, start: [f.raw], knowledge: null });
  await store.claim(assignment.assignmentId, "controller");
  const service = new PracticePanelServerV1({ port: 0, token, broker, productionSupervision: false,
    repositoryRoot: process.cwd(), artifactDir: f.root, learningMemoryFilePath: path.join(f.root, "memory.json"),
    editTypeRegistryFilePath: path.join(f.root, "types.json"), gptOrchestrationFilePath: store.filePath });
  await service.start();
  t.after(async () => { await service.stop(); await broker.stop(); });
  await assert.rejects(service.assertPracticeReconstructionReady(), /reconstruction is locked|REFERENCE_PLAN_REQUIRED|Command failed|Footage browsing failed|Failed to open/gi);
  const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };
  const endpoint = `http://127.0.0.1:${service.port}/v1/product/gpt/assignments/${encodeURIComponent(assignment.assignmentId)}/production-jobs`;
  const enqueue = async () => {
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ kind: "AE_BATCH", payload: {
      intents: [], researchContext: { assignmentId: assignment.assignmentId, claimedBy: "controller", plans: [] } } }) });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /reconstruction is locked|REFERENCE_PLAN_REQUIRED|Command failed|Footage browsing failed|Failed to open/gi);
    assert.deepEqual((await (await fetch(endpoint, { headers })).json()).jobs, []);
  };
  await enqueue();
  await service.stop(); // Drain the background checkpoint before injecting retained states.
  const persisted = JSON.parse(await readFile(store.filePath, "utf8"));
  const checkpoint = { stage: "READY", updatedAt: new Date().toISOString(), requireTransferNovelty: false,
    totalShotIds: ["shot:1"], completedShotIds: [], unresolvedShotIds: [], reasons: [], evidenceRefs: [] };
  const writeState = async (matches, shots = ["shot:1"]) => {
    persisted.assignments[0] = { ...persisted.assignments[0], practiceSceneMatches: matches,
      preflight: { ...checkpoint, totalShotIds: shots } };
    await writeFile(store.filePath, JSON.stringify(persisted));
  };
  await writeState([]); await assert.rejects(service.assertPracticeReconstructionReady(), /reconstruction is locked|REFERENCE_PLAN_REQUIRED|Command failed|Footage browsing failed|Failed to open/gi);
  await writeState([direct], ["shot:1", "shot:2"]);
  await assert.rejects(service.assertPracticeReconstructionReady(), /reconstruction is locked|REFERENCE_PLAN_REQUIRED|Command failed|Footage browsing failed|Failed to open/gi);
  await writeState([direct, direct]); await assert.rejects(service.assertPracticeReconstructionReady(), /reconstruction is locked|REFERENCE_PLAN_REQUIRED|Command failed|Footage browsing failed|Failed to open/gi);
  await writeState([{ ...direct, confidence: .7 }]); await assert.rejects(service.assertPracticeReconstructionReady(), /reconstruction is locked|REFERENCE_PLAN_REQUIRED|Command failed|Footage browsing failed|Failed to open/gi);
  await writeState([direct]); await assert.rejects(service.assertPracticeReconstructionReady());
});
