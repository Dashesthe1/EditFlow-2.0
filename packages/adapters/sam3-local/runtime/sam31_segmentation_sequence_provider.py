from __future__ import annotations

import argparse
import contextlib
import hashlib
import inspect
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

SCHEMA = "editflow.segmentation.sam3.1.sequence.v1"
PROVIDER_ID = "sam3.1.local"
PROVIDER_VERSION_FAMILY = "sam3.1"
MODEL_EVIDENCE = "SAM31_MODEL:facebook/sam3.1"


def emit(value: dict[str, Any]) -> int:
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=False))
    return 0


def refuse(code: str, detail: str) -> int:
    return emit({"status": "REFUSED", "code": code, "detail": detail})


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def clamp01(value: float) -> float:
    return float(max(0.0, min(1.0, value)))


def normalized_point(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    try:
        x = float(value.get("x"))
        y = float(value.get("y"))
    except (TypeError, ValueError):
        return False
    return 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0


def normalized_box(value: Any) -> bool:
    if not isinstance(value, list) or len(value) != 4:
        return False
    try:
        x, y, width, height = [float(item) for item in value]
    except (TypeError, ValueError):
        return False
    return (
        0.0 <= x <= 1.0
        and 0.0 <= y <= 1.0
        and width > 0.0
        and height > 0.0
        and x + width <= 1.0
        and y + height <= 1.0
    )


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
    if not source_path.is_absolute() or not source_path.exists():
        raise ValueError("resolved source path is not an existing absolute resource")
    artifact_dir = Path(str(payload.get("artifactDirectory", "")))
    if not artifact_dir.is_absolute():
        raise ValueError("artifactDirectory must be absolute")
    checkpoint_raw = payload.get("checkpointPath")
    checkpoint = None if checkpoint_raw in (None, "") else Path(str(checkpoint_raw))
    if checkpoint is not None and (not checkpoint.is_absolute() or not checkpoint.is_file()):
        raise ValueError("checkpointPath must identify an existing absolute file")
    threshold = float(payload.get("confidenceThreshold", 0.5))
    if not 0.0 < threshold < 1.0:
        raise ValueError("confidenceThreshold must be between 0 and 1")

    frame_rate = float(request.get("frameRate", 0))
    frame_count = int(request.get("frameCount", 0))
    start_frame = int(request.get("startFrameIndex", -1))
    prompt_frame = int(request.get("promptFrameIndex", -1))
    start_timestamp = float(request.get("startTimestampMs", -1))
    if not 0.0 < frame_rate <= 240.0 or frame_count <= 0 or frame_count > 100000:
        raise ValueError("frameRate/frameCount are outside the registered temporal provider contract")
    if start_frame < 0 or prompt_frame < 0 or prompt_frame >= frame_count or start_timestamp < 0:
        raise ValueError("start/prompt frame coordinates are invalid")
    expected_start = start_frame * 1000.0 / frame_rate
    if abs(start_timestamp - expected_start) > 1e-6:
        raise ValueError("startTimestampMs does not exactly correlate to startFrameIndex/frameRate")

    prompt = request.get("prompt") or {}
    if not isinstance(prompt, dict):
        raise ValueError("request.prompt must be an object")
    if prompt.get("previousArtifactId") is not None:
        raise ValueError("previousArtifactId temporal refinement is not supported by this provider tranche")
    if prompt.get("boundingBox") is not None and not normalized_box(prompt.get("boundingBox")):
        raise ValueError("request.prompt.boundingBox is invalid")
    for key in ("positivePoints", "negativePoints"):
        points = prompt.get(key) or []
        if not isinstance(points, list) or not all(normalized_point(point) for point in points):
            raise ValueError(f"request.prompt.{key} is invalid")
    if not nonempty(request.get("entityClass")) and prompt.get("boundingBox") is None and not (prompt.get("positivePoints") or []):
        raise ValueError("text, normalized box, or at least one positive point is required")
    encoding = str(request.get("preferredEncoding") or "ALPHA")
    if encoding not in {"BINARY", "ALPHA"}:
        raise ValueError("SAM 3.1 video output cannot truthfully satisfy PROBABILITY encoding in this provider tranche")
    return request, source, artifact_dir, checkpoint, threshold


def _numpy(value: Any):
    import numpy as np

    if value is None:
        return None
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "float"):
        try:
            value = value.float()
        except Exception:
            pass
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    return np.asarray(value)


