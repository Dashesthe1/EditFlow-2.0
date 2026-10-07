'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('popup clears an uncreated blocked restart and does not reuse terminal authority as an active assignment', async () => {
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, disabled: false }); return elements.get(id); };
  let receipt = { requestId: 'deleted-preset-restart', action: 'RESTART_PRACTICE', status: 'BLOCKED', step: 'PREPARING',
    assignmentId: null, generation: null, tabId: null, error: 'Unknown Edit Type: deleted-preset' };
  let health = { phase: 'BLOCKED', authority: { mode: 'PRACTICE', assignmentId: 'old-cancelled-assignment', generation: 127, state: 'IDLE' }, userControl: receipt, assignment: null };
  const submissions = [];
  const context = vm.createContext({ document: { querySelector: selector => element(selector.slice(1)) },
    chrome: { runtime: { id: 'test-extension' } }, crypto: { randomUUID: () => 'new-intent' }, setInterval: () => {},
    fetch: async (url, options) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); submissions.push(body);
        assert.equal(body.action, 'DISMISS'); assert.equal(body.requestId, receipt.requestId); assert.equal(body.userRequested, true);
        receipt = { ...receipt, status: 'FAILED', step: 'DONE', error: 'Dismissed by user before a replacement assignment was created. ' + receipt.error, completedAt: '2026-10-07T22:00:00Z' };
        health = { ...health, phase: 'IDLE', userControl: null, reason: 'no_assignment' };
      }
      return { ok: true, json: async () => url.endsWith('/health') ? health : { receipt } };
    } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8'), context);
  await new Promise(setImmediate);
  assert.equal(element('restart').disabled, true); assert.equal(element('dismiss').hidden, false); assert.equal(element('retry').disabled, true);
  await element('dismiss').onclick();
  assert.equal(submissions.length, 1); assert.match(element('status').textContent, /^IDLE:/);
  assert.match(element('receipt').textContent, /^DISMISSED/); assert.doesNotMatch(element('receipt').textContent, /Verified:/);
  assert.equal(element('dismiss').hidden, true); assert.equal(element('retry').hidden, true); assert.equal(element('restart').disabled, true);
});
