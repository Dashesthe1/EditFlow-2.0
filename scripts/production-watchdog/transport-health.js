"use strict";
const fs = require('fs');
const path = require('path');
const https = require('https');
const net = require('net');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execute = promisify(execFile);
const CORE_TOOLS = ['get_mcp_surface', 'get_production_state', 'record_production_update', 'claim_gpt_assignment', 'get_production_jobs', 'enqueue_production_job', 'resolve_production_job'];

async function configuredEndpoints(localRoot, run = execute) {
  const local = 'http://127.0.0.1:8770/mcp';
  const publicPath = fs.readFileSync(path.join(localRoot, 'EditFlow2', 'public-path.txt'), 'utf8').trim();
  if (!/^\/[A-Za-z0-9/_-]+$/.test(publicPath) || publicPath === '/') throw Error('PUBLIC_ROUTE_CONFIG_INVALID');
  const state = JSON.parse((await run('tailscale.exe', ['status', '--json'], { timeout: 5000, windowsHide: true })).stdout);
  if (state.BackendState !== 'Running' || !state.Self?.Online) throw Error('TAILSCALE_OFFLINE');
  const host = String(state.Self.DNSName || '').replace(/\.$/, '');
  if (!/^[a-z0-9.-]+\.ts\.net$/i.test(host)) throw Error('PUBLIC_HOST_CONFIG_INVALID');
  const serve = JSON.parse((await run('tailscale.exe', ['serve', 'status', '--json'], { timeout: 5000, windowsHide: true })).stdout);
  const key = host + ':443';
  const proxy = serve.Web?.[key]?.Handlers?.[publicPath]?.Proxy;
  const configured = proxy === local && serve.AllowFunnel?.[key] === true;
  return { local, public: 'https://' + host + publicPath, configured };
}

function isPublicIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 0 || b === 168)) && !(a === 198 && (b === 18 || b === 19));
}

async function resolvePublicRelays(host, options = {}) {
  if (!/^[a-z0-9.-]+\.ts\.net$/i.test(host)) throw Error('PUBLIC_HOST_CONFIG_INVALID');
  const request = options.fetch || fetch;
  let privateAnswer = false;
  for (const resolver of ['https://dns.google/resolve', 'https://cloudflare-dns.com/dns-query']) {
    try {
      const query = new URL(resolver); query.search = new URLSearchParams({ name: host, type: 'A' }).toString();
      const response = await request(query, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(options.timeoutMs || 5000) });
      if (!response.ok) continue;
      const result = await response.json();
      if (result.Status !== 0) continue;
      const addresses = [...new Set((result.Answer || []).filter(item => item.type === 1).map(item => item.data))];
      privateAnswer ||= addresses.some(address => !isPublicIpv4(address));
      const publicAddresses = addresses.filter(isPublicIpv4);
      if (publicAddresses.length) return publicAddresses;
    } catch {}
  }
  throw Error(privateAnswer ? 'PUBLIC_DNS_PRIVATE_ADDRESS' : 'PUBLIC_DNS_UNAVAILABLE');
}

function createPinnedHttpsFetch(host, address, request = https.request) {
  if (!isPublicIpv4(address)) throw Error('PUBLIC_DNS_PRIVATE_ADDRESS');
  return async (url, options = {}) => {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== host || endpoint.username || endpoint.password) throw Error('PUBLIC_HOST_CONFIG_INVALID');
    return new Promise((resolve, reject) => {
      // Connect to the public relay, while retaining Host, SNI and normal certificate verification.
      const agent = new https.Agent({ keepAlive: false, lookup: (_name, lookupOptions, callback) =>
        lookupOptions.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4) });
      const req = request(endpoint, { method: options.method || 'GET', headers: options.headers,
        agent, servername: host, signal: options.signal }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) { req.destroy(Error('MCP_RESPONSE_TOO_LARGE')); return; }
          chunks.push(chunk);
        });
        response.on('error', error => { agent.destroy(); reject(error); });
        response.on('end', () => {
          agent.destroy();
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          const body = Buffer.concat(chunks);
          resolve(new Response(body.length ? body : null, { status: response.statusCode, headers }));
        });
      });
      req.on('error', error => { agent.destroy(); reject(error); });
      req.end(options.body);
    });
  };
}

