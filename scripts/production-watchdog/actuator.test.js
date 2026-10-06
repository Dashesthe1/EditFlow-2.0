'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
async function verifyOwnPrompt(ownText, requestedPrompt, textContent = ownText, options = {}) {
  let listener;
  const bubble = { innerText: ownText, textContent, isConnected: true, getClientRects: () => [1], closest: () => null };
  const context = vm.createContext({
    document: { querySelectorAll: selector => selector.includes('[data-user-message-bubble]')
      ? [bubble, ...(options.laterText ? [{ textContent: options.laterText }] : [])] : [],
      querySelector: () => { throw Error('Must not type into an existing conversation'); } },
    location: { pathname: '/c/supervisor-owned-chat' },
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    setTimeout, HTMLTextAreaElement: class {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8'), context);
  return await new Promise(resolve => listener({ type: 'EDITFLOW_ACTUATOR_SEND', prompt: requestedPrompt,
    verifyOnly: options.verifyOnly }, {}, resolve));
}
test('actuator recognizes its own already-submitted prompt in the current ChatGPT user bubble layout', async () => {
  const reply = await verifyOwnPrompt('Continue Practice\nResume same assignment', 'Continue Practice Resume same assignment');
  assert.equal(reply.sent, true);
});
test('actuator refuses an unrelated existing conversation instead of submitting a duplicate prompt', async () => {
  const reply = await verifyOwnPrompt('Some unrelated question', 'Continue Practice');
  assert.equal(reply.sent, false); assert.equal(reply.error, 'CONTINUATION_TARGET_NOT_EMPTY');
});
test('actuator verifies a collapsed own prompt using the full user message text', async () => {
  const prompt = 'Continue the Practice session with the given raw files to make the finished product. Resume existing assignment gpt-assignment:abc and session practice:def from its checkpoint. Your exclusive worker credential is ef-worker:2:' + 'a'.repeat(64);
  const reply = await verifyOwnPrompt('Continue the Practice session', prompt, 'You said: ' + prompt + ' Copy');
  assert.equal(reply.sent, true);
  const wrong = await verifyOwnPrompt('Continue the Practice session', prompt, prompt.replace('ef-worker:2:', 'ef-worker:1:'));
  assert.equal(wrong.sent, false);
});
test('direct continuations survive ChatGPT wrappers, collapsed text and lost SEND acknowledgments', async () => {
  const { prompt } = require('./worker-prompt.js');
  for (const mode of ['PRACTICE', 'PRO_CREATION']) {
    const expected = prompt({ mode, assignmentId: 'gpt-assignment:abc', sessionId: 'practice:def' }, 'ef-worker:116:' + 'a'.repeat(64));
    const actual = 'You said: ' + expected + ' Copy';
    const reply = await verifyOwnPrompt('Continue the ' + mode, expected, actual, { verifyOnly: true });
    assert.equal(reply.sent, true);
    assert.equal((await verifyOwnPrompt('Continue', expected, actual.replace('practice:def', 'practice:other'))).sent, false);
    assert.equal((await verifyOwnPrompt('Continue', expected, actual.replace('a'.repeat(64), 'b'.repeat(64)))).sent, false);
    assert.equal((await verifyOwnPrompt('Continue', expected, actual, { laterText: 'Continue working' })).sent, true);
    assert.equal((await verifyOwnPrompt('Continue', expected, actual, {
      laterText: 'Continue gpt-assignment:abc and session practice:def; ef-worker:117:' + 'b'.repeat(64),
    })).sent, false);
    assert.equal((await verifyOwnPrompt('Continue', expected, actual, {
      laterText: 'Continue gpt-assignment:other and session practice:def; ef-worker:116:' + 'a'.repeat(64),
    })).sent, false);
  }
});
test('delivery verification never types into a conflicting conversation', async () => {
  const reply = await verifyOwnPrompt('Unrelated conversation', 'Continue Practice', undefined, { verifyOnly: true });
  assert.equal(reply.sent, false); assert.equal(reply.error, 'DELIVERY_NOT_FOUND');
});
test('background reinjects a stale observer before operating on an existing tab', async () => {
  let injected = 0;
  const context = vm.createContext({
    chrome: { tabs: { sendMessage: async () => ({ ok: true, version: '3.3.3' }) },
      scripting: { executeScript: async () => { injected++; } },
      runtime: { id: 'test', getManifest: () => ({ version: '3.4.0' }), onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
      alarms: { onAlarm: { addListener() {} }, clearAll: async () => {}, create: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({ command: 'NONE' }) }), setInterval() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8') + '\nglobalThis.attachForTest = attach;', context);
  await context.attachForTest(99); assert.equal(injected, 1);
  context.chrome.tabs.sendMessage = async () => ({ ok: true, version: '3.4.0' });
  await context.attachForTest(99); assert.equal(injected, 1);
});

async function observedState({ stop = false, final = false, generation = 4, afterUser = true, followUp = null, collapsed = false, accessibleFinal = false, credentialCollapsed = false, deliveryConfirmed = false } = {}) {
  let listener;
  const button = { isConnected: true, disabled: false, getClientRects: () => [1] };
  const bubble = { textContent: 'assignment retained session retained-session' + (credentialCollapsed ? '' : ' ef-worker:' + generation + ':private'),
    compareDocumentPosition: () => afterUser ? 4 : 2 };
  const users = [bubble];
  if (collapsed) users.push({ textContent: 'Continue Practice', compareDocumentPosition: bubble.compareDocumentPosition });
  if (followUp !== null) users.push({ textContent: followUp, compareDocumentPosition: bubble.compareDocumentPosition });
  const turn = { querySelectorAll: selector => final || accessibleFinal && selector.includes('aria-label="Good response"') ? [button] : [] };
  const assistant = { closest: () => turn };
  const context = vm.createContext({
    document: { querySelectorAll: selector => {
      if (selector.includes('[data-user-message-bubble]')) return users;
      if (selector.includes('stop-button')) return stop ? [button] : [];
      if (selector.includes('[data-message-author-role="assistant"]')) return [assistant];
      return [];
    } },
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } }, setTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8'), context);
  return await new Promise(resolve => listener({ type: 'EDITFLOW_ACTUATOR_STATUS', assignmentId: 'retained',
    sessionId: 'retained-session', generation: 4, deliveryConfirmed }, {}, resolve));
}
test('an owned processing turn reports only its state even if historical final controls exist', async () => {
  const result = await observedState({ stop: true, final: true });
  assert.equal(result.state, 'PROCESSING');
  assert.deepEqual(Object.keys(result), ['state', 'observation']);
  assert.doesNotMatch(JSON.stringify(result), /private|retained-session|ef-worker/);
});
test('absence of a Stop control alone never proves completion', async () => {
  assert.equal((await observedState()).state, 'UNKNOWN');
  assert.equal((await observedState({ final: true })).state, 'FINISHED');
});
test('old worker prompt or a historical response cannot authorize a completion observation', async () => {
  assert.equal((await observedState({ final: true, generation: 3 })).state, 'UNKNOWN');
  assert.equal((await observedState({ final: true, afterUser: false })).state, 'UNKNOWN');
});

test('a collapsed nested bubble retains the matching continuation identity', async () => {
  assert.equal((await observedState({ collapsed: true, stop: true })).state, 'PROCESSING');
  assert.equal((await observedState({ collapsed: true, final: true })).state, 'FINISHED');
});
test('ordinary follow-ups retain ownership and protect the newest processing turn', async () => {
  const result = await observedState({ followUp: 'Continue from the checkpoint', stop: true, final: true });
  assert.equal(result.state, 'PROCESSING'); assert.deepEqual(Object.keys(result), ['state', 'observation']);
  assert.equal((await observedState({ followUp: 'Continue from the checkpoint', final: true })).state, 'FINISHED');
  assert.equal((await observedState({ followUp: 'Continue from the checkpoint', afterUser: false, final: true })).state, 'UNKNOWN');
});
test('a newer foreign continuation does not inherit the old worker observation', async () => {
  assert.equal((await observedState({ followUp: 'ef-worker:3:other', final: true })).state, 'UNKNOWN');
  assert.equal((await observedState({ followUp: 'gpt-assignment:other', stop: true })).state, 'UNKNOWN');
});
test('current accessible response controls can establish completion in the owned turn', async () => {
  assert.equal((await observedState({ accessibleFinal: true })).state, 'FINISHED');
});
test('reinjection reinstalls a lost runtime listener without duplicating a live listener', () => {
  let installed = null, count = 0;
  const context = vm.createContext({ chrome: { runtime: { onMessage: {
    hasListener: fn => fn === installed, addListener: fn => { installed = fn; count++; },
  } } }, setTimeout });
  const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  vm.runInContext(source, context); vm.runInContext(source, context); assert.equal(count, 1);
  installed = null; vm.runInContext(source, context); assert.equal(count, 2);
});
test('a collapsed credential requires the exact tab delivery acknowledgment and current browser controls', async () => {
  assert.equal((await observedState({ credentialCollapsed: true, final: true })).state, 'UNKNOWN');
  assert.equal((await observedState({ credentialCollapsed: true, deliveryConfirmed: true })).state, 'UNKNOWN');
  assert.equal((await observedState({ credentialCollapsed: true, deliveryConfirmed: true, stop: true })).state, 'PROCESSING');
  assert.equal((await observedState({ credentialCollapsed: true, deliveryConfirmed: true, final: true })).state, 'FINISHED');
  assert.equal((await observedState({ generation: 3, deliveryConfirmed: true, final: true })).state, 'UNKNOWN');
  assert.equal((await observedState({ credentialCollapsed: true, deliveryConfirmed: true, followUp: 'ef-worker:5:other', final: true })).state, 'UNKNOWN');
});
