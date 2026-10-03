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
    base, token = _practice_config()
    target_path = path
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        base + target_path,
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
        raise RuntimeError(f"Current EditFlow control error {exc.code}: {detail}") from exc


def _execute_queued(kind: str, payload: dict[str, Any], wait_seconds: float = 30) -> dict[str, Any]:
    context = payload.get("researchContext")
    if not isinstance(context, dict) or not context.get("assignmentId") or not context.get("claimedBy"):
        raise ValueError("Production execution requires researchContext for the active assignment and live controller")
    safe_id = urllib.parse.quote(context["assignmentId"], safe="")
    endpoint = f"/v1/product/gpt/assignments/{safe_id}/production-jobs"
    accepted = _practice_http("POST", endpoint, {"kind": kind, "payload": payload, "dependencyIds": []})
    job = accepted["job"]
    deadline = time.monotonic() + wait_seconds
    while job["status"] in ("PENDING", "RUNNING") and time.monotonic() < deadline:
        time.sleep(.1)
        safe_job = urllib.parse.quote(job["jobId"], safe="")
        try:
            job = _practice_http("GET", endpoint + "?jobId=" + safe_job)["job"]
        except Exception as exc:
            return {"productionJobId": job["jobId"], "productionStatus": job["status"],
                    "executionPath": "DURABLE_PRODUCTION_QUEUE_V1", "pollError": str(exc),
                    "nextAction": "Resume this job receipt; do not resubmit or switch execution paths."}
    result = job.get("result", {})
    return {**(result if isinstance(result, dict) else {"result": result}),
            "productionJobId": job["jobId"], "productionStatus": job["status"],
            "executionPath": "DURABLE_PRODUCTION_QUEUE_V1",
            **({"error": job["error"]} if job.get("error") else {})}


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
        """Read live AE state and the durable Practice resume handshake together."""
        state = _http("GET", "/state")
        state["practiceResume"] = _practice_http("GET", "/v1/product/practice/resume-or-start")
        return state

    @mcp.tool()
    def resume_or_start_practice(start_json: str = "") -> dict[str, Any]:
        """Inspect Practice, or submit an explicit USER lifecycle request in start_json.

        Actions: START_PRACTICE (input with chosen files/Edit Type), RESTART_PRACTICE
        (same inputs, fresh assignment), REPLACE_CHAT (same assignment/checkpoints),
        CANCEL, RETRY, STATUS. Mutations require userRequested:true and a stable
        requestId; restart/replace/cancel require expectedAssignmentId. STATUS with
        that requestId returns PENDING/COMPLETED/BLOCKED/FAILED and verified IDs.
        No worker credential is required. Never invent a lifecycle request or
        report completion before its receipt says COMPLETED.
        """
        if not start_json:
            return _practice_http("GET", "/v1/product/practice/resume-or-start")
        payload = json.loads(start_json)
        if not isinstance(payload, dict):
            raise ValueError("Practice resume request must be a JSON object.")
        return _practice_http("POST", "/v1/product/practice/resume-or-start", payload)

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
        """Describe the current Shadow MCP surface backed by the primary production system."""
        return {
            "service": "EditFlow Current Shadow Gateway",
            "primarySystemOnly": True,
            "primaryExecution": "DURABLE_PRODUCTION_QUEUE_V1",
            "tools": [
                "get_edit_state", "get_editflow2_state", "get_after_effects_state",
                "probe_after_effects", "get_production_status", "list_adaptive_capabilities",
                "triage_error", "remember_error_resolution", "get_error_memory", "record_error_outcome",
                "validate_edit_plan", "apply_edit_plan", "fast_ae_run", "fast_ae_batch", "fast_ae_refresh",
                "get_next_gpt_assignment", "get_gpt_assignment", "claim_gpt_assignment",
                "get_clip_research_contract", "get_clip_research", "record_clip_research",
                "get_footage_selection", "inspect_or_select_footage",
                "enqueue_production_job", "get_production_jobs", "resolve_production_job",
                "record_gpt_learning_event", "complete_gpt_assignment", "fail_gpt_assignment",
                "acknowledge_gpt_assignment_cancelled", "get_editflow_run", "cancel_editflow_run",
                "resume_or_start_practice",
            ],
            "userLifecycleControls": _practice_http("GET", "/v1/product/production/user-controls"),
        }

    @mcp.tool()
    def list_adaptive_capabilities() -> dict[str, Any]:
        """Describe capabilities available through the current primary production surface."""
        status = _http("GET", "/status")
        return {
            "service": "EditFlow Current Shadow Gateway",
            "primarySystemOnly": True,
            "primaryExecution": "DURABLE_PRODUCTION_QUEUE_V1",
            "hostRevision": status.get("hostRevision"),
            "executionMode": status.get("executionMode"),
            "controlPlane": status.get("controlPlane"),
            "capabilities": [
                "CURRENT_AE_STATE", "WARM_CEP_PROBE", "DURABLE_PRODUCTION_QUEUE_V1",
                "ROUTINE_DECISION_ENGINE", "WARM_BATCH_COMPONENT", "ERROR_TRIAGE_MEMORY",
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
        """Submit authorized AE work to the durable production worker; preserve the job receipt on timeout."""
        parsed = json.loads(operations_json)
        decision = json.loads(decision_json) if decision_json else {}
        research_context = decision.get("researchContext", parsed.get("researchContext") if isinstance(parsed, dict) else None)
        transaction_id = idempotency_key or plan_id or f"shadow-fast-{int(time.time() * 1000)}"
        if isinstance(parsed, list):
            if not parsed:
                raise ValueError("operations_json routine-intent list must not be empty")
            result = _execute_queued("AE_BATCH", {"intents": parsed, "transactionId": transaction_id, "researchContext": research_context})
            execution_path = "DURABLE_PRODUCTION_QUEUE_V1"
        else:
            goal = _normalize_goal(operations_json)
            result = _execute_queued("AE_GOAL", {"goal": goal, "transactionId": transaction_id, "researchContext": research_context})
            execution_path = "DURABLE_PRODUCTION_QUEUE_V1"
        return {"baseRevision": base_revision, "planId": plan_id, "executionPath": execution_path, "result": result}

    @mcp.tool()
    def fast_ae_run(goal_json: str, transaction_id: str = "") -> dict[str, Any]:
        """Run an authorized AE goal as a durable production job using the shared warm CEP runtime."""
        packet = json.loads(goal_json)
        if not isinstance(packet, dict):
            raise ValueError("goal_json must decode to an object")
        goal = packet.get("goal", packet)
        tx = transaction_id or f"shadow-fast-{int(time.time() * 1000)}"
        return _execute_queued("AE_GOAL", {"goal": goal, "transactionId": tx, "researchContext": packet.get("researchContext")})

    @mcp.tool()
    def fast_ae_batch(intents_json: str, transaction_id: str = "") -> dict[str, Any]:
        """Queue up to 64 allow-listed AE actions on the sole production writer; no direct-execution fallback."""
        packet = json.loads(intents_json)
        intents = packet.get("intents") if isinstance(packet, dict) else packet
        if not isinstance(intents, list) or not intents:
            raise ValueError("intents_json must decode to a non-empty routine-intent list")
        tx = transaction_id or f"shadow-batch-{int(time.time() * 1000)}"
        return _execute_queued("AE_BATCH", {"intents": intents, "transactionId": tx, "researchContext": packet.get("researchContext") if isinstance(packet, dict) else None})

    @mcp.tool()
    def enqueue_production_job(assignment_id: str, job_json: str) -> dict[str, Any]:
        """Submit deterministic authorized work to the sole Practice/Pro Creation production worker."""
        payload = json.loads(job_json)
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("POST", f"/v1/product/gpt/assignments/{safe_id}/production-jobs", payload)

    @mcp.tool()
    def get_production_jobs(assignment_id: str, job_id: str = "") -> dict[str, Any]:
        """Inspect durable jobs; use a retained job_id to resume instead of resubmitting work."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        query = "?jobId=" + urllib.parse.quote(job_id, safe="") if job_id else ""
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/production-jobs" + query)

    @mcp.tool()
    def resolve_production_job(assignment_id: str, job_id: str, claimed_by: str, review_evidence_ref: str, result_json: str = "{}") -> dict[str, Any]:
        """Reconcile held work after inspecting actual AE readback/render evidence; never blindly replay a write."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("POST", f"/v1/product/gpt/assignments/{safe_id}/production-jobs", {
            "action": "RESOLVE", "jobId": job_id, "claimedBy": claimed_by,
            "reviewEvidenceRef": review_evidence_ref, "result": json.loads(result_json)})

    @mcp.tool()
    def get_footage_selection(assignment_id: str) -> dict[str, Any]:
        """Read supplied raw media, reference shot boundaries and direct ChatGPT shot-selection contract; no ranked candidates."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/footage-selection")

    @mcp.tool()
    def inspect_or_select_footage(assignment_id: str, request_json: str) -> dict[str, Any]:
        """BROWSE explicit GPT-chosen timestamps or SELECT ranges backed by direct pixel comparisons. Supply current claimedBy; no AE changes."""
        payload = json.loads(request_json)
        if not isinstance(payload, dict):
            raise ValueError("Footage request must be a JSON object with the current claimedBy.")
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("POST", f"/v1/product/gpt/assignments/{safe_id}/footage-selection", payload)

    @mcp.tool()
    def fast_ae_refresh() -> dict[str, Any]:
        """Refresh the current AE world model at a meaningful checkpoint."""
        return _http("GET", "/state")

    @mcp.tool()
    def get_clip_research_contract() -> dict[str, Any]:
        """Read mandatory per-clip scan/tutorial/Adobe/web research payloads before AE editing."""
        return _practice_http("GET", "/v1/product/gpt/clip-research-contract")

    @mcp.tool()
    def get_clip_research(assignment_id: str) -> dict[str, Any]:
        """Resume durable per-clip inspections, consulted methods, READY plans and execution audit."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/clip-research")

    @mcp.tool()
    def record_clip_research(assignment_id: str, research_json: str) -> dict[str, Any]:
        """Record SCAN, SOURCE or PLAN with the live controller owner before changing a clip."""
        payload = json.loads(research_json)
        if not isinstance(payload, dict):
            raise ValueError("research_json must be an object matching get_clip_research_contract")
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("POST", f"/v1/product/gpt/assignments/{safe_id}/clip-research", payload)

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
