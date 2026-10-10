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








def build_server():
    try:
        from mcp.server.mcpserver import MCPServer
        from mcp.server.mcpserver.exceptions import ToolError
    except ImportError as exc:
        raise RuntimeError("MCP SDK v2 is required for the current Shadow gateway") from exc

    mcp = MCPServer(
        "EditFlow Current Shadow Gateway",
        instructions="UI_ONLY_V1: Practice and Pro Creation save empty sessions. No editing workflow, Source Match, learning, job queue or Supervisor exists. Preserve file selection and Edit Type UI. Wait for the user to define a new process.",
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
        """Read live AE state and the empty UI session together."""
        state = _http("GET", "/state")
        state["practiceResume"] = _practice_http("GET", "/v1/product/practice/resume-or-start")
        return state

    @tool()
    def resume_or_start_practice(start_json: str = "") -> dict[str, Any]:
        """Read the empty session, or save/cancel one on explicit user instruction.
        START_PRACTICE and START_PRO_CREATION use input, userRequested:true and
        requestId. CANCEL uses expectedAssignmentId. No editing work starts.
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





    @tool(read_only=True, destructive=False)
    def get_mcp_surface(assignment_id: str = "", available_tools_json: str = "") -> dict[str, Any]:
        """Describe the UI-only connector. No production tools are available."""
        return {"service": "EditFlow Current Shadow Gateway", "executionMode": "UI_ONLY_V1",
                "availableWorkflows": [], "workflowConfigured": False, "tools": registered}

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
