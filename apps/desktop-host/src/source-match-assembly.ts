import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { capabilityForCommandV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { SourceMatchServiceV1, type SourceMatchServiceConfigV1 } from "./source-match-service.js";

export const SOURCE_ASSEMBLY_CONTRACT_V1 = {
  schema: "editflow.source-assembly-contract.v1", version: "1.1.0",
  actions: ["PREPARE_ASSEMBLY", "ASSEMBLY_STATUS", "ASSEMBLY_PLAN", "CANCEL_ASSEMBLY", "RESUME_ASSEMBLY"],
  targetSeconds: 300, targetMeasured: false, order: "FINISHED_REFERENCE_ORDER",
  gate: "Complete saved source endpoints and direct GPT review of every shot; no partial assembly.",
  execution: "Saved official timestamps -> bounded clips -> existing durable AE_TRANSACTION queue -> AEP checkpoint",
  timing: "Contiguous original-speed source ranges. Reference retiming/effects remain explicit GPT editing steps.",
  workingCodecs: "CPU: 10-bit ProRes 422 HQ (recommended for 10-bit source); NVENC: 8-bit H.264 QP10 (explicit precision reduction). Originals retained.",
  instructions: "PREPARE_ASSEMBLY needs requestId,jobId,encoder:NVENC|CPU,output:{stableId,name,width,height,pixelAspect,frameRate},review:{authority:CHATGPT_DIRECT,decisionId,rationale,shots:[{shotId,verdict:PASS,observation,evidenceRefs}]}. Save all verified endpoints before decoding. Poll assemblyId. ASSEMBLY_PLAN needs assemblyId,assignmentId,batchIndex; enqueue its exact payload as AE_TRANSACTION with this chat's current researchContext. Every prior assembly batch must succeed before requesting the next. Paused production is never resumed by this service.",
  recovery: "RESUME_ASSEMBLY {assemblyId} continues FAILED, INTERRUPTED or explicitly CANCELLED extraction using the same immutable official receipt. Completed cuts reuse verified per-clip receipts after identity checks. READY/PREPARING retries return the retained state. No AE replay or production resume. Original-project metadata boundaries require their unchanged project/export evidence as well as GPT review.",
} as const;

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileDigest = async (file:string) => { const h=createHash("sha256");for await(const chunk of createReadStream(file))h.update(chunk);return h.digest("hex"); };
const timelineProof = async (shots:readonly any[]) => {
  const checked=new Map<string,string>();
  for(const shot of shots) {
    const proof=shot.originalTimelineEvidence;
    if(!proof)continue;
    for(const [file,sha] of [[proof.projectPath,proof.projectSha256],[proof.timelinePath,proof.timelineSha256]]) {
      if(checked.has(file)){if(checked.get(file)!==sha)throw new Error("ORIGINAL_TIMELINE_EVIDENCE_CONFLICT");continue;}
      if(await fileDigest(file)!==sha)throw new Error("ORIGINAL_TIMELINE_EVIDENCE_CHANGED");checked.set(file,sha);
    }
  }
};
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const save = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), {recursive:true});
  const temp=file+"."+randomUUID()+".tmp";
  await writeFile(temp,JSON.stringify(value,null,2),{flush:true}); await rename(temp,file);
};
const id = (value: any, prefix: string) => {
  if (typeof value!=="string" || !new RegExp("^"+prefix+"-[a-f0-9-]{36}$").test(value)) throw new Error("Invalid "+prefix+" ID");
  return value;
};
const text = (value: any) => typeof value==="string" && value.trim().length>0;
const terminate = (child: ChildProcess) => {
  if (process.platform === "win32" && child.pid) execFile("taskkill", ["/PID",String(child.pid),"/T","/F"],{windowsHide:true},()=>undefined);
  else if (child.pid) { try {process.kill(-child.pid,"SIGTERM");} catch {child.kill();} }
};