def object_ids(outputs: dict[str, Any]) -> list[Any]:
    values = _numpy(outputs.get("out_obj_ids"))
    if values is None:
        return []
    return [item.item() if hasattr(item, "item") else item for item in values.reshape(-1)]


def mask_for_index(outputs: dict[str, Any], index: int):
    import numpy as np

    masks = _numpy(outputs.get("out_binary_masks"))
    if masks is None or masks.shape[0] <= index:
        raise LookupError("SAM 3.1 output did not contain an indexed binary mask")
    mask = np.asarray(masks[index]).squeeze()
    if mask.ndim != 2:
        raise LookupError("SAM 3.1 binary mask geometry was not two-dimensional")
    return mask.astype(bool)


def score_for_index(outputs: dict[str, Any], index: int, fallback: float) -> float:
    probs = _numpy(outputs.get("out_probs"))
    if probs is None or probs.size <= index:
        return clamp01(fallback)
    return clamp01(float(probs.reshape(-1)[index]))


def boxes_xywh(outputs: dict[str, Any]) -> list[list[float]]:
    values = _numpy(outputs.get("out_boxes_xywh"))
    if values is None:
        return []
    values = values.reshape((-1, 4))
    return [[float(item) for item in row] for row in values]


def iou_xywh(left: list[float], right: list[float]) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    left_x2, left_y2 = lx + lw, ly + lh
    right_x2, right_y2 = rx + rw, ry + rh
    inter_w = max(0.0, min(left_x2, right_x2) - max(lx, rx))
    inter_h = max(0.0, min(left_y2, right_y2) - max(ly, ry))
    inter = inter_w * inter_h
    union = lw * lh + rw * rh - inter
    return 0.0 if union <= 0.0 else inter / union


def choose_target(outputs: dict[str, Any], prompt: dict[str, Any]) -> Any:
    ids = object_ids(outputs)
    if not ids:
        raise LookupError("SAM 3.1 returned no subject object")
    if len(ids) == 1:
        return ids[0]

    box = prompt.get("boundingBox")
    predicted_boxes = boxes_xywh(outputs)
    if box is not None and len(predicted_boxes) == len(ids):
        scored = sorted(
            [(iou_xywh(predicted_boxes[index], [float(item) for item in box]), index) for index in range(len(ids))],
            reverse=True,
        )
        if scored[0][0] > 0.0 and (len(scored) == 1 or scored[0][0] - scored[1][0] > 1e-9):
            return ids[scored[0][1]]

    positives = prompt.get("positivePoints") or []
    negatives = prompt.get("negativePoints") or []
    if positives:
        candidates: list[tuple[int, int]] = []
        for index in range(len(ids)):
            mask = mask_for_index(outputs, index)
            height, width = mask.shape
            score = 0
            for point in positives:
                x = min(width - 1, max(0, int(round(float(point["x"]) * (width - 1)))))
                y = min(height - 1, max(0, int(round(float(point["y"]) * (height - 1)))))
                score += 1 if bool(mask[y, x]) else 0
            for point in negatives:
                x = min(width - 1, max(0, int(round(float(point["x"]) * (width - 1)))))
                y = min(height - 1, max(0, int(round(float(point["y"]) * (height - 1)))))
                score -= 1 if bool(mask[y, x]) else 0
            candidates.append((score, index))
        candidates.sort(reverse=True)
        if candidates[0][0] > 0 and (len(candidates) == 1 or candidates[0][0] != candidates[1][0]):
            return ids[candidates[0][1]]

    raise LookupError(f"SAM 3.1 returned {len(ids)} candidate objects; exact subject binding is ambiguous")


