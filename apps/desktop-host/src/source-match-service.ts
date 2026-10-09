import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const SOURCE_MATCH_CONTRACT_V1 = {
  schema: "editflow.source-match-contract.v1", version: "1.0.0",
  engineVersion: "1.1.2",
  endpoint: "/v1/product/source-match", actions: ["SUBMIT", "STATUS", "CANCEL"],
  authority: "CHATGPT_DIRECT", automaticSelection: false, aeWrites: false,
  instructions: "Submit {requestId,referencePath,sourcePaths,budgetSeconds:480,shots?:[{start,end}]} once. Times are seconds. Poll jobId. Inspect report anchors and evidence; machine VERIFIED is geometric/temporal evidence, never editorial acceptance. LOCATED confirms interior source frames while full-shot endpoints remain unresolved. Use existing GPT BROWSE/SELECT for assignment acceptance. Shot detection is advisory; explicit shot ranges override it. Budget expiry returns PARTIAL/unresolved results, never invented exact timestamps. Service may run while production is paused without claiming or resuming an assignment.",
  firstRunTargetSeconds: 480, targetMeasured: false, exactBoundaryGuaranteed: false,
} as const;

export interface SourceMatchServiceConfigV1 {
  repositoryRoot: string; artifactDir: string; cacheDir: string; configPath: string;
  /** Test/development injection; public requests cannot choose an executable/backend. */
  runtime?: { python: string; model: string; backend?: "sscd" | "diagnostic"; device?: "cpu" | "cuda" };
}
type Job = { jobId: string; requestId: string; requestHash: string; status: string; createdAt: string;
  updatedAt: string; outputDir: string; error?: string; exitCode?: number | null };
const save = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, file);
};
const optionalJson = async (file: string): Promise<any> => {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (e: any) { if (e.code === "ENOENT") return null; throw e; }
};

