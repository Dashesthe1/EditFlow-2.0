import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const SOURCE_MATCH_CONTRACT_V1 = {
  schema: "editflow.source-match-contract.v1", version: "2.0.0", engineVersion: "2.0.0",
  authority: "EDITFLOW_SOURCE_MATCH_SERVICE", aeWrites: false,
  instructions: "Only this service analyzes Finished/raw footage. It saves exact source timestamps with machine evidence. Every shot and endpoint must be verified before assembly; incomplete or ambiguous matches block AE import. ChatGPT coordinates status only and never reviews footage.",
  exactBoundaryGuaranteed: false,
} as const;

export interface SourceMatchServiceConfigV1 {
  repositoryRoot: string; artifactDir: string; cacheDir: string; configPath: string;
  /** Test/development injection; public requests cannot choose an executable/backend. */
  runtime?: { python: string; model: string; backend?: "sscd" | "diagnostic"; device?: "cpu" | "cuda"; ffmpeg?: string };
}
type Job = { jobId: string; requestId: string; requestHash: string; status: string; createdAt: string;
  updatedAt: string; outputDir: string; assignmentId?: string; parentJobId?: string; error?: string; exitCode?: number | null };
export const sourceMatchAtomicJsonV1 = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2), {flush:true});
  for(let attempt=0;;attempt++) {
    try {await rename(temp,file);break;} catch(e:any) {
      if(process.platform!=="win32" || !["EPERM","EACCES","EBUSY"].includes(e.code) || attempt>=6)throw e;
      await new Promise(r=>setTimeout(r,20*2**attempt));
    }
  }
};
const save=sourceMatchAtomicJsonV1;
const optionalJson = async (file: string): Promise<any> => {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (e: any) { if (e.code === "ENOENT") return null; throw e; }
};
const terminate = (child:ChildProcess) => {
  if(process.platform==="win32" && child.pid)execFile("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true},()=>undefined);
  else if(child.pid) {try {process.kill(-child.pid,"SIGTERM");}catch{child.kill();}}
};

export class SourceMatchServiceV1 {
  readonly config: SourceMatchServiceConfigV1;
  #active: { child: ChildProcess; job: Job; completion: Promise<void>; cancelled?: boolean } | null = null;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(config: SourceMatchServiceConfigV1) { this.config = config; }
  async #runtime() {
    const runtime = this.config.runtime ?? await optionalJson(this.config.configPath);
    if (!runtime || typeof runtime.python !== "string" || typeof runtime.model !== "string") throw new Error("SOURCE_MATCH_NOT_INSTALLED: run scripts/source-match/install.ps1");
    for (const file of [runtime.python, runtime.model]) if (!(await stat(file)).isFile()) throw new Error("SOURCE_MATCH_RUNTIME_MISSING");
    return runtime as { python: string; model: string; backend?: string; device?: "cpu" | "cuda"; ffmpeg?: string };
  }
  async status(jobId?: string) {
    if (!jobId) {
      let ready = false, error: string | null = null;
      try { await this.#runtime(); ready = true; } catch (e: any) { error = e.message; }
      return { contract: SOURCE_MATCH_CONTRACT_V1, installed: ready, error, activeJobId: this.#active?.job.jobId ?? null };
    }
    if (!/^source-match-[a-f0-9-]{36}$/.test(jobId)) throw new Error("Invalid source-match job ID");
    const dir = path.join(this.config.artifactDir, jobId);
    const activeAtRead = this.#active?.job.jobId === jobId;
    const job = await optionalJson(path.join(dir,"job.json")) as Job | null;
    if (!job) throw new Error("SOURCE_MATCH_JOB_NOT_FOUND");
    if (job.status === "RUNNING" && !activeAtRead && this.#active?.job.jobId !== jobId) {
      job.status = "INTERRUPTED"; job.updatedAt = new Date().toISOString();
      job.error = "Service restarted; retained partial evidence/cache can be inspected. Submit a new requestId to continue search.";
      await save(path.join(dir,"job.json"),job);
    }
    const report=await optionalJson(path.join(dir,"report.json"));
    const remaining=report?.shots?.filter((s:any)=>s.status!=="VERIFIED").map((s:any)=>({shotId:s.shotId,status:s.status,reason:s.reason,boundaryStatus:s.boundaryStatus}));
    return {job, progress:await optionalJson(path.join(dir,"progress.json")), report, csvPath:path.join(dir,"timestamps.csv"), remaining};
  }
  refine(body:Record<string,unknown>):Promise<unknown> {
    const result=this.#tail.catch(()=>undefined).then(async()=>{
      const prior=await this.status(String(body.jobId));
      if(!prior.job)throw new Error("RETAINED_MATCH_REPORT_REQUIRED");
      if(prior.job.status==="RUNNING" || !prior.report?.reference || !prior.report?.shots?.length)throw new Error("RETAINED_MATCH_REPORT_REQUIRED");
      const original=await optionalJson(path.join(prior.job.outputDir,"request.json"));
      const shotIds=body.shotIds ?? prior.report.shots.filter((s:any)=>s.status!=="VERIFIED").map((s:any)=>s.shotId);
      if(!Array.isArray(shotIds)||!shotIds.length||new Set(shotIds).size!==shotIds.length||shotIds.some(id=>!prior.report.shots.some((s:any)=>s.shotId===id)))throw new Error("REFINE_SHOT_IDS_REQUIRED");
      const windows=body.windows ?? [];
      if(!Array.isArray(windows)||windows.length>200||windows.some((w:any)=>!shotIds.includes(w?.shotId)||!Number.isInteger(w.sourceIndex)||!prior.report.sources[w.sourceIndex]||!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<=w.start||w.end>prior.report.sources[w.sourceIndex].duration||w.end-w.start>120))throw new Error("INVALID_REFINEMENT_WINDOWS");
      return this.#submit({requestId:body.requestId,referencePath:original.referencePath,sourcePaths:original.sourcePaths,
        shots:prior.report.shots.map((s:any)=>({start:s.referenceStart,end:s.referenceEnd})),budgetSeconds:body.budgetSeconds??480,
        candidateLimit:body.candidateLimit??4,assignmentId:prior.job.assignmentId}, {jobId:prior.job.jobId,report:prior.report,shotIds,windows});
    });
    this.#tail=result;return result;
  }
  importTimeline(body:Record<string,unknown>):Promise<unknown> {
    const result=this.#tail.catch(()=>undefined).then(async()=>{
      const prior=await this.status(String(body.jobId));
      if(!prior.job || prior.job.status==="RUNNING" || !prior.report?.reference || !prior.report?.shots?.length)throw new Error("RETAINED_MATCH_REPORT_REQUIRED");
      if(typeof body.timelinePath!=="string")throw new Error("ORIGINAL_TIMELINE_PATH_REQUIRED");
      const timelinePath=path.resolve(body.timelinePath),info=await stat(timelinePath);
      if(!info.isFile() || info.size>32*1024*1024)throw new Error("ORIGINAL_TIMELINE_FILE_REQUIRED_MAX_32MB");
      const timelineSha256=createHash("sha256").update(await readFile(timelinePath)).digest("hex");
      const original=await optionalJson(path.join(prior.job.outputDir,"request.json"));
      return this.#submit({requestId:body.requestId,referencePath:original.referencePath,sourcePaths:original.sourcePaths,
        shots:prior.report.shots.map((s:any)=>({start:s.referenceStart,end:s.referenceEnd})),budgetSeconds:body.budgetSeconds??480,
        assignmentId:prior.job.assignmentId}, {jobId:prior.job.jobId,report:prior.report,shotIds:[],windows:[]},{timelinePath,timelineSha256});
    });
    this.#tail=result;return result;
  }
  submit(body: Record<string, unknown>): Promise<unknown> {
    const result = this.#tail.catch(() => undefined).then(() => this.#submit(body));
    this.#tail = result; return result;
  }
  async #submit(body: Record<string, unknown>, refinement?:{jobId:string;report:any;shotIds:any[];windows:any[]}, timeline?:{timelinePath:string;timelineSha256:string}) {
    if (typeof body.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(body.requestId)) throw new Error("A stable requestId is required");
    if (typeof body.referencePath !== "string" || !Array.isArray(body.sourcePaths) || body.sourcePaths.length < 1 || body.sourcePaths.length > 8 || body.sourcePaths.some(p => typeof p !== "string")) throw new Error("Provide referencePath and one through eight sourcePaths");
    const budget = body.budgetSeconds ?? 480;
    if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 10 || budget > 3600) throw new Error("budgetSeconds must be 10 through 3600");
    const shots = body.shots;
    if (shots !== undefined && (!Array.isArray(shots) || shots.length === 0 || shots.length > 200 || shots.some((s: any, i: number) => !s || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start || (i > 0 && s.start < (shots[i-1] as any).end)))) throw new Error("shots must be ordered non-overlapping {start,end} ranges in seconds");
    const candidateLimit = body.candidateLimit ?? 4;
    if (!Number.isInteger(candidateLimit) || (candidateLimit as number)<1 || (candidateLimit as number)>12) throw new Error("candidateLimit must be 1 through 12");
    if(body.assignmentId!==undefined && (typeof body.assignmentId!=="string"||!/^gpt-assignment:[a-f0-9-]{36}$/.test(body.assignmentId)))throw new Error("Invalid assignmentId");
    const request = { referencePath: path.resolve(body.referencePath), sourcePaths: (body.sourcePaths as string[]).map(p=>path.resolve(p)), budgetSeconds: budget, candidateLimit, ...(shots ? { shots } : {}),
      ...(refinement?{refinement:{parentJobId:refinement.jobId,shotIds:refinement.shotIds,windows:refinement.windows,reportSha256:createHash("sha256").update(JSON.stringify(refinement.report,null,2)).digest("hex")}}:{}),...(timeline??{}) };
    const identities=[];
    for (const file of [request.referencePath, ...request.sourcePaths]) {
      const info=await stat(file); if (!info.isFile()) throw new Error("Matching inputs must be local video files");
      identities.push({file,size:info.size,mtimeMs:info.mtimeMs});
    }
    const hash = createHash("sha256").update(JSON.stringify({version:SOURCE_MATCH_CONTRACT_V1.version,request,identities,assignmentId:body.assignmentId})).digest("hex");
    const receipt = path.join(this.config.artifactDir, "requests", body.requestId + ".json");
    const existing = await optionalJson(receipt);
    if (existing) {
      const legacyHash=!refinement && body.assignmentId===undefined
        ? createHash("sha256").update(JSON.stringify({version:"1.0.0",request,identities})).digest("hex") : null;
      if (existing.requestHash !== hash && existing.requestHash!==legacyHash) throw new Error("SOURCE_MATCH_REQUEST_CONFLICT");
      return await this.status(existing.jobId);
    }
    if (this.#active) throw new Error("SOURCE_MATCH_BUSY: GPU work is bounded to one job; poll the active job");
    const runtime = await this.#runtime();
    const id = "source-match-" + randomUUID(), dir = path.join(this.config.artifactDir,id);
    const now = new Date().toISOString();
    const job: Job = { jobId:id, requestId:body.requestId, requestHash:hash, status:"RUNNING", createdAt:now, updatedAt:now, outputDir:dir,
      ...(body.assignmentId?{assignmentId:String(body.assignmentId)}:{}),...(refinement?{parentJobId:refinement.jobId}:{}) };
    await save(path.join(dir,"request.json"),request);
    if(refinement)await save(path.join(dir,"resume-report.json"),refinement.report);
    await save(path.join(dir,"job.json"),job);
    await save(receipt,{jobId:id,requestHash:hash});
    const args=["-I",path.join(this.config.repositoryRoot,"scripts","source-match",timeline?"timeline_evidence.py":"engine.py"),"--request",path.join(dir,"request.json"),"--output",dir,
      ...(!timeline?["--cache",this.config.cacheDir,"--model",runtime.model,"--backend",runtime.backend ?? "sscd","--device",runtime.device ?? (runtime.backend === "diagnostic" ? "cpu" : "cuda")]:[])];
    const child = spawn(runtime.python,args, { windowsHide:true, detached:process.platform!=="win32", stdio:["ignore","pipe","pipe"] });
    let finish!: () => void;
    const completion = new Promise<void>(resolve=>{finish=resolve;});
    this.#active={child,job,completion};
    let stderr="", error: Error | null = null;
    child.stdout?.on("data",()=> { /* engine persists atomic progress; drain pipe */ });
    child.stderr?.on("data",chunk=>{ stderr=(stderr+chunk.toString()).slice(-6000); });
    child.on("error",e=>{ error=e; });
    const timer=setTimeout(()=>{ error=new Error("SOURCE_MATCH_PROCESS_TIMEOUT");terminate(child); },(budget+60)*1000);
    child.on("close",code=> { void (async()=>{
      clearTimeout(timer);
      const report=await optionalJson(path.join(dir,"report.json"));
      job.status=this.#active?.cancelled ? "CANCELLED" : error || code !== 0 ? "FAILED" : report?.status ?? "FAILED";
      job.updatedAt=new Date().toISOString();job.exitCode=code;
      if (error || code !== 0) job.error=error?.message ?? stderr;
      await save(path.join(dir,"job.json"),job);
      if (this.#active?.job.jobId===id) this.#active=null;
    })().catch(async e=>{job.status="FAILED";job.error=String(e);await save(path.join(dir,"job.json"),job);this.#active=null;}).finally(finish); });
    return { job, contract:SOURCE_MATCH_CONTRACT_V1 };
  }
  async cancel(jobId: string) {
    const result = await this.status(jobId);
    const active=this.#active?.job.jobId===jobId?this.#active:null;
    if(active) {
      active.cancelled=true;
      await writeFile(path.join(active.job.outputDir,"cancel"),"User requested cancellation");
      terminate(active.child);await active.completion;
    }
    return { ...await this.status(jobId), cancellationRequested: active!==null };
  }
  async stop() {
    if (this.#active) { const active=this.#active; await writeFile(path.join(active.job.outputDir,"cancel"),"Service shutdown"); terminate(active.child); await active.completion; }
  }
}
