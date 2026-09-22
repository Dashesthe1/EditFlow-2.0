from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

CONTROL = "http://127.0.0.1:32146"


def _practice_config() -> tuple[str, str]:
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    config_path = os.path.join(local_app_data, "EditFlow2", "bridge-config.json")
    with open(config_path, "r", encoding="utf-8-sig") as handle:
        config = json.load(handle)
    port = int(config.get("productPort") or (int(config["port"]) + 1))
    token = str(config["token"])
    return f"http://127.0.0.1:{port}", token


def _practice_http(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base, token = _practice_config()
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-EditFlow-Token": token,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=35) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Practice bridge error {exc.code}: {detail}") from exc


def _http(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        CONTROL + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=35) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Current EditFlow control error {exc.code}: {detail}") from exc


def _normalize_goal(operations_json: str) -> dict[str, Any]:
    parsed = json.loads(operations_json)
    if isinstance(parsed, list):
        return {"kind": "SHORT_HORIZON", "intents": parsed}
    if isinstance(parsed, dict) and isinstance(parsed.get("goal"), dict):
        return parsed["goal"]
    if isinstance(parsed, dict) and isinstance(parsed.get("kind"), str):
        return parsed
    raise ValueError("operations_json must be a routine-intent list or a fast-loop goal object")


