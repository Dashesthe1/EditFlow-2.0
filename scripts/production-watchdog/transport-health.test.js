"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { probeMcp, probePublicMcp, resolvePublicRelays, createPinnedHttpsFetch, createTransportMonitor, configuredEndpoints, CORE_TOOLS } = require('./transport-health.js');
const { EventEmitter } = require('events');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function fakeEndpoint(options = {}) {
  const methods = [];
  const fetch = async (_url, request) => {
    if (request.method === 'DELETE') { methods.push('DELETE'); return new Response('', { status: 200 }); }
    const packet = JSON.parse(request.body); methods.push(packet.method);
    if (options.fail) throw Error('private-url/secret-route ef-worker:95:never-publish');
    if (options.http) return new Response('', { status: options.http });
    if (packet.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = packet.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
      : { tools: (options.incomplete ? ['get_mcp_surface'] : CORE_TOOLS).map(name => ({ name })) };
    const value = { jsonrpc: '2.0', id: packet.id, result };
    const headers = options.session && packet.method === 'initialize' ? { 'mcp-session-id': 'health-probe-session' } : {};
    return new Response(options.sse ? 'event: message\ndata: ' + JSON.stringify(value) + '\n\n' : JSON.stringify(value), { headers });
  };
  return { fetch, methods };
}

test('transport probe performs only initialize/metadata reads and retires its own stateful session', async () => {
  const f = fakeEndpoint({ session: true, sse: true });
  const result = await probeMcp('http://127.0.0.1/mcp', { fetch: f.fetch });
  assert.equal(result.ready, true);
  assert.deepEqual(f.methods, ['initialize', 'notifications/initialized', 'tools/list', 'DELETE']);
  assert.ok(!f.methods.includes('tools/call'));
});
test('direct transport readiness does not depend on optional workflow/preflight tools', async () => {
  assert.ok(!CORE_TOOLS.includes('get_mcp_surface'));
  assert.ok(!CORE_TOOLS.includes('record_production_update'));
  assert.ok(!CORE_TOOLS.includes('record_clip_research'));
  assert.equal((await probeMcp('http://127.0.0.1/mcp', { fetch: fakeEndpoint().fetch })).ready, true);
});

test('transport outages, HTTP rejection and incomplete surfaces cannot report READY or expose endpoint/secrets', async () => {
  for (const options of [{ fail: true }, { http: 503 }, { incomplete: true }]) {
    const f = fakeEndpoint(options);
    const result = await probeMcp('https://private-url/secret-route', { fetch: f.fetch });
    assert.equal(result.ready, false);
    assert.doesNotMatch(JSON.stringify(result), /secret-route|ef-worker|private-url/);
  }
});

test('monitor cannot authorize local-only health, recovers without writes and suppresses overlapping probes', async () => {
  let publicReady = false, calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const monitor = createTransportMonitor({
    localUrl: 'local', resolve: async () => ({ configured: true, public: 'public' }),
    probe: async url => { calls++; await gate; return { ready: url === 'local' || publicReady }; },
  });
  const first = monitor.check(true), second = monitor.check(true);
  assert.equal(monitor.state().ready, false); release();
  await Promise.all([first, second]); assert.equal(calls, 2);
  assert.equal(monitor.state().ready, false);
  assert.equal(monitor.state().failures, 1);
  publicReady = true; await monitor.check(true);
  assert.equal(monitor.state().ready, true);
  assert.equal(monitor.state().failures, 0);
});

test('configured route must be the saved protected path and exact local MCP target with existing Funnel enabled', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transport-config-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'EditFlow2'));
  await fs.writeFile(path.join(root, 'EditFlow2', 'public-path.txt'), '/existing-protected-route');
  const status = { BackendState: 'Running', Self: { Online: true, DNSName: 'shadow.test.ts.net.' } };
  const serve = { Web: { 'shadow.test.ts.net:443': { Handlers: { '/existing-protected-route': { Proxy: 'http://127.0.0.1:8770/mcp' } } } }, AllowFunnel: { 'shadow.test.ts.net:443': true } };
  const run = async (_command, args) => ({ stdout: JSON.stringify(args[0] === 'status' ? status : serve) });
  assert.equal((await configuredEndpoints(root, run)).configured, true);
  serve.AllowFunnel['shadow.test.ts.net:443'] = false;
  assert.equal((await configuredEndpoints(root, run)).configured, false);
  status.BackendState = 'Stopped';
  await assert.rejects(configuredEndpoints(root, run), /TAILSCALE_OFFLINE/);
});

