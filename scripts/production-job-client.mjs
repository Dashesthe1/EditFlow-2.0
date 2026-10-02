import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const productToken = async () => {
  if (process.env.EDITFLOW_PRODUCT_TOKEN) return process.env.EDITFLOW_PRODUCT_TOKEN;
  const config = JSON.parse(await readFile(path.join(process.env.LOCALAPPDATA ?? '', 'EditFlow2', 'bridge-config.json'), 'utf8'));
  return config.token;
};

/** Acceptance helpers use job receipts and cannot select an older controller. */
export async function productionRequest(base, operation, init = {}) {
  if (operation.startsWith('@')) {
    const kind = operation.slice(1);
    const payload = JSON.parse(init.body ?? '{}');
    if (kind === 'PROOF_SCRIPT' && process.env.EDITFLOW_WORKER_PROOF_URL) {
      return await fetch(process.env.EDITFLOW_WORKER_PROOF_URL, { ...init, headers: {
        ...init.headers, 'X-EditFlow-Token': process.env.EDITFLOW_WORKER_PRODUCT_TOKEN,
        'X-EditFlow-Worker-Key': process.env.EDITFLOW_WORKER_PROOF_KEY,
      } });
    }
    const researchContext = payload.researchContext ?? JSON.parse(process.env.EDITFLOW_RESEARCH_CONTEXT_JSON ?? 'null');
    if (!researchContext?.assignmentId || !researchContext?.claimedBy) throw new Error('Production helpers require EDITFLOW_RESEARCH_CONTEXT_JSON for the retained assignment and current controller.');
    const headers = { 'Content-Type':'application/json', 'X-EditFlow-Token':await productToken() };
    const endpoint = base + '/v1/product/gpt/assignments/' + encodeURIComponent(researchContext.assignmentId) + '/production-jobs';
    const accepted = await fetch(endpoint, { method:'POST', headers, body:JSON.stringify({kind,payload:{...payload,researchContext}}) });
    if (!accepted.ok) return accepted;
    let { job } = await accepted.json();
    const deadline = Date.now() + 30_000;
    while (['PENDING','RUNNING'].includes(job.status) && Date.now() < deadline) {
      await new Promise(r=>setTimeout(r,100));
      try {
        const response = await fetch(endpoint+'?jobId='+encodeURIComponent(job.jobId), {headers});
        if (!response.ok) break;
        job = (await response.json()).job;
      } catch { break; }
    }
    const body = job.status === 'SUCCEEDED'
      ? { ...(job.result ?? {}), ok:true, productionJobId:job.jobId }
      : { error:'Production job '+job.status+'; inspect/reconcile this receipt before continuing.', job };
    return new Response(JSON.stringify(body), {status:job.status === 'SUCCEEDED' ? 200 : 409, headers:{'Content-Type':'application/json'}});
  }
  return await fetch(base + operation, {...init,headers:{...init.headers,'X-EditFlow-Token':await productToken()}});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const response = await productionRequest(process.env.EDITFLOW_SHADOW_CONTROL ?? 'http://127.0.0.1:32146', '@PROOF_SCRIPT', {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scriptPath:process.argv[2]})});
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify(result));
}