/** Full-report gate; endpoint status alone never confers GPT acceptance. */
export function officialSourceTimestampsV1(report: any, body: any) {
  if (report?.schema!=="editflow.source-match-report.v1" || report.status!=="COMPLETE"
    || report.alternativeReviewComplete!==true || !Array.isArray(report.shots) || !report.shots.length
    || report.shots.some((s: any)=>s.status!=="VERIFIED" || !["MEASURED_ENDPOINT_CORRESPONDENCES","ORIGINAL_TIMELINE_FRAME_MAP"].includes(s.boundaryStatus)
      || !Number.isFinite(s.sourceStart) || !Number.isFinite(s.sourceEndExclusive) || s.sourceStart<0 || s.sourceEndExclusive<=s.sourceStart)) {
    throw new Error("ALL_SHOT_ENDPOINTS_REQUIRED: save and verify every full-shot source range before assembly");
  }
  for(const shot of report.shots.filter((s:any)=>s.boundaryStatus==="ORIGINAL_TIMELINE_FRAME_MAP")) {
    const p=shot.originalTimelineEvidence;
    if(p?.kind!=="ORIGINAL_EDIT_PROJECT_EXPORT" || !Number.isInteger(p.recheckedPixelAnchors) || p.recheckedPixelAnchors<3
      || !Number.isInteger(p.referenceFrameCount) || p.referenceFrameCount<3 || !text(p.projectPath) || !text(p.timelinePath)
      || !/^[a-f0-9]{64}$/.test(p.projectSha256??"") || !/^[a-f0-9]{64}$/.test(p.timelineSha256??"")
      || !Array.isArray(shot.originalTimelineFrameMap) || shot.originalTimelineFrameMap.length!==p.referenceFrameCount)
      throw new Error("ORIGINAL_TIMELINE_FRAME_PROOF_REQUIRED");
  }
  const review=body.review;
  if (review?.authority!=="CHATGPT_DIRECT" || !text(review.decisionId) || !text(review.rationale)
    || !Array.isArray(review.shots) || review.shots.length!==report.shots.length
    || new Set(review.shots.map((s: any)=>s.shotId)).size!==report.shots.length
    || review.shots.some((s: any)=>s.verdict!=="PASS" || !text(s.observation) || !Array.isArray(s.evidenceRefs)
      || !s.evidenceRefs.length || s.evidenceRefs.some((e: any)=>!text(e)))) throw new Error("ALL_SHOTS_GPT_REVIEW_REQUIRED");
  const out=body.output;
  if (!out || !/^[A-Za-z0-9_-]{1,100}$/.test(out.stableId ?? "") || !text(out.name)
    || !Number.isInteger(out.width) || out.width<4 || out.width>30000
    || !Number.isInteger(out.height) || out.height<4 || out.height>30000
    || !Number.isFinite(out.pixelAspect) || out.pixelAspect<.01 || out.pixelAspect>100
    || !Number.isFinite(out.frameRate) || out.frameRate<1 || out.frameRate>120) throw new Error("EXPLICIT_ASSEMBLY_COMPOSITION_REQUIRED");
  if (!["CPU","NVENC"].includes(body.encoder)) throw new Error("Choose encoder CPU or NVENC explicitly");
  const seen=new Set();
  let previous=-1;
  const shots=report.shots.map((s: any,order: number)=>{
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(s.shotId ?? "") || seen.has(s.shotId)
      || !Number.isFinite(s.referenceStart) || !Number.isFinite(s.referenceEnd)
      || s.referenceStart<previous || s.referenceEnd<=s.referenceStart
      || !review.shots.some((r: any)=>r.shotId===s.shotId)) throw new Error("INVALID_FINISHED_SHOT_ORDER");
    seen.add(s.shotId); previous=s.referenceEnd;
    const source=report.sources?.find((p: any)=>p.path===s.sourcePath);
    if (!source || source.path===report.reference?.path || !text(source.fingerprint)
      || s.sourceEndExclusive>source.duration+.000002) throw new Error("RAW_SOURCE_IDENTITY_REQUIRED");
    return {order,shotId:s.shotId,referenceStart:s.referenceStart,referenceEnd:s.referenceEnd,
      sourcePath:s.sourcePath,sourceStart:s.sourceStart,sourceEndExclusive:s.sourceEndExclusive,
      sourceAnchors:s.anchors,referenceAlignment:s.alignment,boundaryStatus:s.boundaryStatus,
      ...(s.originalTimelineEvidence?{originalTimelineEvidence:s.originalTimelineEvidence,originalTimelineFrameMap:s.originalTimelineFrameMap}:{})};
  });
  if (Math.abs(shots[0].referenceStart)>.001 || !Number.isFinite(report.reference?.duration)
    || Math.abs(shots.at(-1).referenceEnd-report.reference.duration)>.001
    || shots.some((s:any,i:number)=>i>0 && Math.abs(s.referenceStart-shots[i-1].referenceEnd)>.001)) {
    throw new Error("COMPLETE_REFERENCE_COVERAGE_REQUIRED");
  }
  return {schema:"editflow.official-source-timestamps.v1",jobId:body.jobId,reportSha256:digest(report),
    savedAt:new Date().toISOString(),timestampConvention:report.timestampConvention,
    sources:report.sources,reference:report.reference,shots,review,output:out,encoder:body.encoder};
}

