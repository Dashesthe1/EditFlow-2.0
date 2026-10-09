from __future__ import annotations

import argparse
import functools
import hashlib
import inspect
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

CONTROL = "http://127.0.0.1:32146"


class BridgeRequestError(RuntimeError):
    """An anticipated backend rejection; preserve its status and reason on MCP."""
    def __init__(self, source: str, status: int, detail: str):
        self.status = status
        try:
            body = json.loads(detail)
            reason = body.get("error", detail) if isinstance(body, dict) else detail
        except (ValueError, TypeError):
            reason = detail
        super().__init__(f"{source} HTTP {status}: {_safe_error_text(str(reason))}")


def _safe_error_text(value: str) -> str:
    # Error reasons can mention a lease owner. Never return worker/header secrets.
    value = re.sub(r"ef-worker:(\d+):[A-Za-z0-9_-]+", r"ef-worker:\1:REDACTED", value)
    value = re.sub(
        r'(?i)((?:x-editflow-(?:token|worker-credential|supervisor-key)|authorization)["\s:=]+)[^\s",;}]+',
        r"\1[REDACTED]", value,
    )
    return value[:4000]

CONNECTOR_CONTRACT_VERSION = "CURRENT_SHADOW_MCP_CLIENT_READY_V1"
REQUIRED_PRODUCTION_TOOLS = (
    "claim_gpt_assignment", "enqueue_production_job", "get_production_jobs",
    "inspect_or_select_footage", "record_practice_example", "complete_gpt_assignment",
)
PRODUCTION_UPDATE_ACTIONS = frozenset({
    "VISUAL_REVIEW", "WORKFLOW_PLAN", "WORKFLOW_REVIEW", "WORKFLOW_MILESTONE", "HEARTBEAT",
    "STAGE", "RESEARCH_READY", "WHOLE_EDIT_COVERED",
    "CONSTRUCTED", "AE_CHECKPOINT", "LOCAL_PROOF", "WHOLE_EDIT_PROOF",
    "INVALIDATE", "RESIDUALS", "TELEMETRY",
})


def _object_payload(value: str, label: str) -> dict[str, Any]:
    payload = json.loads(value)
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must decode to a JSON object")
    return payload


def _require_worker(credential: Any) -> str:
    if not isinstance(credential, str) or not credential.strip():
        raise ValueError("Use only the current worker credential from this chat's supervisor continuation prompt")
    return credential


def _connector_preflight(assignment_id: str, available_tools_json: str, registered: dict[str, Any]) -> dict[str, Any]:
    result = {
        "contractVersion": CONNECTOR_CONTRACT_VERSION,
        "status": "CLIENT_UNVERIFIED",
        "requiredTools": list(REQUIRED_PRODUCTION_TOOLS),
        "missingTools": None,
        "serverToolCount": len(registered),
        "metadataDigest": hashlib.sha256(json.dumps(registered, sort_keys=True).encode()).hexdigest(),
        "productionReadVerified": False,
        "jobsReadVerified": False,
        "writeAuthorization": "NOT_TESTED",
        "requiresClientRefresh": False,
        "instruction": "Report tools actually callable in this chat; server advertisement alone is not client readiness.",
    }
    if not available_tools_json:
        return result
    names = json.loads(available_tools_json)
    if not isinstance(names, list) or any(not isinstance(name, str) for name in names):
        raise ValueError("available_tools_json must be an array of actual callable tool names")
    normalized = {
        name.rsplit("__", 1)[-1].removeprefix("editflow_current_shadow_")
        for name in names
    }
    missing = [name for name in REQUIRED_PRODUCTION_TOOLS if name not in normalized]
    result["missingTools"] = missing
    if missing:
        result.update(status="BLOCKED_MISSING_TOOLS", requiresClientRefresh=True,
                      instruction="Refresh the existing Current Shadow connection, verify these tools, then resume the same assignment/checkpoint. Do not replace the assignment or use scripts.")
        return result
    if not assignment_id:
        result.update(status="ASSIGNMENT_REQUIRED", instruction="Supply the retained assignment_id for read-only production and queue checks.")
        return result
    safe_id = urllib.parse.quote(assignment_id, safe="")
    try:
        status = _http("GET", "/status")
        authority = status.get("productionSupervisor") or {}
        if authority.get("assignmentId") and authority["assignmentId"] != assignment_id:
            result.update(status="BLOCKED_ASSIGNMENT_MISMATCH", instruction="Inspect the current assignment. This check never authorizes claiming a different controller.")
            return result
        production = _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/production")
        jobs = _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/production-jobs")
        if not isinstance(production.get("production"), dict) or not isinstance(jobs.get("jobs"), list):
            raise ValueError("Production or queue response is incomplete")
        result.update(status="READY", productionReadVerified=True, jobsReadVerified=True,
                      assignmentId=assignment_id, generation=authority.get("generation"),
                      authorityState=authority.get("state"),
                      inFlightJobs=sum(job.get("status") in ("PENDING", "RUNNING") for job in jobs["jobs"]),
                      instruction="Tool coverage and reads verified. Writes still require this chat's issued worker credential and host approval; keep the current pause/assignment/checkpoint.")
    except (RuntimeError, ValueError, urllib.error.URLError):
        result.update(status="BLOCKED_PRODUCTION_READ",
                      instruction="Production/queue read failed. Report the exact failing read separately; do not claim, submit edits, replay jobs, or change supervision.")
    return result



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
        raise BridgeRequestError("Practice bridge", exc.code, detail) from exc


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
        raise BridgeRequestError("Current EditFlow control", exc.code, detail) from exc


