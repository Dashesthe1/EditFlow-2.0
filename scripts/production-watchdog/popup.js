async function refresh() {
  const health = await fetch('http://127.0.0.1:32147/health').then(r => r.json()).catch(() => null);
  document.querySelector('#status').textContent = health ? `${health.phase}: ${health.reason || ''}\nWorker generation: ${health.authority?.generation || 0}\nProgress sequence: ${health.progressSeq}\n${health.assignment?.mode || 'No active production'}` : 'Supervisor unavailable';
}
for (const action of ['pause', 'resume']) document.querySelector('#' + action).onclick = async () => { await fetch('http://127.0.0.1:32147/' + action, { method: 'POST' }); await refresh(); };
void refresh();