def target_mask(outputs: dict[str, Any], target_id: Any, dimensions: tuple[int, int] | None):
    import numpy as np

    ids = object_ids(outputs)
    for index, obj_id in enumerate(ids):
        if obj_id == target_id:
            mask = mask_for_index(outputs, index)
            present = bool(mask.any())
            return mask, score_for_index(outputs, index, 0.5) if present else 0.0, not present
    if dimensions is None:
        raise LookupError("target object disappeared before mask dimensions were established")
    height, width = dimensions
    return np.zeros((height, width), dtype=bool), 0.0, True


def temporal_iou(current, previous) -> float:
    import numpy as np

    if previous is None:
        return 1.0
    union = np.logical_or(current, previous).sum()
    if union == 0:
        return 1.0
    return clamp01(float(np.logical_and(current, previous).sum()) / float(union))


def save_png(mask, encoding: str, output: Path) -> str:
    from PIL import Image
    import numpy as np

    output.parent.mkdir(parents=True, exist_ok=True)
    array = mask.astype(np.uint8) * 255
    Image.fromarray(array, mode="L").save(output, format="PNG")
    return hashlib.sha256(output.read_bytes()).hexdigest()


def materialize_frame_window(source_path: Path, start_frame: int, frame_count: int, output_dir: Path) -> None:
    import cv2

    output_dir.mkdir(parents=True, exist_ok=True)
    image_exts = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
    if source_path.is_dir():
        frames = [item for item in source_path.iterdir() if item.is_file() and item.suffix.lower() in image_exts]
        try:
            frames.sort(key=lambda item: int(item.stem))
        except ValueError:
            frames.sort(key=lambda item: item.name)
        selected = frames[start_frame : start_frame + frame_count]
        if len(selected) != frame_count:
            raise LookupError("resolved frame directory does not cover the requested SAM 3.1 window")
        for local_index, frame_path in enumerate(selected):
            shutil.copy2(frame_path, output_dir / f"{local_index}{frame_path.suffix.lower()}")
        return

    if source_path.suffix.lower() in image_exts:
        if start_frame != 0 or frame_count != 1:
            raise LookupError("single-image source cannot satisfy the requested temporal SAM 3.1 window")
        shutil.copy2(source_path, output_dir / f"0{source_path.suffix.lower()}")
        return

    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"unable to open source video for bounded SAM 3.1 extraction: {source_path}")
    try:
        capture.set(cv2.CAP_PROP_POS_FRAMES, float(start_frame))
        reported = int(round(float(capture.get(cv2.CAP_PROP_POS_FRAMES))))
        if reported != start_frame:
            capture.release()
            capture = cv2.VideoCapture(str(source_path))
            if not capture.isOpened():
                raise RuntimeError(f"unable to reopen source video for exact SAM 3.1 extraction: {source_path}")
            for _ in range(start_frame):
                ok, _frame = capture.read()
                if not ok:
                    raise LookupError("source video ended before the requested SAM 3.1 start frame")
        for local_index in range(frame_count):
            ok, frame = capture.read()
            if not ok:
                raise LookupError("source video ended inside the requested SAM 3.1 frame window")
            output_path = output_dir / f"{local_index}.png"
            if not cv2.imwrite(str(output_path), frame):
                raise RuntimeError(f"failed to materialize bounded SAM 3.1 frame: {output_path}")
    finally:
        capture.release()