export function sourceAssemblyCommandsV1(manifest: any, media: any, batchIndex: number) {
  const count=Math.ceil(manifest.shots.length/21);
  if (!Number.isInteger(batchIndex) || batchIndex<0 || batchIndex>=count) throw new Error("Invalid assembly batchIndex");
  if (media.shots.length!==manifest.shots.length) throw new Error("INCOMPLETE_ASSEMBLY_MEDIA");
  const commands: any[]=[];
  const comp={stableId:manifest.output.stableId};
  const total=manifest.shots.reduce((n: number,s: any)=>n+s.sourceEndExclusive-s.sourceStart,0);
  if (batchIndex===0) commands.push(["comp.create",{...manifest.output,duration:total}]);
  let cursor=0;
  for (let index=0;index<manifest.shots.length;index++) {
    const shot=manifest.shots[index], cut=media.shots[index];
    if (cut.shotId!==shot.shotId || cut.sourceStart!==shot.sourceStart || cut.sourceEndExclusive!==shot.sourceEndExclusive
      || cut.sourcePath!==shot.sourcePath || !text(cut.workingPath) || cut.workingPath===shot.sourcePath) throw new Error("ASSEMBLY_MEDIA_IDENTITY_MISMATCH");
    const duration=shot.sourceEndExclusive-shot.sourceStart;
    if (index>=batchIndex*21 && index<(batchIndex+1)*21) {
      const item={stableId:manifest.output.stableId+"-source-"+index};
      const layer={stableId:manifest.output.stableId+"-shot-"+index};
      commands.push(["media.import",{...item,path:cut.workingPath}],
        ["layer.add_media",{...layer,comp,item,duration}],
        ["layer.set_timing",{comp,layer,timing:{startTime:cursor,inPoint:cursor,outPoint:cursor+duration,stretch:100}}]);
    }
    cursor+=duration;
  }
  return {commands,batchCount:count,totalDuration:total};
}

/** Resume from queue receipts, not from a still-READY extraction receipt. */
export function sourceAssemblyProgressV1(assembly:any,jobs:readonly any[]) {
  if(!assembly)return null;
  const batches=jobs.filter(j=>j.payload?.sourceAssembly?.assemblyId===assembly.assemblyId)
    .map(j=>({batchIndex:j.payload.sourceAssembly.batchIndex,jobId:j.jobId,status:j.status}));
  const nextBatchIndex=Array.from({length:assembly.batchCount},(_,i)=>i).find(i=>!batches.some(b=>b.batchIndex===i&&b.status==="SUCCEEDED"));
  return {...assembly,batches,nextBatchIndex:nextBatchIndex??null,
    status:assembly.status==="READY"&&nextBatchIndex===undefined?"ASSEMBLED":assembly.status};
}

