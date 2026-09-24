import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np

ALGORITHM_ID = "editflow.practice-cross-source-subject-bind.orb-homography.v1"


def clamp01(value):
    return float(max(0.0, min(1.0, value)))


def sha256_frame(frame):
    h = hashlib.sha256()
    h.update(str(frame.shape).encode("utf-8"))
    h.update(frame.tobytes())
    return h.hexdigest()


def read_frame(video_path, time_ms):
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not math.isfinite(fps) or fps <= 0 or count <= 0 or width <= 0 or height <= 0:
        capture.release()
        raise RuntimeError("Video reports invalid timing or geometry metadata.")
    duration_ms = count * 1000.0 / fps
    bounded = min(max(0.0, float(time_ms)), max(0.0, duration_ms - 1000.0 / fps))
    capture.set(cv2.CAP_PROP_POS_MSEC, bounded)
    ok, frame = capture.read()
    capture.release()
    if not ok or frame is None:
        raise RuntimeError(f"Could not read video frame at {bounded:.3f} ms: {video_path}")
    return frame, {
        "fps": fps,
        "frameCount": count,
        "width": width,
        "height": height,
        "durationMs": duration_ms,
        "sampleTimeMs": bounded,
    }


def normalized_box(values):
    if len(values) != 4:
        raise ValueError("--reference-box requires x y width height.")
    x, y, width, height = [float(item) for item in values]
    if not all(math.isfinite(item) for item in (x, y, width, height)):
        raise ValueError("Subject box must contain finite numbers.")
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
        raise ValueError("Subject box must be normalized inside [0, 1].")
    return x, y, width, height


def crop_box(frame, box):
    x, y, width, height = box
    frame_h, frame_w = frame.shape[:2]
    left = max(0, min(frame_w - 1, int(round(x * frame_w))))
    top = max(0, min(frame_h - 1, int(round(y * frame_h))))
    right = max(left + 1, min(frame_w, int(round((x + width) * frame_w))))
    bottom = max(top + 1, min(frame_h, int(round((y + height) * frame_h))))
    return frame[top:bottom, left:right]


def resize_longest(frame, longest):
    height, width = frame.shape[:2]
    scale = min(1.0, float(longest) / float(max(height, width)))
    if scale >= 0.999:
        return frame, 1.0
    resized = cv2.resize(
        frame,
        (max(2, int(round(width * scale))), max(2, int(round(height * scale)))),
        interpolation=cv2.INTER_AREA,
    )
    return resized, scale
def appearance_similarity(reference_crop, source_crop):
    if reference_crop.size == 0 or source_crop.size == 0:
        return 0.0
    ref = cv2.resize(reference_crop, (192, 192), interpolation=cv2.INTER_AREA)
    src = cv2.resize(source_crop, (192, 192), interpolation=cv2.INTER_AREA)
    ref_hsv = cv2.cvtColor(ref, cv2.COLOR_BGR2HSV)
    src_hsv = cv2.cvtColor(src, cv2.COLOR_BGR2HSV)
    hist_ref = cv2.calcHist([ref_hsv], [0, 1], None, [24, 24], [0, 180, 0, 256])
    hist_src = cv2.calcHist([src_hsv], [0, 1], None, [24, 24], [0, 180, 0, 256])
    cv2.normalize(hist_ref, hist_ref)
    cv2.normalize(hist_src, hist_src)
    hist = (cv2.compareHist(hist_ref, hist_src, cv2.HISTCMP_CORREL) + 1.0) / 2.0
    ref_gray = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    src_gray = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY)
    ref_edges = cv2.Canny(ref_gray, 70, 150)
    src_edges = cv2.Canny(src_gray, 70, 150)
    edge_overlap = float(np.mean((ref_edges > 0) == (src_edges > 0)))
    return clamp01(0.72 * hist + 0.28 * edge_overlap)


