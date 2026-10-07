const BASE = 'http://127.0.0.1:32147';
let health, activeRequestId = null, displayedReceipt = null;
async function request(route, value) {
  const response = await fetch(BASE + route, { method: value ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-editflow-actuator-id': chrome.runtime.id },
    ...(value ? { body: JSON.stringify(value) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Supervisor unavailable'); return result;
}
function showReceipt(receipt) {
  displayedReceipt = receipt;
  document.querySelector('#receipt').textContent = receipt
    ? `${receipt.status === 'FAILED' && receipt.error?.startsWith('Dismissed by user') ? 'DISMISSED' : receipt.status} — ${receipt.action}\n${receipt.step}${receipt.error ? ': ' + receipt.error : ''}\nRequest: ${receipt.requestId}\nPrevious assignment: ${receipt.previousAssignmentId || 'None'}\nAssignment: ${receipt.assignmentId || 'Not created yet'}\nWorker generation: ${receipt.generation ?? 'Not verified yet'}${receipt.completedAt ? (receipt.status === 'COMPLETED' ? '\nVerified: ' : '\nClosed: ') + receipt.completedAt : ''}`
    : 'No requested action yet.';
}
async function refresh() {
  try {
    health = await request('/health');
    document.querySelector('#status').textContent = `${health.phase}: ${health.reason || ''}\nWorker generation: ${health.authority?.generation || 0}\n${health.assignment?.mode || 'No active production'}`;
    const receipt = (await request('/user-controls' + (activeRequestId ? '?requestId=' + encodeURIComponent(activeRequestId) : ''))).receipt;
    showReceipt(receipt);
    const busy = !!health.userControl;
    document.querySelector('#restart').disabled = busy || health.assignment?.mode !== 'PRACTICE';
    document.querySelector('#replace').disabled = busy || !['PENDING', 'RUNNING', 'FAILED'].includes(health.assignment?.status);
    document.querySelector('#retry').hidden = receipt?.status !== 'BLOCKED';
    document.querySelector('#retry').disabled = /EDIT_TYPE_NOT_FOUND|Unknown Edit Type/.test(receipt?.error || '');
    document.querySelector('#dismiss').hidden = !(receipt?.status === 'BLOCKED'
      && ['QUEUED', 'PREPARING'].includes(receipt.step) && !receipt.assignmentId && receipt.generation === null && receipt.tabId === null);
    document.querySelector('#pause').disabled = busy || !health.assignment;
    document.querySelector('#resume').disabled = busy || health.authority?.state !== 'PAUSED' || health.assignment?.status === 'CANCEL_REQUESTED';
  } catch (e) { document.querySelector('#status').textContent = e.message; }
}
async function submit(action) {
  try {
    activeRequestId = crypto.randomUUID();
    const result = await request('/user-controls', { action, userRequested: true, requestId: activeRequestId,
      expectedAssignmentId: health.assignment?.assignmentId || health.authority?.assignmentId });
    showReceipt(result.receipt); await refresh();
  } catch (e) { document.querySelector('#receipt').textContent = 'BLOCKED — ' + e.message; activeRequestId = null; }
}
document.querySelector('#restart').onclick = () => submit('RESTART_PRACTICE');
document.querySelector('#replace').onclick = () => submit('REPLACE_CHAT');
document.querySelector('#retry').onclick = async () => {
  try { const receipt = displayedReceipt; activeRequestId = receipt.requestId;
    await request('/user-controls', { action: 'RETRY', userRequested: true, requestId: activeRequestId }); await refresh();
  } catch (e) { document.querySelector('#receipt').textContent = 'BLOCKED — ' + e.message; }
};
document.querySelector('#dismiss').onclick = async () => {
  try { const receipt = displayedReceipt;
    await request('/user-controls', { action: 'DISMISS', userRequested: true, requestId: receipt.requestId });
    activeRequestId = null; await refresh();
  } catch (e) { document.querySelector('#receipt').textContent = e.message; }
};
for (const action of ['pause', 'resume']) document.querySelector('#' + action).onclick = async () => {
  try { await request('/' + action, {}); await refresh(); }
  catch (e) { document.querySelector('#status').textContent = e.message; }
};
void refresh(); setInterval(() => { void refresh(); }, 2000);