def build_server():
    try:
        from mcp.server.mcpserver import MCPServer
    except ImportError as exc:
        raise RuntimeError("MCP SDK v2 is required for the current Shadow gateway") from exc

    mcp = MCPServer("EditFlow Current Shadow Gateway")

    @mcp.tool()
    def get_edit_state() -> dict[str, Any]:
        """Compatibility alias for the current EditFlow/AE state. Use first."""
        return _http("GET", "/state")

    @mcp.tool()
    def get_editflow2_state() -> dict[str, Any]:
        """Read the current EditFlow control-plane and live After Effects state."""
        return _http("GET", "/state")

    @mcp.tool()
    def get_after_effects_state() -> dict[str, Any]:
        """Read the live After Effects project state through the current warm CEP path."""
        return _http("GET", "/state")

    @mcp.tool()
    def probe_after_effects() -> dict[str, Any]:
        """Probe the current warm AE/CEP path without restarting After Effects."""
        state = _http("GET", "/state")
        return {
            "ok": True,
            "environment": state.get("state", {}).get("environment"),
            "hostRevision": state.get("revision"),
        }

    @mcp.tool()
    def get_production_status() -> dict[str, Any]:
        """Return fast-path runtime, CEP panel, host revision and control-plane status."""
        return _http("GET", "/status")

    @mcp.tool()
    def triage_error(error_text: str, context_json: str = "") -> dict[str, Any]:
        """Classify an exact failure locally first and return a known fix or bounded lookup plan."""
        payload: dict[str, Any] = {"errorText": error_text}
        if context_json:
            payload["context"] = json.loads(context_json)
        return _http("POST", "/triage-error", payload)

    @mcp.tool()
    def remember_error_resolution(
        error_text: str,
        resolution: str,
        avoid_repeat: str = "",
        domain: str = "",
        code: str = "",
        verified: bool = True,
    ) -> dict[str, Any]:
        """Persist a proven failure resolution so the same normalized signature is fixed locally next time."""
        payload: dict[str, Any] = {"errorText": error_text, "resolution": resolution, "verified": verified}
        if avoid_repeat:
            payload["avoidRepeat"] = avoid_repeat
        if domain:
            payload["domain"] = domain
        if code:
            payload["code"] = code
        return _http("POST", "/remember-error", payload)

    @mcp.tool()
    def get_error_memory(limit: int = 20) -> dict[str, Any]:
        """Read recent normalized error signatures and their retained fixes."""
        safe_limit = max(1, min(100, int(limit)))
        return _http("GET", f"/error-memory?limit={safe_limit}")

    @mcp.tool()
    def record_error_outcome(signature: str, success: bool) -> dict[str, Any]:
        """Record whether applying a retained fix succeeded, improving future triage confidence."""
        return _http("POST", "/error-outcome", {"signature": signature, "success": success})

    @mcp.tool()
    def get_mcp_surface() -> dict[str, Any]:
        """Describe the stable Shadow compatibility surface backed by the current repo."""
        return {
            "service": "EditFlow Current Shadow Gateway",
            "legacyCompatibility": True,
            "primaryExecution": "EDITOR_BRAIN_CONTINUOUS_FAST_LOOP_V0",
            "tools": [
                "get_edit_state", "get_editflow2_state", "get_after_effects_state",
                "probe_after_effects", "get_production_status", "list_adaptive_capabilities",
                "triage_error", "remember_error_resolution", "get_error_memory", "record_error_outcome",
                "validate_edit_plan", "apply_edit_plan", "fast_ae_run", "fast_ae_batch", "fast_ae_refresh",
                "get_next_gpt_assignment", "get_gpt_assignment", "claim_gpt_assignment",
                "record_gpt_learning_event", "complete_gpt_assignment", "fail_gpt_assignment",
                "acknowledge_gpt_assignment_cancelled", "get_editflow_run", "cancel_editflow_run",
            ],
        }

    @mcp.tool()
    def list_adaptive_capabilities() -> dict[str, Any]:
        """Legacy introspection alias for the current fast-path capability surface."""
        status = _http("GET", "/status")
        return {
            "service": "EditFlow Current Shadow Gateway",
            "compatibilityAlias": True,
            "primaryExecution": "EDITOR_BRAIN_CONTINUOUS_FAST_LOOP_V0",
            "hostRevision": status.get("hostRevision"),
            "executionMode": status.get("executionMode"),
            "controlPlane": status.get("controlPlane"),
            "capabilities": [
                "CURRENT_AE_STATE", "WARM_CEP_PROBE", "CONTINUOUS_FAST_LOOP",
                "ROUTINE_DECISION_ENGINE", "LOCAL_BATCH_RUNTIME", "ERROR_TRIAGE_MEMORY",
                "VALIDATE_EDIT_PLAN", "APPLY_EDIT_PLAN", "GPT_PRACTICE_ORCHESTRATION",
                "EDIT_TYPE_LEARNING_TRACE", "PRACTICE_PRO_CREATION_CANCELLATION",
            ],
        }

    @mcp.tool()
    def validate_edit_plan(
        base_revision: int,
        operations_json: str,
        plan_id: str = "",
        decision_json: str = "",
    ) -> dict[str, Any]:
        """Validate a current fast-loop goal or routine-intent list without mutating AE."""
        goal = _normalize_goal(operations_json)
        state = _http("GET", "/status")
        return {
            "valid": True,
            "baseRevision": base_revision,
            "hostRevision": state.get("hostRevision"),
            "planId": plan_id,
            "goal": goal,
        }

    @mcp.tool()
    def apply_edit_plan(
        base_revision: int,
        operations_json: str,
        plan_id: str = "",
        idempotency_key: str = "",
        decision_json: str = "",
    ) -> dict[str, Any]:
        """Execute a validated short-horizon goal through the persistent ContinuousFastLoop."""
        parsed = json.loads(operations_json)
        transaction_id = idempotency_key or plan_id or f"shadow-fast-{int(time.time() * 1000)}"
        if isinstance(parsed, list):
            if not parsed:
                raise ValueError("operations_json routine-intent list must not be empty")
            result = _http("POST", "/run-batch", {"intents": parsed, "transactionId": transaction_id})
            execution_path = "LOCAL_BATCH_RUNTIME"
        else:
            goal = _normalize_goal(operations_json)
            result = _http("POST", "/run", {"goal": goal, "transactionId": transaction_id})
            execution_path = "CONTINUOUS_FAST_LOOP"
        return {"baseRevision": base_revision, "planId": plan_id, "executionPath": execution_path, "result": result}

    @mcp.tool()
    def fast_ae_run(goal_json: str, transaction_id: str = "") -> dict[str, Any]:
        """Run one current-repo fast-loop goal while preserving the warm CEP lease/state."""
        goal = json.loads(goal_json)
        if not isinstance(goal, dict):
            raise ValueError("goal_json must decode to an object")
        tx = transaction_id or f"shadow-fast-{int(time.time() * 1000)}"
        return _http("POST", "/run", {"goal": goal, "transactionId": tx})

    @mcp.tool()
    def fast_ae_batch(intents_json: str, transaction_id: str = "") -> dict[str, Any]:
        """Execute up to 64 allow-listed AE routine actions locally in one MCP round trip."""
        intents = json.loads(intents_json)
        if not isinstance(intents, list) or not intents:
            raise ValueError("intents_json must decode to a non-empty routine-intent list")
        tx = transaction_id or f"shadow-batch-{int(time.time() * 1000)}"
        return _http("POST", "/run-batch", {"intents": intents, "transactionId": tx})

    @mcp.tool()
    def fast_ae_refresh() -> dict[str, Any]:
        """Refresh the current AE world model at a meaningful checkpoint."""
        return _http("GET", "/state")

    @mcp.tool()
    def get_next_gpt_assignment() -> dict[str, Any]:
        """Get the next Practice or Pro Creation assignment created for ChatGPT by the AE panel."""
        return _practice_http("GET", "/v1/product/gpt/assignments/next")

    @mcp.tool()
    def get_gpt_assignment(assignment_id: str) -> dict[str, Any]:
        """Read one GPT assignment, its complete editing brief, learning trace, and cancellation state."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}")

    @mcp.tool()
    def claim_gpt_assignment(
        assignment_id: str,
        claimed_by: str = "chatgpt-work",
    ) -> dict[str, Any]:
        """Claim a queued EditFlow assignment before GPT begins reasoning or mutating After Effects."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http(
            "POST",
            f"/v1/product/gpt/assignments/{safe_id}/claim",
            {"claimedBy": claimed_by},
        )

    @mcp.tool()
    def record_gpt_learning_event(
        assignment_id: str,
        stage: str,
        summary: str,
        outcome: str = "NEUTRAL",
        attempt: int = 0,
        detail: str = "",
        development_pattern: str = "",
        reusable_lesson: str = "",
        avoid_repeat: str = "",
        evidence_refs_json: str = "[]",
    ) -> dict[str, Any]:
        """Record one observation-to-lesson event under the assignment's selected Edit Type."""
        evidence_refs = json.loads(evidence_refs_json)
        if not isinstance(evidence_refs, list) or any(not isinstance(item, str) for item in evidence_refs):
            raise ValueError("evidence_refs_json must decode to a string array")
        payload: dict[str, Any] = {
            "stage": stage,
            "summary": summary,
            "outcome": outcome,
            "evidenceRefs": evidence_refs,
        }
        if attempt > 0:
            payload["attempt"] = int(attempt)
        if detail:
            payload["detail"] = detail
        if development_pattern:
            payload["developmentPattern"] = development_pattern
        if reusable_lesson:
            payload["reusableLesson"] = reusable_lesson
        if avoid_repeat:
            payload["avoidRepeat"] = avoid_repeat
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http(
            "POST",
            f"/v1/product/gpt/assignments/{safe_id}/events",
            payload,
        )

    @mcp.tool()
    def complete_gpt_assignment(
        assignment_id: str,
        success: bool,
        final_summary: str,
        final_render_ref: str = "",
    ) -> dict[str, Any]:
        """Complete GPT's assignment; cancelled assignments cannot be certified as successful."""
        payload: dict[str, Any] = {
            "success": bool(success),
            "finalSummary": final_summary,
        }
        if final_render_ref:
            payload["finalRenderRef"] = final_render_ref
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http(
            "POST",
            f"/v1/product/gpt/assignments/{safe_id}/complete",
            payload,
        )

    @mcp.tool()
    def fail_gpt_assignment(assignment_id: str, error: str) -> dict[str, Any]:
        """Fail an EditFlow GPT assignment with an actionable error."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http(
            "POST",
            f"/v1/product/gpt/assignments/{safe_id}/fail",
            {"error": error},
        )

    @mcp.tool()
    def acknowledge_gpt_assignment_cancelled(
        assignment_id: str,
        summary: str = "GPT stopped safely at an EditFlow checkpoint.",
    ) -> dict[str, Any]:
        """Acknowledge that GPT stopped AE work after observing a cancellation request."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http(
            "POST",
            f"/v1/product/gpt/assignments/{safe_id}/cancelled",
            {"summary": summary},
        )

    @mcp.tool()
    def get_editflow_run(session_id: str) -> dict[str, Any]:
        """Read current Practice or Pro Creation progress for cancellation and UI synchronization."""
        safe_id = urllib.parse.quote(session_id, safe="")
        return _practice_http("GET", f"/v1/product/runs/{safe_id}")

    @mcp.tool()
    def cancel_editflow_run(session_id: str) -> dict[str, Any]:
        """Request a safe stop for a Practice or Pro Creation session."""
        safe_id = urllib.parse.quote(session_id, safe="")
        return _practice_http("POST", f"/v1/product/runs/{safe_id}/cancel", {})

    return mcp


mcp = build_server()


def main() -> int:
    parser = argparse.ArgumentParser(prog="editflow-current-shadow-gateway")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8770)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("Current Shadow gateway is loopback-only; expose it only through the protected tunnel route.")
    from mcp.server.transport_security import TransportSecuritySettings
    allowed_hosts = ["127.0.0.1:*", "localhost:*", "[::1]:*"]
    allowed_origins = ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"]
    for host in os.environ.get("EDITFLOW_SHADOW_ALLOWED_HOSTS", "").split(","):
        host = host.strip().rstrip(".")
        if not host:
            continue
        allowed_hosts.extend([host, f"{host}:*"])
        allowed_origins.append(f"https://{host}")
    transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=allowed_hosts,
        allowed_origins=allowed_origins,
    )
    mcp.run(
        "streamable-http",
        host=args.host,
        port=args.port,
        json_response=True,
        transport_security=transport_security,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
