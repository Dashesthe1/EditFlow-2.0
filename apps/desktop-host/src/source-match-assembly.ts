import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { capabilityForCommandV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { SourceMatchServiceV1, type SourceMatchServiceConfigV1 } from "./source-match-service.js";

export const SOURCE_ASSEMBLY_CONTRACT_V1 = {
  schema: "editflow.source-assembly-contract.v1", version: "1.0.0",
  actions: ["PREPARE_ASSEMBLY", "ASSEMBLY_STATUS", "ASSEMBLY_PLAN"],
  targetSeconds: 300, targetMeasured: false, order: "FINISHED_REFERENCE_ORDER",
  gate: "Complete saved source endpoints and direct GPT review of every shot; no partial assembly.",
  execution: "Saved official timestamps -> bounded clips -> existing durable AE_TRANSACTION queue -> AEP checkpoint",
  timing: "Contiguous original-speed source ranges. Reference retiming/effects remain explicit GPT editing steps.",
  workingCodecs: "CPU: 10-bit ProRes 422 HQ (recommended for 10-bit source); NVENC: 8-bit H.264 QP10 (explicit precision reduction). Originals retained.",
  instructions: "PREPARE_ASSEMBLY needs requestId,jobId,encoder:NVENC|CPU,output:{stableId,name,width,height,pixelAspect,frameRate},review:{authority:CHATGPT_DIRECT,decisionId,rationale,shots:[{shotId,verdict:PASS,observation,evidenceRefs}]}. Save all verified endpoints before decoding. Poll assemblyId. ASSEMBLY_PLAN needs assemblyId,assignmentId,batchIndex; enqueue its exact payload as AE_TRANSACTION with this chat's current researchContext. Every prior assembly batch must succeed before requesting the next. Paused production is never resumed by this service.",
} as const;

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
    || report.shots.some((s: any)=>s.status!=="VERIFIED" || s.boundaryStatus!=="MEASURED_ENDPOINT_CORRESPONDENCES"
      || !Number.isFinite(s.sourceStart) || !Number.isFinite(s.sourceEndExclusive) || s.sourceStart<0 || s.sourceEndExclusive<=s.sourceStart)) {
    throw new Error("ALL_SHOT_ENDPOINTS_REQUIRED: save and verify every full-shot source range before assembly");
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
      sourceAnchors:s.anchors,referenceAlignment:s.alignment};
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

export class SourceMatchAssemblyV1 {
  #active: {assemblyId:string;child:ChildProcess;completion:Promise<void>} | null=null;
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
      clearTimeout(timer);state.status=code===0&&!error?"READY":"FAILED";state.updatedAt=new Date().toISOString();
      if(state.status==="READY") {
        const media=await json(path.join(dir,"materialized.json"));
        sourceAssemblyCommandsV1(manifest,media,0);
        state.mediaSha256=digest(media);state.extractionSeconds=media.extractionSeconds;
        state.clipIdentities=[];
        for (const cut of media.shots) {const info=await stat(cut.workingPath);state.clipIdentities.push({path:cut.workingPath,size:info.size,mtimeMs:info.mtimeMs});}
      }
      else state.error=error?.message ?? stderr;
      await save(path.join(dir,"state.json"),state);
    })().catch(async e=>{state.status="FAILED";state.error=String(e);await save(path.join(dir,"state.json"),state);})
      .finally(()=>{this.#active=null;finish();});});
    return {assembly:state,contract:SOURCE_ASSEMBLY_CONTRACT_V1};
  }
  async status(assemblyId:string) {
    const dir=this.#dir(assemblyId),assembly=await json(path.join(dir,"state.json"));
    if(assembly.status==="PREPARING" && this.#active?.assemblyId!==assemblyId) {
      assembly.status="INTERRUPTED";assembly.error="Preparation interrupted; no AE imports were issued. Use a new requestId.";
      await save(path.join(dir,"state.json"),assembly);
    }
    return {assembly,contract:SOURCE_ASSEMBLY_CONTRACT_V1};
  }
  async #ready(assemblyId:string) {
    const {assembly}=await this.status(assemblyId);
    if(assembly.status!=="READY") throw new Error("SOURCE_ASSEMBLY_NOT_READY");
    const dir=this.#dir(assemblyId),manifest=await json(path.join(dir,"official-timestamps.json")),media=await json(path.join(dir,"materialized.json"));
    if(digest(manifest)!==assembly.manifestSha256 || digest(media)!==assembly.mediaSha256) throw new Error("SAVED_ASSEMBLY_CHANGED");
    const retained=await this.matcher.status(manifest.jobId);
    if(retained.job?.status!=="COMPLETE" || digest(retained.report)!==manifest.reportSha256) throw new Error("MATCH_REPORT_CHANGED");
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