def _execute_queued(kind: str, payload: dict[str, Any], wait_seconds: float = 30) -> dict[str, Any]:
    context = payload.get("researchContext")
    if not isinstance(context, dict) or not context.get("assignmentId") or not context.get("claimedBy"):
        raise ValueError("Production execution requires researchContext for the active assignment and live controller")
    safe_id = urllib.parse.quote(context["assignmentId"], safe="")
    endpoint = f"/v1/product/gpt/assignments/{safe_id}/production-jobs"
    accepted = _practice_http("POST", endpoint, {"kind": kind, "payload": payload, "dependencyIds": []})
    return _wait_queued(endpoint, accepted["job"], wait_seconds)


def _wait_queued(endpoint: str, job: dict[str, Any], wait_seconds: float = 30) -> dict[str, Any]:
    deadline = time.monotonic() + wait_seconds
    while job["status"] in ("PENDING", "RUNNING") and time.monotonic() < deadline:
        safe_job = urllib.parse.quote(job["jobId"], safe="")
        try:
            job = _practice_http("GET", endpoint + "?jobId=" + safe_job + "&waitMs=2000&after=" + urllib.parse.quote(job.get("updatedAt", ""), safe=""))["job"]
        except Exception as exc:
            return {"productionJobId": job["jobId"], "productionStatus": job["status"],
                    "executionPath": "DURABLE_PRODUCTION_QUEUE_V1", "pollError": str(exc),
                    "nextAction": "Resume this job receipt; do not resubmit or switch execution paths."}
    result = job.get("result", {})
    return {**(result if isinstance(result, dict) else {"result": result}),
            "job": {key: job[key] for key in ("jobId", "kind", "status", "updatedAt", "result", "error") if key in job},
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
        from mcp.server.mcpserver.exceptions import ToolError
    except ImportError as exc:
        raise RuntimeError("MCP SDK v2 is required for the current Shadow gateway") from exc

    mcp = MCPServer(
        "EditFlow Current Shadow Gateway",
        instructions="DIRECT_EDITING_V1: use claim_gpt_assignment once to receive the retained assignment, AE state, queue, checkpoint and notebook. Then think, enqueue exact AE batches, inspect and correct. For unfinished source identity discovery, use start_source_match with provided reference/raw paths, then get_source_match for batched original PTS and frame evidence. Preserve accepted retained selections; machine matching never substitutes for GPT visual review/SELECT. No separate tool-inventory preflight, per-clip research plan, workflow-plan approval or local PASS gate is required. Research only unfamiliar methods. The server verifies the issued worker and journals/checkpoints batches inside execution. Keep AE open, use provided raw inputs and review the whole final render directly. Recover uncertain writes by their retained receipts; never replay blindly. Respect actual host denials and stale-worker ownership. ChatGPT alone makes every editorial decision.",
    )
    registered: dict[str, Any] = {}

    def tool(*, read_only: bool = False, destructive: bool = True, open_world: bool = False):
        def register(fn):
            annotations = {"readOnlyHint": read_only, "destructiveHint": destructive, "openWorldHint": open_world}
            registered[fn.__name__] = {"annotations": annotations, "signature": str(inspect.signature(fn)), "description": inspect.getdoc(fn)}
            @functools.wraps(fn)
            def exposed(*args, **kwargs):
                try:
                    return fn(*args, **kwargs)
                except (BridgeRequestError, ValueError, urllib.error.URLError, TimeoutError) as exc:
                    action = ""
                    encoded = kwargs.get("update_json") or kwargs.get("job_json") or kwargs.get("action_json")
                    if isinstance(encoded, str):
                        try:
                            packet = json.loads(encoded)
                            if isinstance(packet, dict) and isinstance(packet.get("action"), str):
                                action = f" [{_safe_error_text(packet['action'])}]"
                        except ValueError:
                            pass
                    # ToolError is an expected MCP failure, not a masked crash.
                    # No retry, alternative transport, or mutation occurs here.
                    raise ToolError(f"{fn.__name__}{action}: {_safe_error_text(str(exc))}") from exc
            return mcp.tool(annotations=annotations)(exposed)
        return register

    @tool(read_only=True, destructive=False)
    def get_edit_state() -> dict[str, Any]:
        """Compatibility alias for the current EditFlow/AE state. Use first."""
        return _http("GET", "/state")

    @tool(read_only=True, destructive=False)
    def get_editflow2_state() -> dict[str, Any]:
        """Read live AE state and the durable Practice resume handshake together."""
        state = _http("GET", "/state")
        state["practiceResume"] = _practice_http("GET", "/v1/product/practice/resume-or-start")
        return state

    @tool()
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

    @tool(read_only=True, destructive=False)
    def get_after_effects_state() -> dict[str, Any]:
        """Read the live After Effects project state through the current warm CEP path."""
        return _http("GET", "/state")

    @tool(read_only=True, destructive=False)
    def probe_after_effects() -> dict[str, Any]:
        """Probe the current warm AE/CEP path without restarting After Effects."""
        state = _http("GET", "/state")
        return {
            "ok": True,
            "environment": state.get("state", {}).get("environment"),
            "hostRevision": state.get("revision"),
        }

    @tool(read_only=True, destructive=False)
    def get_production_status() -> dict[str, Any]:
        """Return fast-path runtime, CEP panel, host revision and control-plane status."""
        return _http("GET", "/status")

    @tool(destructive=False, open_world=True)
    def triage_error(error_text: str, context_json: str = "") -> dict[str, Any]:
        """Classify an exact failure locally first and return a known fix or bounded lookup plan."""
        payload: dict[str, Any] = {"errorText": error_text}
        if context_json:
            payload["context"] = json.loads(context_json)
        return _http("POST", "/triage-error", payload)

    @tool()
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

    @tool(read_only=True, destructive=False)
    def get_error_memory(limit: int = 20) -> dict[str, Any]:
        """Read recent normalized error signatures and their retained fixes."""
        safe_limit = max(1, min(100, int(limit)))
        return _http("GET", f"/error-memory?limit={safe_limit}")

    @tool()
    def record_error_outcome(signature: str, success: bool) -> dict[str, Any]:
        """Record whether applying a retained fix succeeded, improving future triage confidence."""
        return _http("POST", "/error-outcome", {"signature": signature, "success": success})

    @tool(read_only=True, destructive=False)
    def get_mcp_surface(assignment_id: str = "", available_tools_json: str = "") -> dict[str, Any]:
        """Optional connection diagnostics after a real tool/transport failure. DIRECT_EDITING_V1 resumes with claim_gpt_assignment directly; no tool inventory or READY preflight is required for normal editing."""
        return {
            "service": "EditFlow Current Shadow Gateway",
            "primarySystemOnly": True,
            "primaryExecution": "DURABLE_PRODUCTION_QUEUE_V1",
            "editorialDecisionAuthority": "CHATGPT_DIRECT",
            "automaticCreativeFallback": False,
            "presetLearning": "EXISTING_GPT_LEARNING_WORKED_EXAMPLES",
            "footageSelectionAuthority": "CHATGPT_DIRECT",
            "availableFootageSelectionMethods": ["CHATGPT_DIRECT"],
            "rawShotCandidateRanking": "REMOVED_FROM_PRODUCTION",
            "tools": list(registered),
            "connectorPreflight": _connector_preflight(assignment_id, available_tools_json, registered),
            "preferredProductionTools": {"read": "get_production_state", "write": "record_production_update", "queue": "enqueue_production_job", "receipts": "get_production_jobs"},
            "hostRejectionPolicy": "BLOCKED_CONNECTOR: retain the exact rejected action/reason; do not retry via scripts, hide credentials, or change permissions/supervision. STALE_WORKER is a distinct gateway response.",
            "userLifecycleControls": _practice_http("GET", "/v1/product/production/user-controls"),
        }

    @tool(read_only=True, destructive=False)
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

    @tool(read_only=True, destructive=False)
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
            "valid": goal.get("kind") in ("SHORT_HORIZON", "REFRAME"),
            "editorialAuthority": "CHATGPT_DIRECT",
            "baseRevision": base_revision,
            "hostRevision": state.get("hostRevision"),
            "planId": plan_id,
            "goal": goal,
        }

    @tool()
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
        editorial = decision.get("editorialDecision", decision if decision.get("authority") == "CHATGPT_DIRECT" else None)
        workflow = decision.get("workflowContext", parsed.get("workflowContext") if isinstance(parsed, dict) else None)
        transaction_id = idempotency_key or plan_id or f"shadow-fast-{int(time.time() * 1000)}"
        if isinstance(parsed, list):
            if not parsed:
                raise ValueError("operations_json routine-intent list must not be empty")
            result = _execute_queued("AE_BATCH", {"intents": parsed, "transactionId": transaction_id, "researchContext": research_context, "editorialDecision": editorial, "workflowContext": workflow})
            execution_path = "DURABLE_PRODUCTION_QUEUE_V1"
        else:
            goal = _normalize_goal(operations_json)
            result = _execute_queued("AE_GOAL", {"goal": goal, "transactionId": transaction_id, "researchContext": research_context, "editorialDecision": editorial, "workflowContext": workflow})
            execution_path = "DURABLE_PRODUCTION_QUEUE_V1"
        return {"baseRevision": base_revision, "planId": plan_id, "executionPath": execution_path, "result": result}

    @tool()
    def fast_ae_run(goal_json: str, transaction_id: str = "") -> dict[str, Any]:
        """Run an authorized AE goal as a durable production job using the shared warm CEP runtime."""
        packet = json.loads(goal_json)
        if not isinstance(packet, dict):
            raise ValueError("goal_json must decode to an object")
        goal = packet.get("goal", packet)
        tx = transaction_id or f"shadow-fast-{int(time.time() * 1000)}"
        return _execute_queued("AE_GOAL", {"goal": goal, "transactionId": tx, "researchContext": packet.get("researchContext"), "editorialDecision": packet.get("editorialDecision"), "workflowContext": packet.get("workflowContext")})

    @tool()
    def fast_ae_batch(intents_json: str, transaction_id: str = "") -> dict[str, Any]:
        """Queue up to 64 allow-listed AE actions on the sole production writer; no direct-execution fallback."""
        packet = json.loads(intents_json)
        intents = packet.get("intents") if isinstance(packet, dict) else packet
        if not isinstance(intents, list) or not intents:
            raise ValueError("intents_json must decode to a non-empty routine-intent list")
        tx = transaction_id or f"shadow-batch-{int(time.time() * 1000)}"
        return _execute_queued("AE_BATCH", {"intents": intents, "transactionId": tx, "researchContext": packet.get("researchContext") if isinstance(packet, dict) else None, "editorialDecision": packet.get("editorialDecision") if isinstance(packet, dict) else None, "workflowContext": packet.get("workflowContext") if isinstance(packet, dict) else None, **({"visualReview": packet["visualReview"]} if isinstance(packet, dict) and "visualReview" in packet else {})})

    @tool(read_only=True, destructive=False)
    def get_production_state(assignment_id: str, include_history: bool = False) -> dict[str, Any]:
        """Resume the retained workflow plan/reviews, checkpoints, stage and telemetry without changing AE or supervision."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/production?includeHistory=" + str(include_history).lower())

    @tool()
    def record_production_update(assignment_id: str, update_json: str) -> dict[str, Any]:
        """Record explicit ChatGPT VISUAL_REVIEW judgments/workflow plans/reviews/checkpoints/telemetry or GPT research/decision HEARTBEATs. Supply the current issued worker credential as claimedBy inside update_json. This cannot execute AE edits, claim/revoke workers, pause/resume production, or create assignments."""
        payload = _object_payload(update_json, "update_json")
        _require_worker(payload.get("claimedBy"))
        if payload.get("action") not in PRODUCTION_UPDATE_ACTIONS:
            raise ValueError("Only retained production coordinator actions are accepted; lifecycle and AE writes use their separate authorized tools")
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("POST", f"/v1/product/gpt/assignments/{safe_id}/production", payload)

    @tool()
    def enqueue_production_job(assignment_id: str, job_json: str) -> dict[str, Any]:
        """Submit exact work once. Routine edits wait for their durable completion and return readbacks/checkpoint; long jobs retain their ID. Prefer AE_BATCH for supported edits. LOCAL_RENDER accepts frameTimesMs or a bounded video interval, caches unchanged previews; forceRender requires forceRenderReason. payload.visualReview may retain inspected judgments with the next edit."""
        payload = _object_payload(job_json, "job_json")
        context = payload.get("payload", {}).get("researchContext") if isinstance(payload.get("payload"), dict) else None
        if not isinstance(context, dict) or context.get("assignmentId") != assignment_id:
            raise ValueError("Job researchContext must identify this retained assignment")
        _require_worker(context.get("claimedBy"))
        safe_id = urllib.parse.quote(assignment_id, safe="")
        endpoint = f"/v1/product/gpt/assignments/{safe_id}/production-jobs"
        accepted = _practice_http("POST", endpoint, payload)
        return _wait_queued(endpoint, accepted["job"]) if payload.get("kind") in ("AE_BATCH", "AE_TRANSACTION", "AE_CORRECTION") else accepted

    @tool(read_only=True, destructive=False)
    def get_production_jobs(assignment_id: str, job_id: str = "", include_history: bool = False) -> dict[str, Any]:
        """Read compact durable receipts by default. Use job_id for a complete decision/receipt, or include_history only for an actual audit. Never resubmit uncertain work."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        query = "?jobId=" + urllib.parse.quote(job_id, safe="") if job_id else "?includeHistory=" + str(include_history).lower()
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/production-jobs" + query)

    @tool()
    def resolve_production_job(assignment_id: str, job_id: str, claimed_by: str, review_evidence_ref: str, result_json: str = "{}") -> dict[str, Any]:
        """Reconcile held work after inspecting actual AE readback/render evidence; never blindly replay a write."""
        _require_worker(claimed_by)
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("POST", f"/v1/product/gpt/assignments/{safe_id}/production-jobs", {
            "action": "RESOLVE", "jobId": job_id, "claimedBy": claimed_by,
            "reviewEvidenceRef": review_evidence_ref, "result": json.loads(result_json)})

    @tool(read_only=True, destructive=False)
    def get_footage_selection(assignment_id: str) -> dict[str, Any]:
        """Read supplied raw media, reference shot boundaries and direct ChatGPT shot-selection contract; no ranked candidates."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/footage-selection")

    @tool()
    def start_source_match(request_json: str) -> dict[str, Any]:
        """Search a finished edit in local raw source files as one cached GPU job. Supply {requestId,referencePath,sourcePaths,budgetSeconds:480,shots?:[{start,end}]}. Seconds, end exclusive. Read-only media analysis; no assignment claim/resume/AE writes. Machine VERIFIED is evidence, not GPT acceptance."""
        payload = _object_payload(request_json, "request_json")
        payload["action"] = "SUBMIT"
        return _practice_http("POST", "/v1/product/source-match", payload)

    @tool(read_only=True, destructive=False)
    def get_source_match(job_id: str = "") -> dict[str, Any]:
        """Read source-match installation/contract, or durable job progress, report, exact decoded PTS, frame evidence and CSV. PARTIAL/unresolved shots have no asserted source timestamps. Review pixels before GPT SELECT."""
        query = "?jobId=" + urllib.parse.quote(job_id, safe="") if job_id else ""
        return _practice_http("GET", "/v1/product/source-match" + query)

    @tool()
    def cancel_source_match(job_id: str) -> dict[str, Any]:
        """Cancel only the named source-matching analysis job; preserves caches, partial evidence, AE and production pause state."""
        return _practice_http("POST", "/v1/product/source-match", {"action":"CANCEL", "jobId":job_id})

    @tool()
    def inspect_or_select_footage(assignment_id: str, request_json: str) -> dict[str, Any]:
        """BROWSE explicit GPT-chosen timestamps or SELECT ranges backed by direct pixel comparisons. Supply current claimedBy; no AE changes."""
        payload = json.loads(request_json)
        if not isinstance(payload, dict):
            raise ValueError("Footage request must be a JSON object with the current claimedBy.")
        if payload.get("action") not in ("BROWSE", "NOTE", "DEFINE_REFERENCE", "SELECT", "BROWSE_RENDER"):
            raise ValueError("Only direct ChatGPT BROWSE, NOTE, DEFINE_REFERENCE, SELECT and BROWSE_RENDER actions are available; automated matching/ranking is retired.")
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("POST", f"/v1/product/gpt/assignments/{safe_id}/footage-selection", payload)

    @tool(read_only=True, destructive=False)
    def get_practice_notebook(assignment_id: str, query: str = "") -> dict[str, Any]:
        """Read the selected preset's existing learning record and complete worked/failed examples; no automatic recipe selection."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/practice-notebook?q=" + urllib.parse.quote(query, safe=""))

    @tool()
    def record_practice_example(assignment_id: str, example_json: str) -> dict[str, Any]:
        """Retain {claimedBy,lesson,reviewEvidence} in the existing preset notebook. Save exact ordered steps, observed outcome, mistakes and issued evidence."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("POST", f"/v1/product/gpt/assignments/{safe_id}/practice-notebook", json.loads(example_json))

    @tool(read_only=True, destructive=False)
    def fast_ae_refresh() -> dict[str, Any]:
        """Refresh the current AE world model at a meaningful checkpoint."""
        return _http("GET", "/state")

    @tool(read_only=True, destructive=False)
    def get_clip_research_contract() -> dict[str, Any]:
        """Read mandatory per-clip scan/tutorial/Adobe/web research payloads before AE editing."""
        return _practice_http("GET", "/v1/product/gpt/clip-research-contract")

    @tool(read_only=True, destructive=False)
    def get_clip_research(assignment_id: str) -> dict[str, Any]:
        """Resume durable per-clip inspections, consulted methods, READY plans and execution audit."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}/clip-research")

    @tool()
    def record_clip_research(assignment_id: str, research_json: str) -> dict[str, Any]:
        """Optionally retain SCAN, SOURCE or PLAN evidence using the issued worker. These notes are supporting memory, not prerequisites for DIRECT_EDITING_V1 AE batches."""
        payload = json.loads(research_json)
        if not isinstance(payload, dict):
            raise ValueError("research_json must be an object matching get_clip_research_contract")
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("POST", f"/v1/product/gpt/assignments/{safe_id}/clip-research", payload)

    @tool(read_only=True, destructive=False)
    def get_next_gpt_assignment() -> dict[str, Any]:
        """Get the next Practice or Pro Creation assignment created for ChatGPT by the AE panel."""
        return _practice_http("GET", "/v1/product/gpt/assignments/next")

    @tool(read_only=True, destructive=False)
    def get_gpt_assignment(assignment_id: str, include_history: bool = False) -> dict[str, Any]:
        """Read current assignment, visual continuity and cancellation state; request include_history only for an audit."""
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http("GET", f"/v1/product/gpt/assignments/{safe_id}?includeHistory=" + str(include_history).lower())

    @tool()
    def claim_gpt_assignment(
        assignment_id: str,
        claimed_by: str = "",
    ) -> dict[str, Any]:
        """Resume once using this chat's issued worker: return retained assignment, AE state, queue, checkpoint, selections and notebook. No separate preflight or research-plan approval is needed."""
        _require_worker(claimed_by)
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http(
            "POST",
            f"/v1/product/gpt/assignments/{safe_id}/claim",
            {"claimedBy": claimed_by},
        )

    @tool(destructive=False)
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
        claimed_by: str = "",
    ) -> dict[str, Any]:
        """Record one observation-to-lesson event under the assignment's selected Edit Type using its current worker credential."""
        _require_worker(claimed_by)
        evidence_refs = json.loads(evidence_refs_json)
        if not isinstance(evidence_refs, list) or any(not isinstance(item, str) for item in evidence_refs):
            raise ValueError("evidence_refs_json must decode to a string array")
        payload: dict[str, Any] = {
            "claimedBy": claimed_by,
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

    @tool()
    def complete_gpt_assignment(
        assignment_id: str,
        success: bool,
        final_summary: str,
        final_render_ref: str = "",
        final_review_json: str = "",
        claimed_by: str = "",
    ) -> dict[str, Any]:
        """Complete only after direct ChatGPT review of a retained whole-edit render and saved preset worked/failed examples. Supply final_review_json and current claimed_by."""
        _require_worker(claimed_by)
        payload: dict[str, Any] = {
            "success": bool(success),
            "finalSummary": final_summary,
            "finalReview": json.loads(final_review_json) if final_review_json else None,
            "claimedBy": claimed_by,
        }
        if final_render_ref:
            payload["finalRenderRef"] = final_render_ref
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http(
            "POST",
            f"/v1/product/gpt/assignments/{safe_id}/complete",
            payload,
        )

    @tool()
    def fail_gpt_assignment(assignment_id: str, error: str, claimed_by: str = "") -> dict[str, Any]:
        """Record an actionable assignment failure using its current issued worker credential; do not use for missing tools or host approval rejection."""
        _require_worker(claimed_by)
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http(
            "POST",
            f"/v1/product/gpt/assignments/{safe_id}/fail",
            {"error": error, "claimedBy": claimed_by},
        )

    @tool()
    def acknowledge_gpt_assignment_cancelled(
        assignment_id: str,
        summary: str = "GPT stopped safely at an EditFlow checkpoint.",
        claimed_by: str = "",
    ) -> dict[str, Any]:
        """Acknowledge that GPT stopped AE work after observing a cancellation request using this chat's issued worker credential."""
        _require_worker(claimed_by)
        safe_id = urllib.parse.quote(assignment_id, safe="")
        return _practice_http(
            "POST",
            f"/v1/product/gpt/assignments/{safe_id}/cancelled",
            {"summary": summary, "claimedBy": claimed_by},
        )

    @tool(read_only=True, destructive=False)
    def get_editflow_run(session_id: str) -> dict[str, Any]:
        """Read current Practice or Pro Creation progress for cancellation and UI synchronization."""
        safe_id = urllib.parse.quote(session_id, safe="")
        return _practice_http("GET", f"/v1/product/runs/{safe_id}")

    @tool()
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
        # Production state and worker authority live in the durable backend, not HTTP sessions.
        stateless_http=True,
        transport_security=transport_security,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
