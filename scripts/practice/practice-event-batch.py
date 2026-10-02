from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib import request
from urllib.parse import quote


def _config_path() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("LOCALAPPDATA is not available.")
    return Path(local_app_data) / "EditFlow2" / "bridge-config.json"


def main() -> int:
    parser = argparse.ArgumentParser(description="Submit validated Practice trace events in one request.")
    parser.add_argument("--assignment-id", required=True)
    parser.add_argument("--events-json", required=True, type=Path)
    args = parser.parse_args()

    config = json.loads(_config_path().read_text(encoding="utf-8"))
    events = json.loads(args.events_json.read_text(encoding="utf-8"))
    if not isinstance(events, list) or not events or len(events) > 64:
        raise ValueError("events-json must contain 1-64 event objects.")

    url = (
        "http://127.0.0.1:"
        + str(int(config["productPort"]))
        + "/v1/product/gpt/assignments/"
        + quote(args.assignment_id, safe="")
        + "/events/batch"
    )
    body = json.dumps({"events": events}).encode("utf-8")
    req = request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-EditFlow-Token": str(config["token"]),
        },
    )
    with request.urlopen(req, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))
    print(json.dumps({
        "eventCount": result.get("eventCount"),
        "assignmentStatus": (result.get("assignment") or {}).get("status"),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
