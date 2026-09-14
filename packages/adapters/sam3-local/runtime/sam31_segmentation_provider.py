from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

SCHEMA = "editflow.segmentation.sam3.1.v1"
PROVIDER_ID = "sam3.1.local"
PROVIDER_VERSION = "sam3-0.1.0"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def emit(value: dict[str, Any]) -> int:
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=False))
    return 0


def refuse(code: str, detail: str) -> int:
    return emit({"status": "REFUSED", "code": code, "detail": detail})


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def normalized_box(value: Any) -> bool:
    if not isinstance(value, list) or len(value) != 4:
        return False
    try:
        x, y, w, h = [float(item) for item in value]
    except (TypeError, ValueError):
        return False
    return x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= 1 and y + h <= 1


def validate_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], Path, Path | None, float]:
    if payload.get("schema") != SCHEMA:
        raise ValueError("unsupported sidecar schema")
    request = payload.get("request")
    source = payload.get("source")
    if not isinstance(request, dict) or not isinstance(source, dict):
        raise ValueError("request and source are required")
    for key in ("requestId", "sourceId", "semanticId"):
        if not nonempty(request.get(key)):
            raise ValueError(f"request.{key} is required")
    if source.get("sourceId") != request.get("sourceId"):
        raise ValueError("resolved source identity mismatch")
    source_path = Path(str(source.get("absolutePath", "")))
    if not source_path.is_absolute() or not source_path.is_file():
        raise ValueError("resolved source path is not an existing absolute file")
    artifact_dir = Path(str(payload.get("artifactDirectory", "")))
    if not artifact_dir.is_absolute():
        raise ValueError("artifactDirectory must be absolute")
    checkpoint_raw = payload.get("checkpointPath")
    checkpoint = None if checkpoint_raw in (None, "") else Path(str(checkpoint_raw))
    if checkpoint is not None and (not checkpoint.is_absolute() or not checkpoint.is_file()):
        raise ValueError("checkpointPath must identify an existing absolute file")
    threshold = float(payload.get("confidenceThreshold", 0.5))
    if not 0 < threshold < 1:
        raise ValueError("confidenceThreshold must be between 0 and 1")
    prompt = request.get("prompt") or {}
    if not isinstance(prompt, dict):
        raise ValueError("request.prompt must be an object")
    if prompt.get("boundingBox") is not None and not normalized_box(prompt.get("boundingBox")):
        raise ValueError("request.prompt.boundingBox is invalid")
    if prompt.get("positivePoints") or prompt.get("negativePoints"):
        raise ValueError("point prompts are not supported by this registered provider tranche")
    if not nonempty(request.get("entityClass")) and prompt.get("boundingBox") is None:
        raise ValueError("entityClass text or boundingBox prompt is required")
    return request, source, artifact_dir, checkpoint, threshold


def load_source_frame(source_path: Path, timestamp_ms: float):
    from PIL import Image
    if source_path.suffix.lower() in IMAGE_EXTENSIONS:
        return Image.open(source_path).convert("RGB"), "IMAGE"
    import cv2
    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError("video source could not be opened")
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, float(timestamp_ms)))
        ok, frame = capture.read()
    finally:
        capture.release()
    if not ok or frame is None:
        raise RuntimeError("requested video frame could not be decoded")
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb), "VIDEO_FRAME"


def require_checkpoint_access(checkpoint: Path | None) -> None:
    if checkpoint is not None:
        return
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not token:
        try:
            from huggingface_hub import get_token
            token = get_token()
        except Exception:
            token = None
    if not token:
        raise PermissionError("SAM 3 checkpoint access is not authenticated; configure approved Hugging Face access or provide checkpointPath")


def select_single_mask(state: dict[str, Any]):
    masks = state.get("masks")
    logits = state.get("masks_logits")
    scores = state.get("scores")
    if masks is None or logits is None or scores is None or len(scores) == 0:
        raise LookupError("SAM 3 returned no subject mask")
    if len(scores) != 1:
        raise LookupError(f"SAM 3 returned {len(scores)} candidate masks; exact subject binding is ambiguous")
    return masks[0, 0], logits[0, 0], scores[0]