def run_sequence(payload: dict[str, Any]) -> dict[str, Any]:
    request, source, artifact_dir, checkpoint, threshold = validate_payload(payload)
    if checkpoint is None:
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        if not token:
            try:
                from huggingface_hub import get_token

                token = get_token()
            except Exception:
                token = None
        if not token:
            raise PermissionError(
                "SAM 3.1 checkpoint access is not authenticated; accept the facebook/sam3.1 terms "
                "and configure approved Hugging Face access or provide checkpointPath"
            )

    import sam3
    import torch
    from sam3.model_builder import build_sam3_multiplex_video_predictor

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for the registered SAM 3.1 temporal provider")
    if not torch.cuda.is_bf16_supported():
        raise RuntimeError("CUDA BF16 support is required for the registered SAM 3.1 temporal provider")

    build_kwargs: dict[str, Any] = {"use_fa3": False}
    checkpoint_source = "HF:facebook/sam3.1"
    if checkpoint is not None:
        build_kwargs["checkpoint_path"] = str(checkpoint)
        checkpoint_source = "LOCAL_EXPLICIT"

    with contextlib.redirect_stdout(sys.stderr):
        predictor = build_sam3_multiplex_video_predictor(**build_kwargs)

    import sam3.model.decoder as sam31_decoder
    from torch.nn.attention import SDPBackend, sdpa_kernel as torch_sdpa_kernel
    native_sdpa_kernel = sam31_decoder.sdpa_kernel

    def compatible_sdpa_kernel(_requested_backend: Any):
        return torch_sdpa_kernel([
            SDPBackend.FLASH_ATTENTION,
            SDPBackend.EFFICIENT_ATTENTION,
            SDPBackend.MATH,
        ])

    sam31_decoder.sdpa_kernel = compatible_sdpa_kernel

    detector = predictor.model.detector
    native_grounding_methods: dict[str, Any] = {}
    for grounding_method_name in (
        "forward_video_grounding_batched_multigpu",
        "forward_video_grounding_multigpu",
    ):
        if not hasattr(detector, grounding_method_name):
            continue
        native_grounding = getattr(detector, grounding_method_name)
        native_grounding_methods[grounding_method_name] = native_grounding

        def compatible_grounding(*args: Any, _native_grounding=native_grounding, **kwargs: Any):
            max_frames = kwargs.get("max_frame_num_to_track")
            if max_frames is not None:
                # Upstream treats the end frame as inclusive when deriving the tracking
                # window, then reuses it as an exclusive chunk end. Extend the detector
                # bound by one frame while leaving propagation itself unchanged.
                kwargs["max_frame_num_to_track"] = int(max_frames) + 1
            return _native_grounding(*args, **kwargs)

        setattr(detector, grounding_method_name, compatible_grounding)
    native_init_state = predictor.model.init_state
    native_init_parameters = inspect.signature(native_init_state).parameters
    start_session_compat = "offload_state_to_cpu" not in native_init_parameters
    if start_session_compat:
        def compatible_init_state(*args: Any, **kwargs: Any):
            kwargs.pop("offload_state_to_cpu", None)
            return native_init_state(*args, **kwargs)
        predictor.model.init_state = compatible_init_state

    start_frame = int(request["startFrameIndex"])
    frame_count = int(request["frameCount"])
    prompt_local = int(request["promptFrameIndex"])
    prompt_absolute = start_frame + prompt_local
    end_frame = start_frame + frame_count - 1
    window_manager = tempfile.TemporaryDirectory(prefix="editflow-sam31-window-")
    window_dir = Path(window_manager.name)

    session_id: str | None = None
    try:
        materialize_frame_window(Path(str(source["absolutePath"])), start_frame, frame_count, window_dir)
        with contextlib.redirect_stdout(sys.stderr):
            started = predictor.handle_request({
                "type": "start_session",
                "resource_path": str(window_dir),
                "offload_video_to_cpu": True,
                "offload_state_to_cpu": False,
            })
        session_id = str(started.get("session_id", ""))
        if not session_id:
            raise RuntimeError("SAM 3.1 did not return a video session id")

        prompt = request.get("prompt") or {}
        points = list(prompt.get("positivePoints") or []) + list(prompt.get("negativePoints") or [])
        semantic_available = nonempty(request.get("entityClass")) or prompt.get("boundingBox") is not None
        if not semantic_available:
            raise LookupError("SAM 3.1 multiplex temporal propagation requires entityClass or boundingBox; point-only prompts are not a validated temporal seed path")
        add_request: dict[str, Any] = {"type": "add_prompt", "session_id": session_id, "frame_index": prompt_local, "output_prob_thresh": threshold, "rel_coordinates": True}
        if nonempty(request.get("entityClass")):
            add_request["text"] = str(request["entityClass"])
        if prompt.get("boundingBox") is not None:
            add_request["bounding_boxes"] = [[float(item) for item in prompt["boundingBox"]]]
            add_request["bounding_box_labels"] = [1]
        with contextlib.redirect_stdout(sys.stderr):
            prompted = predictor.handle_request(add_request)
        prompt_outputs = prompted.get("outputs")
        if not isinstance(prompt_outputs, dict):
            raise LookupError("SAM 3.1 semantic prompt response did not contain object outputs")
        target_id = choose_target(prompt_outputs, prompt)
        outputs_by_frame: dict[int, dict[str, Any]] = {prompt_absolute: prompt_outputs}

        def propagate(direction: str, maximum: int) -> None:
            if maximum <= 0:
                return
            stream_request = {
                "type": "propagate_in_video",
                "session_id": session_id,
                "propagation_direction": direction,
                "start_frame_index": prompt_local,
                "max_frame_num_to_track": maximum,
                "output_prob_thresh": threshold,
            }
            with contextlib.redirect_stdout(sys.stderr):
                for response in predictor.handle_stream_request(stream_request):
                    if not isinstance(response, dict):
                        continue
                    frame_index = response.get("frame_index")
                    outputs = response.get("outputs")
                    if isinstance(frame_index, int) and 0 <= frame_index < frame_count and isinstance(outputs, dict):
                        outputs_by_frame[start_frame + frame_index] = outputs

        propagate("forward", frame_count - 1 - prompt_local)
        propagate("backward", prompt_local)
        missing = [frame for frame in range(start_frame, end_frame + 1) if frame not in outputs_by_frame]
        if missing:
            raise LookupError(f"SAM 3.1 temporal propagation did not cover requested frames: {missing[:8]}")

        safe_request = hashlib.sha256(str(request["requestId"]).encode("utf-8")).hexdigest()[:20]
        request_dir = artifact_dir / f"sam31_sequence_{safe_request}"
        encoding = str(request.get("preferredEncoding") or "ALPHA")
        frame_rate = float(request["frameRate"])
        source_evidence = [item for item in source.get("evidenceIds", []) if nonempty(item)]
        sam3_version = str(getattr(sam3, "__version__", "unknown"))
        common_evidence = list(dict.fromkeys(source_evidence + [
            MODEL_EVIDENCE,
            f"SAM31_CODE_VERSION:{sam3_version}",
            f"SAM31_CHECKPOINT:{checkpoint_source}",
            f"SAM31_SEQUENCE_TARGET:{target_id}",
            "SAM31_TEMPORAL:VIDEO_SESSION_PROPAGATION",
            "SAM31_EDGE_QUALITY:MODEL_CONFIDENCE_PROXY",
            "SAM31_OCCLUSION:TARGET_PRESENCE",
        ]))

        frames: list[dict[str, Any]] = []
        artifact_frames: list[dict[str, Any]] = []
        dimensions: tuple[int, int] | None = None
        for absolute_index in range(start_frame, end_frame + 1):
            try:
                seeded_mask, _, _ = target_mask(outputs_by_frame[absolute_index], target_id, None)
                dimensions = (int(seeded_mask.shape[0]), int(seeded_mask.shape[1]))
                break
            except LookupError:
                continue
        if dimensions is None:
            raise LookupError(f"SAM 3.1 temporal propagation never exposed target object {target_id}")
        previous_mask = None
        for local_index in range(frame_count):
            absolute_index = start_frame + local_index
            mask, confidence, absent = target_mask(outputs_by_frame[absolute_index], target_id, dimensions)
            if dimensions is None:
                dimensions = (int(mask.shape[0]), int(mask.shape[1]))
            if mask.shape != dimensions:
                raise LookupError("SAM 3.1 temporal mask geometry changed within the requested sequence")
            height, width = dimensions
            output_path = request_dir / f"mask-{local_index:06d}.png"
            digest = save_png(mask, encoding, output_path)
            consistency = temporal_iou(mask, previous_mask)
            previous_mask = mask
            frame_evidence = list(dict.fromkeys(common_evidence + [
                f"SAM31_SEQUENCE_FRAME:{absolute_index}",
                f"SAM31_ARTIFACT_SHA256:{digest}",
            ]))
            artifact_id = f"sam31-sequence:{request['requestId']}:{local_index}:{digest[:24]}"
            frames.append({
                "frameIndex": local_index,
                "timestampMs": float(request["startTimestampMs"]) + local_index * 1000.0 / frame_rate,
                "mask": {
                    "encoding": encoding,
                    "width": width,
                    "height": height,
                    "boundsNormalized": [0, 0, 1, 1],
                    "artifact": {
                        "artifactId": artifact_id,
                        "contentType": "image/png",
                        "sha256": digest,
                    },
                },
                "confidence": clamp01(confidence),
                "edgeQuality": clamp01(confidence),
                "temporalConsistency": consistency,
                "occlusion": 1.0 if absent else clamp01(1.0 - confidence),
                "evidenceIds": frame_evidence,
            })
            artifact_frames.append({"frameIndex": local_index, "artifactPath": str(output_path.resolve())})

        result: dict[str, Any] = {
            "requestId": request["requestId"],
            "sourceId": request["sourceId"],
            "semanticId": request["semanticId"],
            "providerId": PROVIDER_ID,
            "providerVersion": f"{PROVIDER_VERSION_FAMILY}:code-{sam3_version}",
            "startTimestampMs": request["startTimestampMs"],
            "startFrameIndex": request["startFrameIndex"],
            "frameRate": request["frameRate"],
            "frameCount": request["frameCount"],
            "frames": frames,
            "evidenceIds": common_evidence,
        }
        if nonempty(request.get("entityClass")):
            result["entityClass"] = request["entityClass"]
        return {"status": "COMPLETED", "artifactFrames": artifact_frames, "result": result}
    finally:
        if session_id:
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    predictor.handle_request({"type": "close_session", "session_id": session_id})
            except Exception:
                pass
        window_manager.cleanup()
        for grounding_method_name, native_grounding in native_grounding_methods.items():
            setattr(detector, grounding_method_name, native_grounding)
        sam31_decoder.sdpa_kernel = native_sdpa_kernel


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EditFlow local SAM 3.1 temporal segmentation provider")
    parser.add_argument("--request-json", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        payload = json.loads(args.request_json)
        if not isinstance(payload, dict):
            return refuse("INVALID_PAYLOAD", "sidecar request must be a JSON object")
        return emit(run_sequence(payload))
    except PermissionError as error:
        return refuse("CHECKPOINT_ACCESS_REQUIRED", str(error))
    except (ValueError, LookupError) as error:
        return refuse("SEGMENTATION_SEQUENCE_REFUSED", str(error))
    except Exception as error:
        text = str(error)
        lower = text.lower()
        if "gated" in lower or "401" in lower or "403" in lower or "hugging face" in lower or "huggingface" in lower:
            return refuse("CHECKPOINT_ACCESS_REQUIRED", text)
        return refuse("SEGMENTATION_SEQUENCE_RUNTIME_FAILED", text)


if __name__ == "__main__":
    raise SystemExit(main())