export class SourceMatchServiceV1 {
  readonly config: SourceMatchServiceConfigV1;
  #active: { child: ChildProcess; job: Job; completion: Promise<void> } | null = null;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(config: SourceMatchServiceConfigV1) { this.config = config; }
  async #runtime() {
    const runtime = this.config.runtime ?? await optionalJson(this.config.configPath);
    if (!runtime || typeof runtime.python !== "string" || typeof runtime.model !== "string") throw new Error("SOURCE_MATCH_NOT_INSTALLED: run scripts/source-match/install.ps1");
    for (const file of [runtime.python, runtime.model]) if (!(await stat(file)).isFile()) throw new Error("SOURCE_MATCH_RUNTIME_MISSING");
    return runtime as { python: string; model: string; backend?: string; device?: "cpu" | "cuda" };
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
    return { job, progress: await optionalJson(path.join(dir,"progress.json")), report: await optionalJson(path.join(dir,"report.json")), csvPath: path.join(dir,"timestamps.csv") };
  }
  submit(body: Record<string, unknown>): Promise<unknown> {
    const result = this.#tail.catch(() => undefined).then(() => this.#submit(body));
    this.#tail = result; return result;
  }
  async #submit(body: Record<string, unknown>) {
    if (typeof body.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(body.requestId)) throw new Error("A stable requestId is required");
    if (typeof body.referencePath !== "string" || !Array.isArray(body.sourcePaths) || body.sourcePaths.length < 1 || body.sourcePaths.length > 8 || body.sourcePaths.some(p => typeof p !== "string")) throw new Error("Provide referencePath and one through eight sourcePaths");
    const budget = body.budgetSeconds ?? 480;
    if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 10 || budget > 3600) throw new Error("budgetSeconds must be 10 through 3600");
    const shots = body.shots;
    if (shots !== undefined && (!Array.isArray(shots) || shots.length === 0 || shots.length > 200 || shots.some((s: any, i: number) => !s || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start || (i > 0 && s.start < (shots[i-1] as any).end)))) throw new Error("shots must be ordered non-overlapping {start,end} ranges in seconds");
    const candidateLimit = body.candidateLimit ?? 4;
    if (!Number.isInteger(candidateLimit) || (candidateLimit as number)<1 || (candidateLimit as number)>12) throw new Error("candidateLimit must be 1 through 12");
    const request = { referencePath: path.resolve(body.referencePath), sourcePaths: (body.sourcePaths as string[]).map(p=>path.resolve(p)), budgetSeconds: budget, candidateLimit, ...(shots ? { shots } : {}) };
    const identities=[];
    for (const file of [request.referencePath, ...request.sourcePaths]) {
      const info=await stat(file); if (!info.isFile()) throw new Error("Matching inputs must be local video files");
      identities.push({file,size:info.size,mtimeMs:info.mtimeMs});
    }
    const hash = createHash("sha256").update(JSON.stringify({version:SOURCE_MATCH_CONTRACT_V1.version,request,identities})).digest("hex");
    const receipt = path.join(this.config.artifactDir, "requests", body.requestId + ".json");
    const existing = await optionalJson(receipt);
    if (existing) {
      if (existing.requestHash !== hash) throw new Error("SOURCE_MATCH_REQUEST_CONFLICT");
      return await this.status(existing.jobId);
    }
    if (this.#active) throw new Error("SOURCE_MATCH_BUSY: GPU work is bounded to one job; poll the active job");
    const runtime = await this.#runtime();
    const id = "source-match-" + randomUUID(), dir = path.join(this.config.artifactDir,id);
    const now = new Date().toISOString();
    const job: Job = { jobId:id, requestId:body.requestId, requestHash:hash, status:"RUNNING", createdAt:now, updatedAt:now, outputDir:dir };
    await save(path.join(dir,"request.json"),request);
    await save(path.join(dir,"job.json"),job);
    await save(receipt,{jobId:id,requestHash:hash});
    const child = spawn(runtime.python,["-I",path.join(this.config.repositoryRoot,"scripts","source-match","engine.py"),"--request",path.join(dir,"request.json"),"--output",dir,"--cache",this.config.cacheDir,"--model",runtime.model,"--backend",runtime.backend ?? "sscd","--device",runtime.device ?? (runtime.backend === "diagnostic" ? "cpu" : "cuda")], { windowsHide:true, stdio:["ignore","pipe","pipe"] });
    let finish!: () => void;
    const completion = new Promise<void>(resolve=>{finish=resolve;});
    this.#active={child,job,completion};
    let stderr="", error: Error | null = null;
    child.stdout?.on("data",()=> { /* engine persists atomic progress; drain pipe */ });
    child.stderr?.on("data",chunk=>{ stderr=(stderr+chunk.toString()).slice(-6000); });
    child.on("error",e=>{ error=e; });
    const timer=setTimeout(()=>{ error=new Error("SOURCE_MATCH_PROCESS_TIMEOUT");child.kill(); },(budget+60)*1000);
    child.on("close",code=> { void (async()=>{
      clearTimeout(timer);
      const report=await optionalJson(path.join(dir,"report.json"));
      job.status=error || code !== 0 ? "FAILED" : report?.status ?? "FAILED";
      job.updatedAt=new Date().toISOString();job.exitCode=code;
      if (error || code !== 0) job.error=error?.message ?? stderr;
      await save(path.join(dir,"job.json"),job);
      if (this.#active?.job.jobId===id) this.#active=null;
    })().catch(async e=>{job.status="FAILED";job.error=String(e);await save(path.join(dir,"job.json"),job);this.#active=null;}).finally(finish); });
    return { job, contract:SOURCE_MATCH_CONTRACT_V1 };
  }
  async cancel(jobId: string) {
    const result = await this.status(jobId);
    if (this.#active?.job.jobId === jobId) await writeFile(path.join(this.#active.job.outputDir,"cancel"),"User requested cancellation");
    return { ...result, cancellationRequested: this.#active?.job.jobId === jobId };
  }
  async stop() {
    if (this.#active) { const active=this.#active; await writeFile(path.join(active.job.outputDir,"cancel"),"Service shutdown"); active.child.kill(); await active.completion; }
  }
}