async function probeMcp(url, options = {}) {
  const request = options.fetch || fetch;
  let session = null, protocol = '2025-03-26';
  const headers = () => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'mcp-protocol-version': protocol, ...(session ? { 'mcp-session-id': session } : {}) });
  const send = async (method, id, params) => {
    const response = await request(url, { method: 'POST', headers: headers(), signal: AbortSignal.timeout(options.timeoutMs || 5000),
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) }) });
    if (!response.ok) throw Error('HTTP_' + response.status);
    if (method === 'initialize') session = response.headers.get('mcp-session-id');
    if (id === null) { await response.text(); return null; }
    const raw = await response.text();
    const packets = raw.trim().startsWith('{') ? [JSON.parse(raw)] : raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
    const packet = packets.find(value => value.id === id);
    if (!packet || packet.error || !packet.result) throw Error('MCP_PROTOCOL_REJECTED');
    return packet.result;
  };
  try {
    const init = await send('initialize', 1, { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'editflow-transport-health', version: '1.0.0' } });
    if (!init.protocolVersion || !init.capabilities?.tools) throw Error('MCP_INITIALIZE_INVALID');
    protocol = init.protocolVersion;
    await send('notifications/initialized', null);
    const result = await send('tools/list', 2);
    const names = (result.tools || []).map(tool => tool.name);
    if (!CORE_TOOLS.every(name => names.includes(name))) throw Error('MCP_SURFACE_INCOMPLETE');
    return { ready: true, status: 'READY', toolCount: names.length };
  } catch (error) {
    // Never publish private route URLs, headers, tool arguments or worker credentials.
    const message = String(error.message || '');
    const networkError = error.code === 'ECONNRESET' ? 'CONNECTION_RESET'
      : ['ETIMEDOUT', 'ABORT_ERR'].includes(error.code) || ['AbortError', 'TimeoutError'].includes(error.name) ? 'CONNECTION_TIMEOUT' : 'CONNECTION_FAILED';
    return { ready: false, status: 'UNAVAILABLE', error: /^(HTTP_\d+|MCP_[A-Z_]+)$/.test(message) ? message : networkError };
  } finally {
    if (session) { try { await request(url, { method: 'DELETE', headers: headers(), signal: AbortSignal.timeout(1000) }); } catch {} }
  }
}

async function probePublicMcp(url, options = {}) {
  const reachability = 'PUBLIC_DNS_PINNED_TLS';
  try {
    const host = new URL(url).hostname;
    const addresses = await (options.resolve || resolvePublicRelays)(host);
    if (!addresses.length || addresses.some(address => !isPublicIpv4(address))) throw Error('PUBLIC_DNS_PRIVATE_ADDRESS');
    const results = await Promise.all(addresses.map(address => (options.probe || probeMcp)(url,
      { fetch: (options.createFetch || createPinnedHttpsFetch)(host, address), timeoutMs: options.timeoutMs })));
    const reachableRelays = results.filter(result => result.ready).length;
    // Every advertised relay must work: ChatGPT can resolve to either one.
    const ready = reachableRelays === addresses.length;
    return { ready, status: ready ? 'READY' : 'UNAVAILABLE', reachability, relayCount: addresses.length, reachableRelays,
      ...(ready ? { toolCount: Math.min(...results.map(result => result.toolCount)) }
        : { error: reachableRelays ? 'PUBLIC_RELAY_PARTIAL' : results[0].error || 'CONNECTION_FAILED',
          relayErrors: results.filter(result => !result.ready).map(result => result.error || 'CONNECTION_FAILED') }) };
  } catch (error) {
    return { ready: false, status: 'UNAVAILABLE', reachability,
      error: /^(PUBLIC_[A-Z_]+)$/.test(error.message) ? error.message : 'CONNECTION_FAILED' };
  }
}

function createTransportMonitor(options = {}) {
  let latest = { ready: false, status: 'CHECKING', checkedAt: 0, failures: 0 }, pending = null;
  const localRoot = options.localRoot || process.env.LOCALAPPDATA;
  const localUrl = options.localUrl || 'http://127.0.0.1:8770/mcp';
  const probe = options.probe || probeMcp;
  const publicProbe = options.publicProbe || (options.probe ? options.probe : probePublicMcp);
  const resolve = options.resolve || (() => configuredEndpoints(localRoot));
  return {
    state() {
      if (latest.ready && Date.now() - latest.checkedAt > 45000) return { ...latest, ready: false, status: 'STALE_HEALTH' };
      return { ...latest };
    },
    async check(force = false) {
      if (pending) return pending;
      if (!force && latest.checkedAt && Date.now() - latest.checkedAt < (options.intervalMs || 15000)) return latest;
      pending = (async () => {
        const local = await probe(localUrl);
        let publicResult = { ready: false, status: 'UNAVAILABLE', error: 'NOT_CHECKED' }, routeConfigured = false;
        if (local.ready) {
          try {
            const endpoints = await resolve(); routeConfigured = endpoints.configured;
            publicResult = routeConfigured ? await publicProbe(endpoints.public) : { ready: false, status: 'UNAVAILABLE', error: 'PUBLIC_ROUTE_NOT_CONFIGURED' };
          } catch (error) {
            publicResult = { ready: false, status: 'UNAVAILABLE', error: ['TAILSCALE_OFFLINE','PUBLIC_ROUTE_CONFIG_INVALID','PUBLIC_HOST_CONFIG_INVALID'].includes(error.message) ? error.message : 'PUBLIC_CONFIG_UNAVAILABLE' };
          }
        }
        const ready = local.ready && publicResult.ready;
        latest = { ready, status: ready ? 'READY' : 'UNAVAILABLE', checkedAt: Date.now(), failures: ready ? 0 : latest.failures + 1,
          local, public: publicResult, routeConfigured };
        return latest;
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}

module.exports = { CORE_TOOLS, probeMcp, probePublicMcp, resolvePublicRelays, createPinnedHttpsFetch, configuredEndpoints, createTransportMonitor };
if (require.main === module) {
  createTransportMonitor().check(true).then(result => { process.stdout.write(JSON.stringify(result)); }).catch(() => {
    process.stdout.write(JSON.stringify({ ready: false, status: 'UNAVAILABLE', error: 'PROBE_FAILED' })); process.exitCode = 1;
  });
}
