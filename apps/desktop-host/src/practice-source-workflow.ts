import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { capabilityForCommandV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { CurrentAeTransactionRuntimeV1 } from "./current-ae-transaction-runtime.js";
import type { LoopbackCepBroker } from "./loopback-cep.js";
import { SourceMatchServiceV1, sourceMatchAtomicJsonV1 as save } from "./source-match-service.js";
import { SourceMatchAssemblyV1 } from "./source-match-assembly.js";

export const PRACTICE_SOURCE_WORKFLOW_V1 = "SOURCE_MATCH_THEN_RAW_ASSEMBLY_V1";
type Input = {sessionId:string;assignmentId:string;finishPath:string;videoPaths:readonly string[];editTypeId:string};
type RecordV1 = Input & {
  state:"RUNNING"|"BLOCKED"|"COMPLETED"|"CANCELLED"|"FAILED";
  stage:string; finalSummary:string; error:string|null; completedAt:string|null;
  supervisor:{launchId:string;tabId:number|null;deliveredAt:string|null;conversationUrl:string|null;error:string|null};
  jobId:string|null; assemblyId:string|null; officialTimestampsPath:string|null;
  batchCount:number; completedBatches:number[]; inFlightBatch:number|null;
  checkpointPath:string|null; matchingSummary:unknown; unresolved:unknown;
};
type Services = {
  matcher:Pick<SourceMatchServiceV1,"submit"|"status"|"cancel"|"stop">;
  assembler:Pick<SourceMatchAssemblyV1,"prepare"|"status"|"plan"|"verifyPayload"|"cancel"|"stop">;
  runtime:Pick<CurrentAeTransactionRuntimeV1,"observe"|"execute">;
};
export interface PracticeSourceWorkflowConfigV1 {
  repositoryRoot:string; artifactDir:string; broker:LoopbackCepBroker;
  /** Internal test seam; HTTP requests cannot provide services or runtime paths. */
  services?:Services;
}
const isCancelled = (r:RecordV1) => r.state === "CANCELLED";
const terminal = (r:RecordV1) => ["COMPLETED","CANCELLED","FAILED"].includes(r.state);

/** One mechanical process. No editorial engine, learning store or generic job queue. */
export class PracticeSourceWorkflowV1 {
  #records = new Map<string,RecordV1>();
  #tail:Promise<unknown> = Promise.resolve();
  #timer:ReturnType<typeof setInterval>|null = null;
  #stopping = false;
  #advancing = false;
  readonly services:Services;
  constructor(readonly config:PracticeSourceWorkflowConfigV1) {
    const dataRoot=path.dirname(config.artifactDir);
    const common={repositoryRoot:config.repositoryRoot,artifactDir:path.join(config.artifactDir,"source-match"),
      cacheDir:path.join(dataRoot,"source-match-cache"),configPath:path.join(dataRoot,"source-match-config.json")};
    const matcher=new SourceMatchServiceV1(common);
    this.services=config.services??{matcher,assembler:new SourceMatchAssemblyV1(common,matcher),
      runtime:new CurrentAeTransactionRuntimeV1(config.broker,"editflow-source-assembly",64,null,160,new AeFilesystemPolicyV11([config.artifactDir]))};
  }
  #file(id:string) {return path.join(this.config.artifactDir,"source-workflow",id.replace(":","-"),"workflow.json");}
  async #save(r:RecordV1) {await save(this.#file(r.sessionId),r);}
  async #exclusive<T>(work:()=>Promise<T>) {const result=this.#tail.then(work);this.#tail=result.catch(()=>undefined);return result;}
  async start() {
    if(this.#timer)return;
    this.#stopping=false;
    const root=path.join(this.config.artifactDir,"source-workflow");
    await mkdir(root,{recursive:true});
    for(const name of await readdir(root)) {
      if(!/^practice-[a-f0-9-]{36}$/.test(name))continue;
      const r=JSON.parse(await readFile(path.join(root,name,"workflow.json"),"utf8")) as RecordV1;
      if(r.inFlightBatch!==null&&!terminal(r)) {
        r.state="BLOCKED";r.error="AE assembly was interrupted. Its saved receipt must be checked before another import; no batch is automatically replayed.";
        r.finalSummary=r.error;await this.#save(r);
      }
      this.#records.set(r.sessionId,r);
    }
    this.#timer=setInterval(()=>{if(!this.#stopping)void this.advance().catch(()=>undefined);},2000);
    this.#timer.unref();
  }
  async stop() {
    this.#stopping=true;if(this.#timer)clearInterval(this.#timer);this.#timer=null;
    await this.#tail;
    await this.services.assembler.stop();await this.services.matcher.stop();
  }
  async create(input:Input) {
    if(this.#records.has(input.sessionId))return;
    const r:RecordV1={...input,state:"RUNNING",stage:"SUPERVISOR_HANDOFF",completedAt:null,error:null,
      finalSummary:"Supervisor is opening the first ChatGPT session for Source Match and raw assembly.",
      supervisor:{launchId:randomUUID(),tabId:null,deliveredAt:null,conversationUrl:null,error:null},
      jobId:null,assemblyId:null,officialTimestampsPath:null,batchCount:0,completedBatches:[],inFlightBatch:null,
      checkpointPath:null,matchingSummary:null,unresolved:[]};
    await this.#save(r);this.#records.set(r.sessionId,r);
  }
  snapshot(id:string) {
    const r=this.#records.get(id);
    if(!r)return null;
    return structuredClone({state:r.state,stage:r.stage,finalSummary:r.finalSummary,error:r.error,completedAt:r.completedAt,
      workflow:PRACTICE_SOURCE_WORKFLOW_V1,steps:["SUPERVISOR_HANDOFF","SOURCE_MATCH","SAVE_EXACT_TIMESTAMPS","RAW_ASSEMBLY"],
      sourceMatch:{jobId:r.jobId,summary:r.matchingSummary,unresolved:r.unresolved,officialTimestampsPath:r.officialTimestampsPath},
      sourceAssembly:{assemblyId:r.assemblyId,batchCount:r.batchCount,completedBatches:r.completedBatches,checkpointPath:r.checkpointPath},
      supervisor:r.supervisor});
  }
  supervisorTask() {
    const r=[...this.#records.values()].find(r=>r.state==="RUNNING"&&r.stage==="SUPERVISOR_HANDOFF");
    if(!r)return null;
    return {launchId:r.supervisor.launchId,sessionId:r.sessionId,assignmentId:r.assignmentId,tabId:r.supervisor.tabId,
      prompt:this.prompt(r)};
  }
  prompt(r:Input) {
    return `EditFlow Supervisor — Practice source matching and raw assembly only.\nSession: ${r.sessionId}\nAssignment: ${r.assignmentId}\n\nUse the EditFlow Source Match Service to locate the raw movie frames used by every shot in the supplied Finished edit and save their exact source in/out timestamps. Once every full shot range is verified and saved, the service will import those raw ranges into After Effects in the same shot order as the Finished edit. Assembly runs at the raw footage's original speed and ends this Practice session.\n\nThe Supervisor queues this service-only process after delivery of these instructions. Use the EditFlow - Current Shadow connector: call resume_or_start_practice without start_json to read the already-started service process, then get_editflow_run with session_id="${r.sessionId}" to check progress. These status calls do not create another session. You coordinate tool calls and report service results only. Do not view, analyze or compare footage or images, choose source ranges, approve shots, infer timestamps, or perform editing yourself. Source Match is the sole footage analyzer. If any shot or endpoint remains unresolved, report the saved unresolved results; no AE import is allowed. Do not start effects, retiming, rendering, research, learning, another workflow or Pro Creation. Stop after raw assembly and the saved AE project checkpoint, or report a blocked result.\n\nFinished: ${JSON.stringify(r.finishPath)}\nRaw movies: ${JSON.stringify(r.videoPaths)}`;
  }
  async supervisorAck(body:Record<string,unknown>) {
    return this.#exclusive(async()=>{
      const r=[...this.#records.values()].find(r=>r.supervisor.launchId===body.launchId);
      if(!r||terminal(r)||r.state==="BLOCKED")throw new Error("STALE_SUPERVISOR_HANDOFF");
      if(body.type==="CREATED") {
        if(!Number.isInteger(body.tabId))throw new Error("SUPERVISOR_TAB_REQUIRED");
        if(r.supervisor.tabId!==null&&r.supervisor.tabId!==body.tabId)throw new Error("SUPERVISOR_TAB_CONFLICT");
        r.supervisor.tabId=body.tabId as number;
      } else if(body.type==="SENT") {
        if(r.supervisor.tabId!==body.tabId||!/^https:\/\/chatgpt\.com\//.test(String(body.conversationUrl)))throw new Error("SUPERVISOR_DELIVERY_REQUIRED");
        if(!r.supervisor.deliveredAt) {
          r.supervisor.deliveredAt=new Date().toISOString();r.supervisor.conversationUrl=String(body.conversationUrl);r.supervisor.error=null;
          r.stage="SOURCE_MATCH";r.finalSummary="Instructions delivered. EditFlow Source Match is locating every raw shot.";
        }
      } else if(body.type==="MISSING"&&!r.supervisor.deliveredAt) {
        r.supervisor.tabId=null;
      } else if(body.type==="FAILED") {
        r.supervisor.error=String(body.error??"ChatGPT delivery failed").slice(0,1000);
        r.finalSummary="Waiting for the Supervisor to deliver the first ChatGPT instructions. "+r.supervisor.error;
      } else throw new Error("INVALID_SUPERVISOR_ACK");
      await this.#save(r);return this.snapshot(r.sessionId);
    });
  }
  async request(id:string) {
    const r=this.#records.get(id);if(!r)throw new Error("PRACTICE_SOURCE_SESSION_REQUIRED");
    // A chat cannot skip or forge the Supervisor's delivery receipt.
    if(!r.supervisor.deliveredAt)throw new Error("SUPERVISOR_INSTRUCTIONS_MUST_BE_DELIVERED_FIRST");
    await this.advance();return this.snapshot(id);
  }
  async cancel(id:string) {
    const r=this.#records.get(id);if(!r)return;
    // Set this before awaiting a transaction so no subsequent batch can start.
    r.state="CANCELLED";r.completedAt=new Date().toISOString();r.finalSummary="Practice cancelled. No further matching or AE assembly will start.";
    await this.#tail;
    if(r.jobId)await this.services.matcher.cancel(r.jobId);
    if(r.assemblyId)await this.services.assembler.cancel(r.assemblyId);
    await this.#save(r);
  }
  editTypeSessions(editTypeId:string) {
    return [...this.#records.values()].filter(r=>r.editTypeId===editTypeId)
      .map(r=>({sessionId:r.sessionId,assignmentId:r.assignmentId,state:r.state}));
  }
  /** Delete only app-owned artifacts. Never follow input/report paths to user media. */
  async deleteEditType(editTypeId:string,validateOnly=false) {
    return this.#exclusive(async()=>{
      const records=[...this.#records.values()].filter(r=>r.editTypeId===editTypeId);
      if(records.some(r=>!terminal(r)))throw new Error("Cancel this Edit Type's active Practice session before deleting it.");
      const targets:string[]=[];
      const sourceRoot=path.join(this.config.artifactDir,"source-match");
      const optional=async(file:string)=>{
        try{return JSON.parse(await readFile(file,"utf8"));}
        catch(e:any){if(e.code==="ENOENT")return null;throw e;}
      };
      // Resolve and validate every owned ID before removing any data.
      for(const r of records) {
        if(!/^practice:[a-f0-9-]{36}$/.test(r.sessionId))throw new Error("Invalid saved Practice session ID.");
        const suffix=r.sessionId.split(":")[1]!;
        const matchReceipt=path.join(sourceRoot,"requests","practice-"+suffix+".json");
        const assemblyReceipt=path.join(sourceRoot,"assemblies","requests","practice-assembly-"+suffix+".json");
        const match=await optional(matchReceipt),assembly=await optional(assemblyReceipt);
        if(r.jobId&&match?.jobId&&r.jobId!==match.jobId)throw new Error("Saved Source Match ownership conflict.");
        if(r.assemblyId&&assembly?.assemblyId&&r.assemblyId!==assembly.assemblyId)throw new Error("Saved assembly ownership conflict.");
        const jobId=r.jobId??match?.jobId,assemblyId=r.assemblyId??assembly?.assemblyId;
        if(jobId) {
          if(!/^source-match-[a-f0-9-]{36}$/.test(jobId))throw new Error("Invalid saved Source Match ID.");
          const dir=path.join(sourceRoot,jobId),job=await optional(path.join(dir,"job.json"));
          if(job&&job.assignmentId!==r.assignmentId)throw new Error("Saved Source Match ownership conflict.");
          targets.push(dir);
        }
        if(assemblyId) {
          if(!/^source-assembly-[a-f0-9-]{36}$/.test(assemblyId))throw new Error("Invalid saved assembly ID.");
          const dir=path.join(sourceRoot,"assemblies",assemblyId),manifest=await optional(path.join(dir,"official-timestamps.json"));
          if(manifest&&manifest.jobId!==jobId)throw new Error("Saved assembly ownership conflict.");
          targets.push(dir);
        }
        targets.push(matchReceipt,assemblyReceipt);
      }
      if(validateOnly)return;
      for(const file of targets)await rm(file,{recursive:true,force:true});
      // Keep the ownership records until their artifacts have all been removed so a
      // persisted deletion can safely finish after a crash or filesystem error.
      for(const r of records) {
        await rm(path.dirname(this.#file(r.sessionId)),{recursive:true,force:true});
        this.#records.delete(r.sessionId);
      }
    });
  }
  async advance() {
    if(this.#advancing)return this.#tail;
    this.#advancing=true;
    try {return await this.#exclusive(async()=>{
      if(this.#stopping)return;
      for(const r of this.#records.values()) {
        if(r.state!=="RUNNING"||!r.supervisor.deliveredAt)continue;
        try {await this.#advance(r);} catch(error) {
          if(isCancelled(r))continue;
          r.state="BLOCKED";r.error=error instanceof Error?error.message:String(error);r.finalSummary="Practice stopped: "+r.error;
          await this.#save(r);
        }
      }
    });}finally{this.#advancing=false;}
  }
  async #advance(r:RecordV1) {
    if(!r.jobId) {
      const started:any=await this.services.matcher.submit({requestId:"practice-"+r.sessionId.split(":")[1],
        referencePath:r.finishPath,sourcePaths:r.videoPaths,budgetSeconds:480,assignmentId:r.assignmentId});
      r.jobId=started.job.jobId;await this.#save(r);return;
    }
    if(!r.assemblyId) {
      const match:any=await this.services.matcher.status(r.jobId);
      r.matchingSummary=match.report?.summary??null;r.unresolved=match.remaining??[];
      if(match.job.status==="RUNNING") {await this.#save(r);return;}
      if(match.job.status!=="COMPLETE")throw new Error("Source Match did not verify every full shot range. Saved results: "+match.csvPath+". "+(match.job.error??"Unresolved shots block all AE import."));
      if(isCancelled(r)||this.#stopping)return;
      const raw=match.report.sources[0];
      const result:any=await this.services.assembler.prepare({requestId:"practice-assembly-"+r.sessionId.split(":")[1],jobId:r.jobId,encoder:"CPU",
        output:{stableId:"ef-source-"+r.sessionId.split(":")[1],name:"EditFlow Practice - "+r.editTypeId+" Raw Assembly",
          width:raw.width,height:raw.height,pixelAspect:1,frameRate:raw.fps}});
      r.assemblyId=result.assembly.assemblyId;r.officialTimestampsPath=result.assembly.manifestPath;
      r.batchCount=result.assembly.batchCount;r.stage="PREPARE_RAW_SHOTS";
      r.finalSummary="All exact source ranges saved. Preparing raw clips for AE in Finished shot order.";
      await this.#save(r);return;
    }
    const {assembly}=await this.services.assembler.status(r.assemblyId);
    if(isCancelled(r)||this.#stopping)return;
    if(assembly.status==="PREPARING")return;
    if(assembly.status!=="READY")throw new Error(assembly.error??"RAW_ASSEMBLY_NOT_READY");
    const batchIndex=Array.from({length:r.batchCount},(_,i)=>i).find(i=>!r.completedBatches.includes(i));
    if(batchIndex!==undefined) {
      const baseline=await this.services.runtime.observe();
      const prepared=await this.services.assembler.plan(r.assemblyId,batchIndex,baseline,{rawPaths:[...r.videoPaths],referencePath:r.finishPath});
      await this.services.assembler.verifyPayload(prepared.payload,{rawPaths:[...r.videoPaths],referencePath:r.finishPath});
      if(isCancelled(r)||this.#stopping)return;
      r.inFlightBatch=batchIndex;r.stage="ASSEMBLE_RAW_SHOTS";r.finalSummary="Assembling saved raw shots in AE in Finished shot order.";
      await this.#save(r);
      const result=await this.services.runtime.execute(prepared.payload.plan);
      await save(path.join(path.dirname(this.#file(r.sessionId)),"batch-"+batchIndex+"-receipt.json"),result);
      if(result.state!=="COMMITTED")throw new Error(result.error??"AE_ASSEMBLY_NOT_COMMITTED");
      r.completedBatches.push(batchIndex);r.inFlightBatch=null;await this.#save(r);return;
    }
    if(isCancelled(r)||this.#stopping)return;
    const baseline=await this.services.runtime.observe();
    const checkpointPath=path.join(path.dirname(this.#file(r.sessionId)),"raw-assembly.aep");
    const planId="source-checkpoint-"+r.sessionId.split(":")[1];
    r.inFlightBatch=r.batchCount;await this.#save(r);
    const result=await this.services.runtime.execute({planId,planRevision:1,projectRevision:baseline.projectRevision,
      projectFingerprint:baseline.projectFingerprint,environmentFingerprint:baseline.environmentFingerprint,
      requiredCapabilities:[capabilityForCommandV11("project.save")],bindings:[],checkpoints:[],invariants:{structural:[],visual:[]},
      rollbackBoundaries:[{id:"checkpoint",strategy:"RESTORE_SNAPSHOT"}],operations:[{operationId:planId+"-save",capabilityId:capabilityForCommandV11("project.save"),
        routeId:"ae-cep.v1_1",dependsOn:[],idempotency:"CHECK_THEN_APPLY",riskClass:"R1_REVERSIBLE",rollbackBoundaryId:"checkpoint",
        input:{command:"project.save",payload:{path:checkpointPath}}}]});
    await save(path.join(path.dirname(this.#file(r.sessionId)),"checkpoint-receipt.json"),result);
    if(result.state!=="COMMITTED")throw new Error(result.error??"AE_CHECKPOINT_NOT_COMMITTED");
    r.checkpointPath=checkpointPath;r.inFlightBatch=null;
    if(!isCancelled(r)) {r.state="COMPLETED";r.stage="DONE";r.completedAt=new Date().toISOString();
      r.finalSummary="Every exact source range was saved and the raw shots were assembled in AE in Finished order. Practice is complete.";}
    await this.#save(r);
  }
}
