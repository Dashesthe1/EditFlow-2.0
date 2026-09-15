import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

REPO_ID = "facebook/sam3.1"
CONFIG_FILENAME = "config.json"
CHECKPOINT_FILENAME = "sam3.1_multiplex.pt"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def current_token() -> str | None:
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        return token
    from huggingface_hub import get_token
    return get_token()

def materialize(destination: Path, token: str | None = None, download_fn=None) -> dict:
    if token is None:
        token = current_token()
    if not token:
        raise PermissionError("CHECKPOINT_ACCESS_REQUIRED")
    destination.mkdir(parents=True, exist_ok=True)
    if download_fn is None:
        from huggingface_hub import hf_hub_download
        download_fn = hf_hub_download
    config_path = Path(download_fn(repo_id=REPO_ID, filename=CONFIG_FILENAME, token=token, local_dir=str(destination)))
    checkpoint_path = Path(download_fn(repo_id=REPO_ID, filename=CHECKPOINT_FILENAME, token=token, local_dir=str(destination)))
    for label, path in (("config", config_path), ("checkpoint", checkpoint_path)):
        if not path.is_file() or path.stat().st_size <= 0:
            raise RuntimeError(f"{label.upper()}_MATERIALIZATION_INVALID")
    return {
        "repoId": REPO_ID,
        "configPath": str(config_path.resolve()),
        "configSha256": sha256_file(config_path),
        "checkpointPath": str(checkpoint_path.resolve()),
        "checkpointSha256": sha256_file(checkpoint_path),
        "checkpointBytes": checkpoint_path.stat().st_size,
    }

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination-directory", required=True)
    args = parser.parse_args()
    try:
        result = materialize(Path(args.destination_directory))
        print(json.dumps({"status": "COMPLETED", **result}, separators=(",", ":")))
        return 0
    except PermissionError:
        print(json.dumps({
            "status": "REFUSED",
            "code": "CHECKPOINT_ACCESS_REQUIRED",
            "detail": "Authorized Hugging Face access to facebook/sam3.1 is required before checkpoint materialization.",
        }, separators=(",", ":")))
        return 2
    except Exception as error:
        print(json.dumps({
            "status": "REFUSED",
            "code": "CHECKPOINT_MATERIALIZATION_FAILED",
            "detail": str(error),
        }, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    sys.exit(main())