def bind_subject(reference_frame, source_frame, reference_box):
    reference_crop = crop_box(reference_frame, reference_box)
    if min(reference_crop.shape[:2]) < 24:
        return {"verified": False, "reason": "REFERENCE_SUBJECT_CROP_TOO_SMALL"}

    reference_work, _ = resize_longest(reference_crop, 640)
    source_work, source_scale = resize_longest(source_frame, 1280)
    reference_gray = cv2.cvtColor(reference_work, cv2.COLOR_BGR2GRAY)
    source_gray = cv2.cvtColor(source_work, cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(nfeatures=1800, scaleFactor=1.2, nlevels=8, fastThreshold=12)
    ref_points, ref_desc = orb.detectAndCompute(reference_gray, None)
    src_points, src_desc = orb.detectAndCompute(source_gray, None)
    if ref_desc is None or src_desc is None or len(ref_points) < 8 or len(src_points) < 8:
        return {"verified": False, "reason": "INSUFFICIENT_ORB_FEATURES"}

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    pairs = matcher.knnMatch(ref_desc, src_desc, k=2)
    good = [first for first, second in pairs if first.distance < 0.75 * second.distance]
    good.sort(key=lambda item: item.distance)
    good = good[:160]
    if len(good) < 8:
        return {"verified": False, "reason": "INSUFFICIENT_CROSS_SOURCE_FEATURE_MATCHES", "goodMatches": len(good)}
    ref_xy = np.float32([ref_points[item.queryIdx].pt for item in good]).reshape(-1, 1, 2)
    src_xy = np.float32([src_points[item.trainIdx].pt for item in good]).reshape(-1, 1, 2)
    homography, inlier_mask = cv2.findHomography(ref_xy, src_xy, cv2.RANSAC, 4.0)
    if homography is None or inlier_mask is None:
        return {"verified": False, "reason": "CROSS_SOURCE_HOMOGRAPHY_FAILED", "goodMatches": len(good)}
    inliers = int(inlier_mask.ravel().sum())
    inlier_ratio = inliers / max(1, len(good))

    ref_h, ref_w = reference_work.shape[:2]
    corners = np.float32([[[0, 0]], [[ref_w, 0]], [[ref_w, ref_h]], [[0, ref_h]]])
    projected = cv2.perspectiveTransform(corners, homography).reshape(-1, 2)
    xs = projected[:, 0] / max(source_scale, 1e-9)
    ys = projected[:, 1] / max(source_scale, 1e-9)
    source_h, source_w = source_frame.shape[:2]
    left = clamp01(float(np.min(xs)) / source_w)
    top = clamp01(float(np.min(ys)) / source_h)
    right = clamp01(float(np.max(xs)) / source_w)
    bottom = clamp01(float(np.max(ys)) / source_h)
    width = right - left
    height = bottom - top
    if width <= 0.015 or height <= 0.015 or width > 0.95 or height > 0.95:
        return {
            "verified": False,
            "reason": "CROSS_SOURCE_PROJECTED_BOX_INVALID",
            "goodMatches": len(good),
            "inliers": inliers,
            "inlierRatio": inlier_ratio,
        }
    source_box = [left, top, width, height]
    source_crop = crop_box(source_frame, source_box)
    appearance = appearance_similarity(reference_crop, source_crop)
    feature_support = clamp01((len(good) - 6.0) / 30.0)
    inlier_support = clamp01((inliers - 4.0) / 24.0)
    confidence = clamp01(
        0.42 * inlier_ratio
        + 0.22 * feature_support
        + 0.18 * inlier_support
        + 0.18 * appearance
    )
    verified = (
        len(good) >= 10
        and inliers >= 7
        and inlier_ratio >= 0.34
        and appearance >= 0.20
        and confidence >= 0.42
    )
    return {
        "verified": verified,
        "reason": None if verified else "CROSS_SOURCE_IDENTITY_BELOW_PROOF_FLOOR",
        "sourceSubjectBox": source_box,
        "goodMatches": len(good),
        "inliers": inliers,
        "inlierRatio": inlier_ratio,
        "appearanceSimilarity": appearance,
        "confidence": confidence,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-video", required=True)
    parser.add_argument("--source-video", required=True)
    parser.add_argument("--reference-ms", required=True, type=float)
    parser.add_argument("--source-ms", required=True, type=float)
    parser.add_argument("--reference-box", nargs=4, required=True, type=float)
    parser.add_argument("--reference-semantic-id", required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--shot-id", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    reference_path = Path(args.reference_video).resolve()
    source_path = Path(args.source_video).resolve()
    if not reference_path.is_file() or not source_path.is_file():
        raise FileNotFoundError("Reference and source videos must exist.")
    reference_box = normalized_box(args.reference_box)
    reference_frame, reference_video = read_frame(reference_path, args.reference_ms)
    source_frame, source_video = read_frame(source_path, args.source_ms)
    binding = bind_subject(reference_frame, source_frame, reference_box)
    reference_sha = sha256_frame(reference_frame)
    source_sha = sha256_frame(source_frame)
    source_box = binding.get("sourceSubjectBox")
    source_semantic_id = None
    if binding.get("verified") is True and source_box is not None:
        semantic_material = json.dumps(
            {
                "sourceId": args.source_id,
                "shotId": args.shot_id,
                "sourceFrameSha256": source_sha,
                "sourceSubjectBox": source_box,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        source_semantic_id = (
            "practice-source-subject:"
            + args.source_id
            + ":"
            + hashlib.sha256(semantic_material).hexdigest()[:20]
        )
    evidence = [
        "practice-subject-bind-algorithm:" + ALGORITHM_ID,
        "practice-subject-bind-reference-frame:sha256:" + reference_sha,
        "practice-subject-bind-source-frame:sha256:" + source_sha,
        "practice-subject-bind-good-matches:" + str(binding.get("goodMatches", 0)),
        "practice-subject-bind-inliers:" + str(binding.get("inliers", 0)),
    ]
    payload = {
        "schema": "editflow.practice-cross-source-subject-binding.v1",
        "algorithmId": ALGORITHM_ID,
        "verified": binding.get("verified") is True,
        "reason": binding.get("reason"),
        "referenceSemanticId": args.reference_semantic_id,
        "sourceSemanticId": source_semantic_id,
        "referenceSubjectBox": list(reference_box),
        "sourceSubjectBox": source_box,
        "referenceVideo": reference_video,
        "sourceVideo": source_video,
        "referenceFrameSha256": reference_sha,
        "sourceFrameSha256": source_sha,
        "goodMatches": int(binding.get("goodMatches", 0)),
        "inliers": int(binding.get("inliers", 0)),
        "inlierRatio": float(binding.get("inlierRatio", 0.0)),
        "appearanceSimilarity": float(binding.get("appearanceSimilarity", 0.0)),
        "confidence": float(binding.get("confidence", 0.0)),
        "evidenceRefs": evidence,
    }
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"ok": True, "output": str(output), "verified": payload["verified"]}))


if __name__ == "__main__":
    main()