test('public resolver uses DNS-over-HTTPS and rejects the private MagicDNS address', async () => {
  const queried = [];
  const fetch = async url => {
    queried.push(new URL(url));
    return Response.json({ Status: 0, Answer: [{ type: 1, data: '100.89.40.65' }] });
  };
  await assert.rejects(resolvePublicRelays('shadow.test.ts.net', { fetch }), /PUBLIC_DNS_PRIVATE_ADDRESS/);
  assert.deepEqual(queried.map(url => url.hostname), ['dns.google', 'cloudflare-dns.com']);
  assert.ok(queried.every(url => url.searchParams.get('name') === 'shadow.test.ts.net' && url.searchParams.get('type') === 'A'));
  assert.deepEqual(await resolvePublicRelays('shadow.test.ts.net', { fetch: async () => Response.json({ Status: 0,
    Answer: [{ type: 1, data: '209.177.145.137' }, { type: 1, data: '209.177.145.137' }] }) }), ['209.177.145.137']);
});

test('public HTTPS pins the relay address and preserves hostname, SNI and certificate checks', async () => {
  let observed;
  const request = (url, options, respond) => {
    observed = { url, options };
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': 'application/json' };
      respond(res); res.emit('data', Buffer.from('{"ok":true}')); res.emit('end');
    });
    return req;
  };
  const fetch = createPinnedHttpsFetch('shadow.test.ts.net', '209.177.145.137', request);
  assert.deepEqual(await (await fetch('https://shadow.test.ts.net/existing-route')).json(), { ok: true });
  assert.equal(observed.url.hostname, 'shadow.test.ts.net');
  assert.equal(observed.options.servername, 'shadow.test.ts.net');
  assert.notEqual(observed.options.rejectUnauthorized, false);
  assert.notEqual(observed.options.agent.options.rejectUnauthorized, false);
  observed.options.agent.options.lookup('shadow.test.ts.net', { all: true }, (error, addresses) => {
    assert.equal(error, null); assert.deepEqual(addresses, [{ address: '209.177.145.137', family: 4 }]);
  });
  await assert.rejects(fetch('https://different.test.ts.net/existing-route'), /PUBLIC_HOST_CONFIG_INVALID/);
  assert.throws(() => createPinnedHttpsFetch('shadow.test.ts.net', '100.89.40.65'), /PUBLIC_DNS_PRIVATE_ADDRESS/);
});

test('a successful private probe or one working public relay cannot conceal a failed relay', async () => {
  const result = await probePublicMcp('https://shadow.test.ts.net/existing-route', {
    resolve: async () => ['209.177.145.137', '199.38.181.54'],
    createFetch: (_host, address) => fakeEndpoint(address === '199.38.181.54' ? { http: 503 } : {}).fetch,
  });
  assert.equal(result.ready, false); assert.equal(result.error, 'PUBLIC_RELAY_PARTIAL');
  assert.equal(result.relayCount, 2); assert.equal(result.reachableRelays, 1);
  assert.deepEqual(result.relayErrors, ['HTTP_503']);
  assert.doesNotMatch(JSON.stringify(result), /existing-route|shadow\.test/);
  const monitor = createTransportMonitor({ localUrl: 'local', resolve: async () => ({ configured: true, public: 'public' }),
    probe: async () => ({ ready: true }), publicProbe: async () => result });
  await monitor.check(true); assert.equal(monitor.state().ready, false);
});

test('public health is READY only after every advertised relay passes MCP metadata checks', async () => {
  const result = await probePublicMcp('https://shadow.test.ts.net/existing-route', {
    resolve: async () => ['209.177.145.137', '199.38.181.54'], createFetch: () => fakeEndpoint().fetch,
  });
  assert.equal(result.ready, true); assert.equal(result.reachableRelays, 2);
  assert.equal(result.reachability, 'PUBLIC_DNS_PINNED_TLS'); assert.equal(result.toolCount, CORE_TOOLS.length);
});
