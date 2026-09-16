from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

CONTROL = "http://127.0.0.1:32146"


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
    def get_mcp_surface() -> dict[str, Any]:
        """Describe the stable Shadow compatibility surface backed by the current repo."""
        return {
            "service": "EditFlow Current Shadow Gateway",
            "legacyCompatibility": True,
            "primaryExecution": "EDITOR_BRAIN_CONTINUOUS_FAST_LOOP_V0",
            "tools": [
                "get_edit_state", "get_editflow2_state", "get_after_effects_state",
                "probe_after_effects", "get_production_status", "validate_edit_plan",
                "apply_edit_plan", "fast_ae_run", "fast_ae_refresh",
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
        goal = _normalize_goal(operations_json)
        transaction_id = idempotency_key or plan_id or f"shadow-fast-{int(time.time() * 1000)}"
        result = _http("POST", "/run", {"goal": goal, "transactionId": transaction_id})
        return {"baseRevision": base_revision, "planId": plan_id, "result": result}

    @mcp.tool()
    def fast_ae_run(goal_json: str, transaction_id: str = "") -> dict[str, Any]:
        """Run one current-repo fast-loop goal while preserving the warm CEP lease/state."""
        goal = json.loads(goal_json)
        if not isinstance(goal, dict):
            raise ValueError("goal_json must decode to an object")
        tx = transaction_id or f"shadow-fast-{int(time.time() * 1000)}"
        return _http("POST", "/run", {"goal": goal, "transactionId": tx})

    @mcp.tool()
    def fast_ae_refresh() -> dict[str, Any]:
        """Refresh the current AE world model at a meaningful checkpoint."""
        return _http("GET", "/state")

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
