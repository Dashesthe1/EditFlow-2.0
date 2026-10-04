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