export class SourceMatchAssemblyV1 {
  #active: {assemblyId:string;child:ChildProcess;completion:Promise<void>;cancelled?:boolean} | null=null;
  #tail: Promise<any>=Promise.resolve();
  constructor(readonly config:SourceMatchServiceConfigV1,readonly matcher:SourceMatchServiceV1) {}
  #dir(assemblyId:string) { return path.join(this.config.artifactDir,"assemblies",id(assemblyId,"source-assembly")); }
  prepare(body: any) {
    const result=this.#tail.catch(()=>undefined).then(()=>this.#prepare(body)); this.#tail=result; return result;
  }
  async #prepare(body: any) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(body.requestId ?? "")) throw new Error("A stable requestId is required");
    const match=await this.matcher.status(id(body.jobId,"source-match"));
    if (match.job?.status!=="COMPLETE") throw new Error("ALL_SHOT_ENDPOINTS_REQUIRED: matching is incomplete");
    const manifest=officialSourceTimestampsV1(match.report,body);
    await timelineProof(manifest.shots);
    const requestHash=digest({jobId:body.jobId,reportSha256:manifest.reportSha256,review:body.review,output:body.output,encoder:body.encoder});
    const receiptFile=path.join(this.config.artifactDir,"assemblies","requests",body.requestId+".json");
    let prior;
    try { prior=await json(receiptFile); } catch(e:any) { if(e.code!=="ENOENT") throw e; }
    if(prior) {
      if(prior.requestHash!==requestHash) throw new Error("SOURCE_ASSEMBLY_REQUEST_CONFLICT");
      return this.status(prior.assemblyId);
    }
    if(this.#active) throw new Error("SOURCE_ASSEMBLY_BUSY");
    const runtime=this.config.runtime ?? await json(this.config.configPath);
    if (!text(runtime.python)) throw new Error("SOURCE_MATCH_NOT_INSTALLED");
    const assemblyId="source-assembly-"+randomUUID(),dir=this.#dir(assemblyId);
    // This durable official receipt precedes EVERY extraction and AE operation.
    await save(path.join(dir,"official-timestamps.json"),manifest);
    const identities=[];
    for(const source of [...manifest.sources,manifest.reference]) {
      const info=await stat(source.path); identities.push({path:source.path,size:info.size,mtimeMs:info.mtimeMs});
    }
    const state:any={assemblyId,requestHash,status:"PREPARING",createdAt:new Date().toISOString(),
      manifestSha256:digest(manifest),identities,manifestPath:path.join(dir,"official-timestamps.json"),batchCount:Math.ceil(manifest.shots.length/21)};
    await save(path.join(dir,"state.json"),state);await save(receiptFile,{assemblyId,requestHash});
    return this.#launch(dir,state,manifest,runtime);
  }
  resume(assemblyId:string) {
    const result=this.#tail.catch(()=>undefined).then(async()=>{
      const {assembly}=await this.status(assemblyId);
      if(["READY","PREPARING"].includes(assembly.status))return this.status(assemblyId);
      if(!["FAILED","INTERRUPTED","CANCELLED"].includes(assembly.status))throw new Error("SOURCE_ASSEMBLY_NOT_RESUMABLE");
      if(this.#active)throw new Error("SOURCE_ASSEMBLY_BUSY");
      const dir=this.#dir(assemblyId),manifest=await json(path.join(dir,"official-timestamps.json"));
      if(digest(manifest)!==assembly.manifestSha256)throw new Error("SAVED_ASSEMBLY_CHANGED");
      const match=await this.matcher.status(manifest.jobId);
      if(match.job?.status!=="COMPLETE" || digest(match.report)!==manifest.reportSha256)throw new Error("MATCH_REPORT_CHANGED");
      await timelineProof(manifest.shots);
      for(const identity of assembly.identities){const info=await stat(identity.path);if(info.size!==identity.size||info.mtimeMs!==identity.mtimeMs)throw new Error("SOURCE_CHANGED_SINCE_OFFICIAL_TIMESTAMPS");}
      const runtime=this.config.runtime??await json(this.config.configPath);
      assembly.status="PREPARING";assembly.resumeCount=(assembly.resumeCount??0)+1;assembly.updatedAt=new Date().toISOString();delete assembly.error;
      await save(path.join(dir,"state.json"),assembly);
      return this.#launch(dir,assembly,manifest,runtime);
    });
    this.#tail=result;return result;
  }
  async #launch(dir:string,state:any,manifest:any,runtime:any) {
    const assemblyId=state.assemblyId;
    const ffmpeg=(runtime as any).ffmpeg;
    if (!text(ffmpeg)) {state.status="FAILED";state.error="SOURCE_ASSEMBLY_FFMPEG_REQUIRED";await save(path.join(dir,"state.json"),state);return this.status(assemblyId);}
    const child=spawn(runtime.python,["-I",path.join(this.config.repositoryRoot,"scripts","source-match","assemble_ranges.py"),
      "--manifest",state.manifestPath,"--ffmpeg",ffmpeg],{windowsHide:true,detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});
    let finish!:()=>void;const completion=new Promise<void>(r=>{finish=r;});
    this.#active={assemblyId,child,completion};
    let stderr="",error:Error|null=null;
    child.stdout?.on("data",()=>undefined);child.stderr?.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
    child.once("error",e=>{error=e;});
    const timer=setTimeout(()=>{error=new Error("SOURCE_ASSEMBLY_PREPARATION_TIMEOUT");terminate(child);},20*60*1000);
    child.once("close",code=>{void(async()=>{
      clearTimeout(timer);state.status=this.#active?.cancelled?"CANCELLED":code===0&&!error?"READY":"FAILED";state.updatedAt=new Date().toISOString();
      if(state.status==="READY") {
        const media=await json(path.join(dir,"materialized.json"));
        sourceAssemblyCommandsV1(manifest,media,0);
        state.mediaSha256=digest(media);state.extractionSeconds=media.extractionSeconds;state.reusedVerifiedClips=media.reusedVerifiedClips??0;
        state.clipIdentities=[];
        for (const cut of media.shots) {const info=await stat(cut.workingPath);state.clipIdentities.push({path:cut.workingPath,size:info.size,mtimeMs:info.mtimeMs});}
      }
      else state.error=state.status==="CANCELLED"?"User cancelled media preparation; retained official timestamps, no AE writes.":error?.message ?? stderr;
      await save(path.join(dir,"state.json"),state);
    })().catch(async e=>{state.status="FAILED";state.error=String(e);await save(path.join(dir,"state.json"),state);})
      .finally(()=>{this.#active=null;finish();});});
    return {assembly:state,contract:SOURCE_ASSEMBLY_CONTRACT_V1};
  }
  async status(assemblyId:string) {
    const activeAtRead=this.#active?.assemblyId===assemblyId;
    const dir=this.#dir(assemblyId),assembly=await json(path.join(dir,"state.json"));
    if(assembly.status==="PREPARING" && !activeAtRead && this.#active?.assemblyId!==assemblyId) {
      assembly.status="INTERRUPTED";assembly.error="Preparation interrupted; use RESUME_ASSEMBLY with this assemblyId to retain verified cuts and official timestamps.";
      await save(path.join(dir,"state.json"),assembly);
    }
    return {assembly,contract:SOURCE_ASSEMBLY_CONTRACT_V1};
  }
  async forMatch(jobId:string) {
    let entries:string[];
    try {entries=await readdir(path.join(this.config.artifactDir,"assemblies"));}catch(e:any){if(e.code==="ENOENT")return null;throw e;}
    const matches=[];
    for(const entry of entries.filter(n=>/^source-assembly-[a-f0-9-]{36}$/.test(n))) {
      try {
        const dir=this.#dir(entry),manifest=await json(path.join(dir,"official-timestamps.json"));
        if(manifest.jobId===jobId)matches.push((await this.status(entry)).assembly);
      }catch(e:any){if(e.code!=="ENOENT")throw e;}
    }
    return matches.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]??null;
  }
  async cancel(assemblyId:string) {
    const retained=await this.status(assemblyId),active=this.#active;
    const cancellationRequested=active?.assemblyId===assemblyId;
    if(cancellationRequested) {active.cancelled=true;await save(path.join(this.#dir(assemblyId),"cancellation.json"),{requestedAt:new Date().toISOString()});terminate(active.child);}
    return {...retained,cancellationRequested};
  }
  async #ready(assemblyId:string) {
    const {assembly}=await this.status(assemblyId);
    if(assembly.status!=="READY") throw new Error("SOURCE_ASSEMBLY_NOT_READY");
    const dir=this.#dir(assemblyId),manifest=await json(path.join(dir,"official-timestamps.json")),media=await json(path.join(dir,"materialized.json"));
    if(digest(manifest)!==assembly.manifestSha256 || digest(media)!==assembly.mediaSha256) throw new Error("SAVED_ASSEMBLY_CHANGED");
    const retained=await this.matcher.status(manifest.jobId);
    if(retained.job?.status!=="COMPLETE" || digest(retained.report)!==manifest.reportSha256) throw new Error("MATCH_REPORT_CHANGED");
    await timelineProof(manifest.shots);
    for(const identity of assembly.identities) {
      const info=await stat(identity.path);if(info.size!==identity.size || info.mtimeMs!==identity.mtimeMs) throw new Error("SOURCE_CHANGED_SINCE_OFFICIAL_TIMESTAMPS");
    }
    for(const cut of assembly.clipIdentities) {
      const info=await stat(cut.path);if(!info.isFile() || !info.size || info.size!==cut.size || info.mtimeMs!==cut.mtimeMs) throw new Error("ASSEMBLY_CLIP_CHANGED_OR_MISSING");
    }
    return {assembly,manifest,media};
  }
  async plan(assemblyId:string,batchIndex:number,baseline:any,allowed:{rawPaths:string[];referencePath?:string}) {
    const {assembly,manifest,media}=await this.#ready(assemblyId);
    this.#allowed(manifest,allowed);
    const {commands,batchCount}=sourceAssemblyCommandsV1(manifest,media,batchIndex);
    const boundary="assembly-boundary",planId=assemblyId+"-batch-"+batchIndex;
    const payload={sourceAssembly:{assemblyId,manifestSha256:assembly.manifestSha256,batchIndex},
      plan:{planId,planRevision:1,projectRevision:baseline.projectRevision,projectFingerprint:baseline.projectFingerprint,
        environmentFingerprint:baseline.environmentFingerprint,requiredCapabilities:[...new Set(commands.map(([c])=>capabilityForCommandV11(c)))],
        bindings:[],checkpoints:[],invariants:{structural:[],visual:[]},rollbackBoundaries:[{id:boundary,strategy:"RESTORE_SNAPSHOT"}],
        operations:commands.map(([command,data],index)=>({operationId:planId+"-op-"+index,capabilityId:capabilityForCommandV11(command),
          routeId:"ae-cep.v1_1",dependsOn:index?[planId+"-op-"+(index-1)]:[],idempotency:"CHECK_THEN_APPLY",riskClass:"R1_REVERSIBLE",
          input:{command,payload:data},rollbackBoundaryId:boundary}))},
      editorialDecision:{authority:"CHATGPT_DIRECT",decisionId:manifest.review.decisionId+"-assembly-"+batchIndex,
        rationale:manifest.review.rationale,evidenceRefs:[assembly.manifestPath],
        steps:["Import saved verified original source ranges", "Place each range contiguously in Finished shot order", "Save and inspect the queue checkpoint"]}};
    await save(path.join(this.#dir(assemblyId),"plan-"+batchIndex+".json"),payload);
    return {kind:"AE_TRANSACTION",payload,batchCount,assemblyId};
  }
  #allowed(manifest:any,allowed:{rawPaths:string[];referencePath?:string}) {
    if(allowed.referencePath && path.resolve(allowed.referencePath)!==path.resolve(manifest.reference.path)
      || manifest.shots.some((s:any)=>!allowed.rawPaths.some(p=>path.resolve(p)===path.resolve(s.sourcePath)))) throw new Error("ASSIGNMENT_RAW_SOURCES_REQUIRED");
  }
  async verifyPayload(payload:any,allowed:{rawPaths:string[];referencePath?:string}) {
    if(!payload.sourceAssembly) return;
    const binding=payload.sourceAssembly,{assembly,manifest,media}=await this.#ready(binding.assemblyId);
    this.#allowed(manifest,allowed);
    if(binding.manifestSha256!==assembly.manifestSha256) throw new Error("SAVED_ASSEMBLY_CHANGED");
    const expected=sourceAssemblyCommandsV1(manifest,media,binding.batchIndex).commands;
    const actual=payload.plan?.operations?.map((o:any)=>[o.input?.command,o.input?.payload]);
    if(digest(actual)!==digest(expected)) throw new Error("ASSEMBLY_PLAN_CHANGED");
  }
  async stop() { if(this.#active) {const active=this.#active;terminate(active.child);await active.completion;} }
}
