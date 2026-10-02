'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
async function verifyOwnPrompt(ownText, requestedPrompt, textContent = ownText) {
  let listener;
  const bubble = { innerText: ownText, textContent, isConnected: true, getClientRects: () => [1], closest: () => null };
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
test('actuator verifies a collapsed own prompt using the full user message text', async () => {
  const prompt = 'Continue the Practice session with the given raw files to make the finished product. Resume existing assignment gpt-assignment:abc and session practice:def from its checkpoint. Your exclusive worker credential is ef-worker:2:' + 'a'.repeat(64);
  const reply = await verifyOwnPrompt('Continue the Practice session', prompt, 'You said: ' + prompt + ' Copy');
  assert.equal(reply.sent, true);
  const wrong = await verifyOwnPrompt('Continue the Practice session', prompt, prompt.replace('ef-worker:2:', 'ef-worker:1:'));
  assert.equal(wrong.sent, false);
});