def edge_alignment_quality(image, binary_mask) -> float:
    import cv2
    import numpy as np
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    gradient = np.sqrt(gx * gx + gy * gy)
    scale = float(np.percentile(gradient, 95))
    if scale <= 1e-8:
        return 0.0
    mask_u8 = binary_mask.astype(np.uint8) * 255
    boundary = cv2.morphologyEx(mask_u8, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
    if not boundary.any():
        return 0.0
    return float(np.clip(np.mean(np.clip(gradient[boundary] / scale, 0.0, 1.0)), 0.0, 1.0))


def temporal_iou(binary_mask, previous_path: Path | None) -> float:
    if previous_path is None:
        return 0.0
    import cv2
    import numpy as np
    previous = cv2.imread(str(previous_path), cv2.IMREAD_GRAYSCALE)
    if previous is None or previous.shape != binary_mask.shape:
        raise RuntimeError("previous segmentation artifact dimensions do not match the current full-frame mask")
    prior = previous > 127
    intersection = np.logical_and(binary_mask, prior).sum()
    union = np.logical_or(binary_mask, prior).sum()
    return 1.0 if union == 0 else float(intersection / union)
def previous_artifact_path(request: dict[str, Any], source: dict[str, Any]) -> Path | None:
    prompt = request.get("prompt") or {}
    previous_id = prompt.get("previousArtifactId")
    if previous_id is None:
        return None
    previous = source.get("previousArtifact")
    if not isinstance(previous, dict) or previous.get("artifactId") != previous_id:
        raise RuntimeError("previous segmentation artifact identity was not resolved exactly")
    path = Path(str(previous.get("absolutePath", "")))
    if not path.is_absolute() or not path.is_file():
        raise RuntimeError("previous segmentation artifact path is unavailable")
    evidence = previous.get("evidenceIds")
    if not isinstance(evidence, list) or not any(nonempty(item) for item in evidence):
        raise RuntimeError("previous segmentation artifact provenance is missing")
    return path


def save_mask_artifact(probability, binary, encoding: str, artifact_dir: Path, request_id: str) -> tuple[Path, str]:
    from PIL import Image
    import numpy as np
    artifact_dir.mkdir(parents=True, exist_ok=True)
    safe_request = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in request_id)[:96]
    output = artifact_dir / f"sam31_{safe_request}.png"
    if encoding == "BINARY":
        array = binary.astype(np.uint8) * 255
    elif encoding == "PROBABILITY":
        array = np.clip(probability * 65535.0, 0, 65535).astype(np.uint16)
    else:
        array = np.clip(probability * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(array).save(output, format="PNG")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    return output, digest
def run_segmentation(payload: dict[str, Any]) -> dict[str, Any]:
    request, source, artifact_dir, checkpoint, threshold = validate_payload(payload)
    require_checkpoint_access(checkpoint)
    import numpy as np
    import torch
    from sam3.model_builder import build_sam3_image_model
    from sam3.model.sam3_image_processor import Sam3Processor

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for the registered SAM 3.1 local provider")
    image, source_kind = load_source_frame(Path(source["absolutePath"]), float(request.get("timestampMs", 0)))
    model = build_sam3_image_model(
        checkpoint_path=str(checkpoint) if checkpoint is not None else None,
        load_from_HF=checkpoint is None,
        device="cuda",
        eval_mode=True,
    )
    processor = Sam3Processor(model, device="cuda", confidence_threshold=threshold)
    state = processor.set_image(image)
    if nonempty(request.get("entityClass")):
        state = processor.set_text_prompt(str(request["entityClass"]), state)
    box = (request.get("prompt") or {}).get("boundingBox")
    if box is not None:
        x, y, width, height = [float(item) for item in box]
        state = processor.add_geometric_prompt([x + width / 2, y + height / 2, width, height], True, state)
    binary_t, probability_t, score_t = select_single_mask(state)
    probability = probability_t.detach().float().cpu().numpy()
    binary = binary_t.detach().cpu().numpy().astype(bool)
    score = float(score_t.detach().float().cpu().item())
    encoding = str(request.get("preferredEncoding") or "ALPHA")
    output_path, digest = save_mask_artifact(probability, binary, encoding, artifact_dir, str(request["requestId"]))
    previous_path = previous_artifact_path(request, source)
    temporal = temporal_iou(binary, previous_path)
    edge_quality = edge_alignment_quality(image, binary)
    occlusion = float(max(0.0, min(1.0, 1.0 - score)))
    source_evidence = [item for item in source.get("evidenceIds", []) if nonempty(item)]
    previous_evidence = []
    if isinstance(source.get("previousArtifact"), dict):
        previous_evidence = [item for item in source["previousArtifact"].get("evidenceIds", []) if nonempty(item)]
    evidence_ids = list(dict.fromkeys(source_evidence + previous_evidence + [
        "SAM31_MODEL:facebook/sam3",
        f"SAM31_SOURCE_KIND:{source_kind}",
        "SAM31_EDGE_QUALITY:IMAGE_GRADIENT_ALIGNMENT",
        "SAM31_OCCLUSION:PRESENCE_SCORE_PROXY",
        "SAM31_TEMPORAL:MASK_IOU" if previous_path is not None else "SAM31_TEMPORAL:NO_PRIOR_ARTIFACT",
    ]))
    width, height = image.size
    result: dict[str, Any] = {
        "requestId": request["requestId"],
        "sourceId": request["sourceId"],
        "timestampMs": request.get("timestampMs", 0),
        "semanticId": request["semanticId"],
        "providerId": PROVIDER_ID,
        "providerVersion": PROVIDER_VERSION,
        "mask": {
            "encoding": encoding,
            "width": int(width),
            "height": int(height),
            "boundsNormalized": [0, 0, 1, 1],
            "artifact": {
                "artifactId": f"sam31:{request['requestId']}:{digest[:24]}",
                "contentType": "image/png",
                "sha256": digest,
            },
        },
        "confidence": float(max(0.0, min(1.0, score))),
        "edgeQuality": edge_quality,
        "temporalConsistency": temporal,
        "occlusion": occlusion,
        "evidenceIds": evidence_ids,
    }
    if nonempty(request.get("entityClass")):
        result["entityClass"] = request["entityClass"]
    return {"status": "COMPLETED", "artifactPath": str(output_path), "result": result}
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EditFlow local SAM 3.1 segmentation provider")
    parser.add_argument("--request-json", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        payload = json.loads(args.request_json)
        if not isinstance(payload, dict):
            return refuse("INVALID_PAYLOAD", "sidecar request must be a JSON object")
        return emit(run_segmentation(payload))
    except PermissionError as error:
        return refuse("CHECKPOINT_ACCESS_REQUIRED", str(error))
    except (ValueError, LookupError) as error:
        return refuse("SEGMENTATION_REQUEST_REFUSED", str(error))
    except Exception as error:
        text = str(error)
        lower = text.lower()
        if "gated" in lower or "401" in lower or "403" in lower or "hugging face" in lower:
            return refuse("CHECKPOINT_ACCESS_REQUIRED", text)
        return refuse("SEGMENTATION_RUNTIME_FAILED", text)


if __name__ == "__main__":
    raise SystemExit(main())
