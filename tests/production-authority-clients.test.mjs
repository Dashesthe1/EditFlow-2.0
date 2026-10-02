import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { productionRequest } from '../scripts/production-job-client.mjs';

test('gateway preserves submitted receipts on polling failure and never retries writes', () => {
  const script = `
import runpy, sys, types
sdk = types.ModuleType('mcp.server.mcpserver')
class MCPServer:
    def __init__(self, name): self.tools = {}
    def tool(self):
        def register(fn): self.tools[fn.__name__] = fn; return fn
        return register
sdk.MCPServer = MCPServer
sys.modules['mcp.server.mcpserver'] = sdk
module = runpy.run_path('scripts/current_shadow_gateway_v3.py')
execute = module['_execute_queued']
calls = []
def request(method, path, payload=None):
    calls.append((method, path))
    if method == 'POST':
        return {'job': {'jobId':'durable:1', 'status':'RUNNING'}}
    raise RuntimeError('temporary read failure')
execute.__globals__['_practice_http'] = request
context = {'researchContext': {'assignmentId':'assignment:1','claimedBy':'controller'}}
result = execute('AE_BATCH', context)
assert result['productionJobId'] == 'durable:1'
assert result['productionStatus'] == 'RUNNING'
assert 'pollError' in result
assert [x[0] for x in calls] == ['POST','GET']
assert all('/production-jobs' in x[1] for x in calls)
calls.clear()
result = execute('AE_BATCH', context, wait_seconds=0)
assert result['productionJobId'] == 'durable:1'
assert len(calls) == 1
try:
    execute('AE_BATCH', {})
    raise AssertionError('missing context was accepted')
except ValueError:
    pass
assert len(calls) == 1
print('verified')
`;
  assert.equal(execFileSync(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3.12'] : []), '-c', script], {cwd:process.cwd(),encoding:'utf8'}).trim(),'verified');
});

test('acceptance helper submits one job and surfaces pending review without bypassing it', async t => {
  const previous = {fetch:globalThis.fetch,context:process.env.EDITFLOW_RESEARCH_CONTEXT_JSON,token:process.env.EDITFLOW_PRODUCT_TOKEN};
  t.after(()=>{ globalThis.fetch=previous.fetch; for(const [key,value] of [['EDITFLOW_RESEARCH_CONTEXT_JSON',previous.context],['EDITFLOW_PRODUCT_TOKEN',previous.token]]) { if(value===undefined) delete process.env[key]; else process.env[key]=value; } });
  process.env.EDITFLOW_RESEARCH_CONTEXT_JSON=JSON.stringify({assignmentId:'assignment:1',claimedBy:'controller'});
  process.env.EDITFLOW_PRODUCT_TOKEN='test-token';
  const calls=[];
  globalThis.fetch=async (url,init) => { calls.push({url,init}); return new Response(JSON.stringify({job:{jobId:'job:1',status:'REVIEW_REQUIRED',result:{outcome:'APPLIED'}}}),{status:202}); };
  const response=await productionRequest('http://localhost','@PROOF_SCRIPT',{method:'POST',body:JSON.stringify({scriptPath:'scripts/windows/test.jsx'})});
  assert.equal(response.status,409);
  assert.equal((await response.json()).job.jobId,'job:1');
  assert.equal(calls.length,1);
  assert.equal(JSON.parse(calls[0].init.body).kind,'PROOF_SCRIPT');
  assert.match(calls[0].url,/\/production-jobs$/);
});
