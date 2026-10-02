'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
async function verifyOwnPrompt(ownText, requestedPrompt) {
  let listener;
  const bubble = { innerText: ownText, isConnected: true, getClientRects: () => [1], closest: () => null };
  const context = vm.createContext({
    document: { querySelectorAll: selector => selector.includes('[data-user-message-bubble]') ? [bubble] : [],
      querySelector: () => { throw Error('Must not type into an existing conversation'); } },
    location: { pathname: '/c/supervisor-owned-chat' },
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    setTimeout, HTMLTextAreaElement: class {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8'), context);
  return await new Promise(resolve => listener({ type: 'EDITFLOW_ACTUATOR_SEND', prompt: requestedPrompt }, {}, resolve));
}
test('actuator recognizes its own already-submitted prompt in the current ChatGPT user bubble layout', async () => {
  const reply = await verifyOwnPrompt('Continue Practice\nResume same assignment', 'Continue Practice Resume same assignment');
  assert.equal(reply.sent, true);
});
test('actuator refuses an unrelated existing conversation instead of submitting a duplicate prompt', async () => {
  const reply = await verifyOwnPrompt('Some unrelated question', 'Continue Practice');
  assert.equal(reply.sent, false); assert.equal(reply.error, 'CONTINUATION_TARGET_NOT_EMPTY');
});
