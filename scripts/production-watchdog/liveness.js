"use strict";

// Browser evidence can establish activity, not private model/backend state.
// No single timer or DOM indicator is sufficient to authorize a replacement.
const POLICY = Object.freeze({
  quietMs: 60 * 1000,
  confirmMs: 2 * 60 * 1000,
  terminalConfirmMs: 15 * 1000,
  observerStaleMs: 60 * 1000,
  recentMs: 30 * 1000
});

function evaluateLiveness(previous, evidence, now, policy = POLICY) {
  const next = { ...previous };
  const result = (phase, reason, action = "NONE") => ({ next, phase, reason, action });
  if (!evidence.enabled) {
    next.suspectAt = 0; next.terminalAt = 0;
    return result("PAUSED", "monitor_inactive");
  }
  if (evidence.blocked) { next.suspectAt = 0; next.terminalAt = 0; return result("BLOCKED", evidence.blocked); }
  if (!evidence.observerAt || now - evidence.observerAt > policy.observerStaleMs) {
    next.suspectAt = 0; next.terminalAt = 0;
    return result("OBSERVER_OFFLINE", "observer_missing_repair_only");
  }
  if (evidence.leaseUntil > now || evidence.manualStopUntil > now) {
    next.suspectAt = 0; next.terminalAt = 0;
    return result("WAITING", "tool_controller_or_manual_stop_protected");
  }
  if (evidence.thinkingSignal === "extended_thinking") {
    next.suspectAt = 0; next.terminalAt = 0;
    return result("WAITING", "extended_thinking_observed");
  }
  const progressAt = Math.max(evidence.startedAt || 0, evidence.semanticAt || 0,
    evidence.uiAt || 0, evidence.aeAt || 0, evidence.practiceAt || 0,
    evidence.productionAt || 0, evidence.productionHeartbeatAt || 0,
    !evidence.semanticCoverage ? (evidence.streamAt || 0) : 0);
  const quietAgeMs = progressAt ? Math.max(0, now - progressAt) : 0;
  const live = evidence.stopVisible || evidence.activeRequests > 0 || evidence.streamRequests > 0;
  const recentProgress = progressAt && now - progressAt < policy.recentMs;
  const recentTransport = !evidence.semanticCoverage && evidence.streamAt && now - evidence.streamAt < policy.recentMs;
  const recentProductionHeartbeat = evidence.productionHeartbeatAt
    && now - evidence.productionHeartbeatAt < policy.quietMs;
  if (evidence.productionInFlight && recentProductionHeartbeat) {
    next.suspectAt = 0; next.terminalAt = 0;
    return result("PROCESSING", "production_operation_in_flight");
  }

  // An old error banner or request cannot override newer processing evidence.
  if (evidence.terminal && !live && !recentProgress) {
    if (!next.terminalAt || next.terminalKey !== evidence.terminal) {
      next.terminalAt = now; next.terminalKey = evidence.terminal;
    }
    if (now - next.terminalAt >= policy.terminalConfirmMs) {
      if (evidence.controllerLeaseUntil > now && evidence.idleUi === true) {
        return result("RECOVERING", "expired_ui_controller_reserved", "REPAIR_OWNER");
      }
      return result("TERMINAL", evidence.terminal, "HANDOFF");
    }
    return result("VERIFYING", "terminal_confirmation");
  }
  next.terminalAt = 0; next.terminalKey = null;
  if (evidence.controllerLeaseUntil > now) {
    next.suspectAt = 0;
    return result("WAITING", "controller_reserved");
  }
  if (evidence.completedAt && !live && !(recentProgress && progressAt > evidence.completedAt) &&
      evidence.completedAt >= evidence.startedAt) {
    return result("COMPLETED", "response_complete", "HANDOFF");
  }
  if (!evidence.startedAt) return result("WAITING", "generation_not_observed");
  if (recentProgress || recentTransport || quietAgeMs < policy.quietMs) {
    next.suspectAt = 0;
    return result(live ? "PROCESSING" : "WAITING", recentProgress ? "processing_evidence" : "quiet_generation_grace");
  }

  // Keepalive traffic is insufficient by itself. A confirmed suspicion needs
  // a healthy observer and another two minutes with no new progress/traffic.
  if (next.suspectAt && progressAt > (next.suspectProgressAt || 0)) next.suspectAt = 0;
  if (!next.suspectAt) { next.suspectAt = now; next.suspectProgressAt = progressAt; }
  if (now - next.suspectAt < policy.confirmMs) return result("SUSPECT", "silence_confirmation");
  return result("STALLED", "confirmed_multi_signal_silence", "HANDOFF");
}

module.exports = { POLICY, evaluateLiveness };
