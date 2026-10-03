"use strict";
const BASE = 'http://127.0.0.1:32147';
let busy = false;
async function request(route, value) {
  const response = await fetch(BASE + route, { method: value ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-editflow-actuator-id': chrome.runtime.id }, ...(value ? { body: JSON.stringify(value) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'SUPERVISOR_UNAVAILABLE'); return result;
}
async function attach(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'EDITFLOW_ACTUATOR_PING' }); }
  catch (_) { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); }
}
async function execute() {
  if (busy) return; busy = true;
  let cmd;
  try {
    cmd = await request('/actuator');
    if (cmd.command === 'NONE' && cmd.recoverLaunchId) {
      const saved = await chrome.storage.local.get('launchTabs');
      const tabId = saved.launchTabs?.[cmd.recoverLaunchId];
      if (Number.isInteger(tabId) && await chrome.tabs.get(tabId).catch(() => null)) {
        await request('/actuator/ack', { type: 'OWNER_TARGET', launchId: cmd.recoverLaunchId, tabId });
      }
    } else if (cmd.command === 'STOP_CLOSE') {
      const tab = await chrome.tabs.get(cmd.tabId).catch(() => null);
      if (tab) {
        // Authority was revoked before this instruction. Stop failure cannot
        // block safe replacement, and no other conversation is inspected.
        try { await attach(tab.id); await chrome.tabs.sendMessage(tab.id, { type: 'EDITFLOW_ACTUATOR_STOP', expectedUrl: tab.url }); } catch (_) {}
        await chrome.tabs.remove(tab.id);
      }
      await request('/actuator/ack', { id: cmd.id, type: 'CLOSED' });
    } else if (cmd.command === 'CREATE') {
      const saved = await chrome.storage.local.get('launchTabs');
      let tabId = saved.launchTabs?.[cmd.id];
      let tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
      if (!tab) {
        tab = await chrome.tabs.create({ url: 'https://chatgpt.com/', active: false });
        await chrome.storage.local.set({ launchTabs: { [cmd.id]: tab.id } });
      }
      await chrome.tabs.update(tab.id, { autoDiscardable: false });
      try { await request('/actuator/ack', { id: cmd.id, type: 'CREATED', tabId: tab.id }); }
      catch (e) { if (e.message === 'STALE_ACTUATOR_ACK') await chrome.tabs.remove(tab.id).catch(() => {}); throw e; }
    } else if (cmd.command === 'SEND') {
      const tab = await chrome.tabs.get(cmd.tabId).catch(() => null);
      if (!tab) { await request('/actuator/ack', { id: cmd.id, type: 'MISSING' }); return; }
      if (tab.status !== 'complete') return;
      await attach(tab.id);
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'EDITFLOW_ACTUATOR_SEND', id: cmd.id, prompt: cmd.prompt });
      if (!reply?.sent) throw Error(reply?.error || 'SEND_NOT_CONFIRMED');
      await request('/actuator/ack', { id: cmd.id, type: 'SENT', tabId: tab.id });
      await chrome.storage.local.set({ activeWorkerTabId: tab.id });
    }
  } catch (e) {
    if (cmd?.id) await request('/actuator/ack', { id: cmd.id, type: 'FAILED', error: e.message }).catch(() => {});
  } finally { busy = false; }
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'editflow-actuator') void execute(); });
async function initialize() {
  await chrome.alarms.clearAll();
  await chrome.alarms.create('editflow-actuator', { periodInMinutes: 0.5 });
  await request('/actuator/ack', { type: 'READY', version: chrome.runtime.getManifest().version }).catch(() => {});
  void execute();
}
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.runtime.onInstalled.addListener(() => { void initialize(); });
setInterval(() => { void execute(); }, 3000);
void initialize();
