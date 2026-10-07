'use strict';

// One repair process at a time. Its exit code never substitutes for MCP readback.
function createRecoveryRunner({ spawn, script, probe, log, completed, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, cooldownMs = 30000, timeoutMs = 240000 }) {
  let running = false, lastStarted = -Infinity;
  return {
    running: () => running,
    run(health, assignmentId) {
      if (health.ready || health.failures < 2 || running || now() - lastStarted < cooldownMs) return false;
      running = true; lastStarted = now();
      log('transport_recovery_required', { status: health.status });
      let child, timer, finished = false;
      const finish = async (reason, exitCode = null) => {
        if (finished) return; finished = true; clearTimer(timer);
        try {
          const after = await probe();
          log('transport_recovery_completed', { reason, exitCode, ready: !!after.ready, status: after.status });
        } catch {
          log('transport_recovery_failed', { reason: 'RECOVERY_READBACK_FAILED', exitCode });
        } finally { running = false; completed(); }
      };
      try {
        child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
          '-Reason', 'mcp_transport_unavailable', ...(assignmentId ? ['-AssignmentId', assignmentId] : [])],
          { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', () => { void finish('RECOVERY_PROCESS_FAILED'); });
        child.once('exit', code => { void finish(code === 0 ? 'PROCESS_EXITED' : 'RECOVERY_PROCESS_FAILED', code); });
        timer = setTimer(() => { void finish('RECOVERY_TIMEOUT'); child.kill(); }, timeoutMs);
        timer?.unref?.(); child.unref();
      } catch { void finish('RECOVERY_PROCESS_FAILED'); }
      return true;
    },
  };
}
module.exports = { createRecoveryRunner };
