#!/usr/bin/env python3
import argparse
import bisect
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path

import cv2
import numpy as np

ALGORITHM_ID = "editflow.practice-media-match.v1"
DEFAULT_ANALYSIS_SIZE = 320
DEFAULT_ANALYSIS_PROXY_FPS = 12.0
DEFAULT_ANALYSIS_PROXY_MAX_DIMENSION = 360

cv2.setNumThreads(1)


def clamp01(value):
    return float(min(1.0, max(0.0, value)))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def analyzer_fingerprint():
    digest = hashlib.sha256()
    digest.update(Path(__file__).resolve().read_bytes())
    digest.update(ALGORITHM_ID.encode("utf-8"))
    digest.update(str(cv2.__version__).encode("utf-8"))
    digest.update(str(np.__version__).encode("utf-8"))
    return digest.hexdigest()


def resize_longest(frame, longest=DEFAULT_ANALYSIS_SIZE):
    height, width = frame.shape[:2]
    scale = min(1.0, float(longest) / max(height, width))
    if scale >= 0.999:
        return frame
    return cv2.resize(
        frame,
        (max(2, round(width * scale)), max(2, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def normalized_vector(values):
    vector = np.asarray(values, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    if norm <= 1e-9:
        return np.zeros_like(vector)
    return vector / norm


def frame_descriptor(frame):
    small = cv2.resize(resize_longest(frame, 192), (64, 64), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    equalized = cv2.equalizeHist(gray)

    dct = cv2.dct(equalized.astype(np.float32) / 255.0)[:6, :6].reshape(-1)[1:]
    dct = normalized_vector(dct)

    edges = cv2.Canny(equalized, 60, 150)
    edge_dct = cv2.dct(edges.astype(np.float32) / 255.0)[:5, :5].reshape(-1)
    edge_dct = normalized_vector(edge_dct)

    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [8, 4], [0, 180, 0, 256]).reshape(-1)
    hist_sum = float(hist.sum())
    if hist_sum > 0:
        hist /= hist_sum

    hash_input = cv2.resize(equalized, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (hash_input[:, 1:] > hash_input[:, :-1]).reshape(-1)
    hash_value = 0
    for index, bit in enumerate(bits):
        if bool(bit):
            hash_value |= 1 << index

    return {
        "dct": [round(float(v), 6) for v in dct],
        "edgeDct": [round(float(v), 6) for v in edge_dct],
        "hsv": [round(float(v), 6) for v in hist],
        "dhash": f"{hash_value:016x}",
    }


def cosine_similarity(a, b):
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    if va.shape != vb.shape or va.size == 0:
        return 0.0
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom <= 1e-9:
        return 0.0
    return clamp01((float(np.dot(va, vb)) / denom + 1.0) * 0.5)


def descriptor_similarity(a, b):
    dct = cosine_similarity(a["dct"], b["dct"])
    edge = cosine_similarity(a["edgeDct"], b["edgeDct"])
    ah = np.asarray(a["hsv"], dtype=np.float32)
    bh = np.asarray(b["hsv"], dtype=np.float32)
    hist = clamp01(float(np.minimum(ah, bh).sum()))
    xor = int(a["dhash"], 16) ^ int(b["dhash"], 16)
    hash_similarity = 1.0 - (xor.bit_count() / 64.0)
    return clamp01((0.32 * dct) + (0.28 * edge) + (0.20 * hist) + (0.20 * hash_similarity))


def cut_score(previous, current):
    prev_small = cv2.resize(previous, (96, 54), interpolation=cv2.INTER_AREA)
    curr_small = cv2.resize(current, (96, 54), interpolation=cv2.INTER_AREA)
    prev_hsv = cv2.cvtColor(prev_small, cv2.COLOR_BGR2HSV)
    curr_hsv = cv2.cvtColor(curr_small, cv2.COLOR_BGR2HSV)
    prev_hist = cv2.calcHist([prev_hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])
    curr_hist = cv2.calcHist([curr_hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])
    cv2.normalize(prev_hist, prev_hist, alpha=1, norm_type=cv2.NORM_L1)
    cv2.normalize(curr_hist, curr_hist, alpha=1, norm_type=cv2.NORM_L1)
    hist_distance = float(cv2.compareHist(prev_hist, curr_hist, cv2.HISTCMP_BHATTACHARYYA))
    prev_gray = cv2.cvtColor(prev_small, cv2.COLOR_BGR2GRAY)
    curr_gray = cv2.cvtColor(curr_small, cv2.COLOR_BGR2GRAY)
    pixel_delta = float(np.mean(cv2.absdiff(prev_gray, curr_gray)) / 255.0)
    return clamp01((0.72 * hist_distance) + (0.28 * pixel_delta))


def reference_tail_metrics(frames):
    grays = []
    saturations = []
    entropies = []
    edges = []
    for frame in frames:
        small = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        edge = cv2.Canny(gray, 60, 150)
        hist = cv2.calcHist([gray], [0], None, [32], [0, 256]).reshape(-1)
        total = float(hist.sum())
        if total > 0:
            probabilities = hist / total
            positive = probabilities[probabilities > 0]
            entropy = float(-(positive * np.log2(positive)).sum() / 5.0)
        else:
            entropy = 0.0
        grays.append(gray)
        saturations.append(float(np.mean(hsv[:, :, 1]) / 255.0))
        entropies.append(clamp01(entropy))
        edges.append(float(np.mean(edge) / 255.0))

    motions = [
        float(np.mean(cv2.absdiff(grays[index - 1], grays[index])) / 255.0)
        for index in range(1, len(grays))
    ]
    return {
        "sampleCount": len(grays),
        "meanMotion": float(np.mean(motions)) if motions else 0.0,
        "maxMotion": float(np.max(motions)) if motions else 0.0,
        "meanSaturation": float(np.mean(saturations)) if saturations else 0.0,
        "meanEntropy": float(np.mean(entropies)) if entropies else 0.0,
        "meanEdgeDensity": float(np.mean(edges)) if edges else 0.0,
    }


def classify_static_tail_artifact(shot, previous_shot, source_duration_ms):
    metrics = shot.get("_tailMetrics", {})
    previous = previous_shot.get("_tailMetrics", {})
    shot_duration = float(shot["referenceEndMs"] - shot["referenceStartMs"])
    start_fraction = float(shot["referenceStartMs"]) / max(float(source_duration_ms), 1.0)
    if (
        int(metrics.get("sampleCount", 0)) < 4
        or shot_duration < 1000.0
        or start_fraction < 0.55
        or float(metrics.get("meanMotion", 1.0)) > 0.008
        or float(metrics.get("maxMotion", 1.0)) > 0.020
        or float(metrics.get("meanSaturation", 1.0)) > 0.050
        or float(metrics.get("meanEntropy", 1.0)) > 0.350
        or float(metrics.get("meanEdgeDensity", 1.0)) > 0.060
    ):
        return None

    preceding_content_signal = (
        float(previous.get("meanMotion", 0.0)) >= 0.020
        or float(previous.get("meanSaturation", 0.0)) >= 0.120
        or float(previous.get("meanEntropy", 0.0)) >= 0.450
    )
    if not preceding_content_signal:
        return None

    staticness = clamp01(1.0 - float(metrics["meanMotion"]) / 0.008)
    desaturation = clamp01(1.0 - float(metrics["meanSaturation"]) / 0.050)
    low_entropy = clamp01(1.0 - float(metrics["meanEntropy"]) / 0.350)
    low_edges = clamp01(1.0 - float(metrics["meanEdgeDensity"]) / 0.060)
    duration_support = clamp01((shot_duration - 1000.0) / 1400.0)
    confidence = clamp01(
        0.76
        + (0.08 * staticness)
        + (0.05 * desaturation)
        + (0.04 * low_entropy)
        + (0.03 * low_edges)
        + (0.04 * duration_support)
    )
    metrics_ref = (
        "practice-tail-artifact-metrics:"
        + f"motion={metrics['meanMotion']:.6f};"
        + f"maxMotion={metrics['maxMotion']:.6f};"
        + f"saturation={metrics['meanSaturation']:.6f};"
        + f"entropy={metrics['meanEntropy']:.6f};"
        + f"edges={metrics['meanEdgeDensity']:.6f}"
    )
    return {
        "kind": "STATIC_LOW_INFORMATION_TAIL",
        "referenceStartMs": float(shot["referenceStartMs"]),
        "referenceEndMs": float(shot["referenceEndMs"]),
        "confidence": confidence,
        "evidenceRefs": [
            *shot["evidenceRefs"],
            metrics_ref,
            f"practice-tail-artifact-confidence:{confidence:.6f}",
        ],
    }


def video_metadata(capture):
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not math.isfinite(fps) or fps <= 0 or frame_count <= 0:
        raise RuntimeError("Video reports invalid timing metadata.")
    duration_ms = frame_count * 1000.0 / fps
    return fps, frame_count, width, height, duration_ms


def ensure_analysis_proxy(
    video_path,
    proxy_path,
    explicit_ffmpeg=None,
    analysis_fps=DEFAULT_ANALYSIS_PROXY_FPS,
    max_dimension=DEFAULT_ANALYSIS_PROXY_MAX_DIMENSION,
):
    video_path = Path(video_path).resolve()
    proxy_path = Path(proxy_path).resolve()
    proxy_path.parent.mkdir(parents=True, exist_ok=True)
    if proxy_path.is_file() and proxy_path.stat().st_size > 0:
        capture = cv2.VideoCapture(str(proxy_path))
        try:
            if capture.isOpened():
                fps, frame_count, _width, _height, _duration_ms = video_metadata(capture)
                if frame_count > 0 and abs(fps - float(analysis_fps)) <= 0.5:
                    return proxy_path
        except RuntimeError:
            pass
        finally:
            capture.release()

    ffmpeg_exe = resolve_ffmpeg(explicit_ffmpeg)
    temporary = proxy_path.with_name(
        proxy_path.stem + ".partial-" + str(os.getpid()) + proxy_path.suffix
    )
    if temporary.exists():
        temporary.unlink()
    scale_filter = (
        "fps=" + str(float(analysis_fps))
        + ",scale=w=if(gte(iw\\,ih)\\," + str(int(max_dimension))
        + "\\,-2):h=if(gte(iw\\,ih)\\,-2\\," + str(int(max_dimension)) + ")"
    )
    command = [
        ffmpeg_exe,
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-i", str(video_path),
        "-map", "0:v:0",
        "-an",
        "-vf", scale_filter,
        "-fps_mode", "cfr",
        "-c:v", "mjpeg",
        "-q:v", "4",
        "-f", "avi",
        "-y", str(temporary),
    ]
    completed = subprocess.run(
        command,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0 or not temporary.is_file() or temporary.stat().st_size <= 0:
        if temporary.exists():
            temporary.unlink()
        message = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError("Practice analysis proxy creation failed: " + message)
    temporary.replace(proxy_path)
    return proxy_path


class FrameReader:
    def __init__(self, path):
        self.path = str(path)
        self.capture = cv2.VideoCapture(self.path)
        if not self.capture.isOpened():
            raise RuntimeError(f"Could not open video: {path}")
        self.fps, self.frame_count, self.width, self.height, self.duration_ms = video_metadata(self.capture)
        self.cache = {}

    def close(self):
        self.capture.release()

    def read_ms(self, time_ms):
        bounded = min(max(0.0, float(time_ms)), max(0.0, self.duration_ms - (1000.0 / self.fps)))
        key = int(round(bounded / 10.0) * 10)
        if key in self.cache:
            return self.cache[key]
        self.capture.set(cv2.CAP_PROP_POS_MSEC, bounded)
        ok, frame = self.capture.read()
        if not ok:
            return None
        frame = resize_longest(frame)
        self.cache[key] = frame
        return frame


def perceptual_signature_from_reader(reader, duration_ms, sample_count=16):
    hashes = []
    duration = max(1.0, float(duration_ms))
    for index in range(sample_count):
        time_ms = duration * ((index + 0.5) / sample_count)
        frame = reader.read_ms(time_ms)
        if frame is not None:
            hashes.append(frame_descriptor(frame)["dhash"])
    return ",".join(hashes) if len(hashes) >= 8 else None


def perceptual_signature_from_samples(samples, sample_count=16):
    if not samples:
        return None
    hashes = []
    for index in range(sample_count):
        position = int(round(((index + 0.5) * len(samples) / sample_count) - 0.5))
        position = min(max(0, position), len(samples) - 1)
        hashes.append(samples[position]["descriptor"]["dhash"])
    return ",".join(hashes)


_SIFT = cv2.SIFT_create(nfeatures=600)
_RESCUE_ORB = cv2.ORB_create(
    nfeatures=3000,
    scaleFactor=1.15,
    nlevels=12,
    fastThreshold=5,
)
_RESCUE_CLAHE = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
_FRAME_DESCRIPTOR_CACHE = {}
_FRAME_FEATURE_CACHE = {}
_RESCUE_ORB_FEATURE_CACHE = {}
_RESCUE_NORMALIZED_FRAME_CACHE = {}


def cached_descriptor(frame):
    key = id(frame)
    cached = _FRAME_DESCRIPTOR_CACHE.get(key)
    if cached is not None:
        return cached
    descriptor = frame_descriptor(frame)
    _FRAME_DESCRIPTOR_CACHE[key] = descriptor
    return descriptor


def cached_features(frame):
    key = id(frame)
    cached = _FRAME_FEATURE_CACHE.get(key)
    if cached is not None:
        return cached
    descriptor = cached_descriptor(frame)
    gray = cv2.cvtColor(resize_longest(frame, 360), cv2.COLOR_BGR2GRAY)
    keypoints, sift = _SIFT.detectAndCompute(gray, None)
    result = (descriptor, keypoints or [], sift)
    _FRAME_FEATURE_CACHE[key] = result
    return result


def normalized_rescue_frame(frame):
    key = id(frame)
    cached = _RESCUE_NORMALIZED_FRAME_CACHE.get(key)
    if cached is not None:
        return cached
    gray = cv2.cvtColor(resize_longest(frame, 480), cv2.COLOR_BGR2GRAY)
    normalized = _RESCUE_CLAHE.apply(gray)
    result = cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR)
    _RESCUE_NORMALIZED_FRAME_CACHE[key] = result
    return result


def cached_rescue_orb_features(frame):
    key = id(frame)
    cached = _RESCUE_ORB_FEATURE_CACHE.get(key)
    if cached is not None:
        return cached
    descriptor = cached_descriptor(frame)
    gray = cv2.cvtColor(resize_longest(frame, 360), cv2.COLOR_BGR2GRAY)
    keypoints, orb = _RESCUE_ORB.detectAndCompute(gray, None)
    result = (descriptor, keypoints or [], orb)
    _RESCUE_ORB_FEATURE_CACHE[key] = result
    return result


def feature_match_evidence(
    reference_frame,
    source_frame,
    feature_reader=None,
    ratio_threshold=0.75,
    ransac_threshold=4.0,
    matcher_norm=cv2.NORM_L2,
):
    if feature_reader is None:
        feature_reader = cached_features
    ref_global, ref_keypoints, ref_desc = feature_reader(reference_frame)
    src_global, src_keypoints, src_desc = feature_reader(source_frame)
    global_score = descriptor_similarity(ref_global, src_global)
    empty = {
        "score": clamp01(global_score * 0.88),
        "globalScore": global_score,
        "goodMatchCount": 0,
        "inlierCount": 0,
        "inlierRatio": 0.0,
        "referenceCoverage": 0.0,
        "sourceCoverage": 0.0,
        "geometrySupport": 0.0,
    }
    if ref_desc is None or src_desc is None or len(ref_desc) < 4 or len(src_desc) < 4:
        return empty

    matcher = cv2.BFMatcher(matcher_norm)
    pairs = matcher.knnMatch(ref_desc, src_desc, k=2)
    good = [
        pair[0]
        for pair in pairs
        if len(pair) >= 2 and pair[0].distance < ratio_threshold * pair[1].distance
    ]
    if len(good) < 4:
        return {**empty, "score": clamp01(global_score * 0.90), "goodMatchCount": len(good)}

    reference_points = np.float32([ref_keypoints[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    source_points = np.float32([src_keypoints[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    _matrix, mask = cv2.findHomography(
        reference_points,
        source_points,
        cv2.RANSAC,
        float(ransac_threshold),
    )
    if mask is None:
        return {**empty, "score": clamp01(global_score * 0.90), "goodMatchCount": len(good)}

    flags = mask.reshape(-1) > 0
    inlier_count = int(np.sum(flags))
    inlier_ratio = float(np.mean(flags)) if len(flags) else 0.0

    def point_coverage(points, width, height):
        if len(points) < 3:
            return 0.0
        hull = cv2.convexHull(np.asarray(points, dtype=np.float32))
        return clamp01(float(cv2.contourArea(hull)) / max(1.0, float(width * height)))

    ref_gray = cv2.cvtColor(resize_longest(reference_frame, 360), cv2.COLOR_BGR2GRAY)
    src_gray = cv2.cvtColor(resize_longest(source_frame, 360), cv2.COLOR_BGR2GRAY)
    ref_inliers = [ref_keypoints[good[index].queryIdx].pt for index, value in enumerate(flags) if value]
    src_inliers = [src_keypoints[good[index].trainIdx].pt for index, value in enumerate(flags) if value]
    reference_coverage = point_coverage(ref_inliers, ref_gray.shape[1], ref_gray.shape[0])
    source_coverage = point_coverage(src_inliers, src_gray.shape[1], src_gray.shape[0])

    match_strength = clamp01(len(good) / 30.0)
    feature_score = clamp01((0.58 * inlier_ratio) + (0.42 * match_strength))
    geometry_support = clamp01(
        (0.36 * clamp01(inlier_count / 12.0))
        + (0.32 * clamp01(inlier_ratio / 0.70))
        + (0.16 * clamp01(reference_coverage / 0.18))
        + (0.16 * clamp01(source_coverage / 0.18))
    )
    return {
        "score": clamp01((0.42 * global_score) + (0.58 * feature_score)),
        "globalScore": global_score,
        "goodMatchCount": len(good),
        "inlierCount": inlier_count,
        "inlierRatio": inlier_ratio,
        "referenceCoverage": reference_coverage,
        "sourceCoverage": source_coverage,
        "geometrySupport": geometry_support,
    }


def geometry_evidence_is_strong(
    item,
    minimum_inliers=6,
    minimum_ratio=0.45,
    minimum_coverage=0.015,
    minimum_support=0.60,
):
    return (
        int(item.get("inlierCount", 0)) >= int(minimum_inliers)
        and float(item.get("inlierRatio", 0.0)) >= float(minimum_ratio)
        and min(
            float(item.get("referenceCoverage", 0.0)),
            float(item.get("sourceCoverage", 0.0)),
        ) >= float(minimum_coverage)
        and float(item.get("geometrySupport", 0.0)) >= float(minimum_support)
    )


def geometry_evidence_rank(item):
    return (
        float(item.get("geometrySupport", 0.0)),
        int(item.get("inlierCount", 0)),
        float(item.get("inlierRatio", 0.0)),
        float(item.get("score", 0.0)),
    )


def effect_robust_feature_match_evidence(reference_frame, source_frame):
    normalized_reference = normalized_rescue_frame(reference_frame)
    normalized_source = normalized_rescue_frame(source_frame)
    base = feature_match_evidence(normalized_reference, normalized_source)
    if geometry_evidence_is_strong(base, minimum_support=0.75):
        return {**base, "effectFeatureMode": "CLAHE_SIFT_V1"}

    orb = feature_match_evidence(
        normalized_reference,
        normalized_source,
        feature_reader=cached_rescue_orb_features,
        ratio_threshold=0.82,
        ransac_threshold=5.0,
        matcher_norm=cv2.NORM_HAMMING,
    )
    orb_certified = geometry_evidence_is_strong(
        orb,
        minimum_inliers=12,
        minimum_ratio=0.55,
        minimum_coverage=0.02,
        minimum_support=0.72,
    )
    if orb_certified and geometry_evidence_rank(orb) > geometry_evidence_rank(base):
        return {**orb, "effectFeatureMode": "CLAHE_ORB_V1"}
    return {**base, "effectFeatureMode": "CLAHE_SIFT_V1"}


def feature_similarity(reference_frame, source_frame):
    return feature_match_evidence(reference_frame, source_frame)["score"]


def interior_anchor_times(start_ms, end_ms):
    duration = end_ms - start_ms
    if duration <= 0:
        return []
    if duration < 700:
        phases = [0.18, 0.42, 0.66, 0.88]
    elif duration < 1400:
        phases = [0.12, 0.30, 0.48, 0.66, 0.82, 0.94]
    else:
        phases = [0.08, 0.24, 0.40, 0.56, 0.70, 0.82, 0.92, 0.97]
    return [start_ms + duration * phase for phase in phases]


def merge_cut_candidates(candidates, minimum_gap_ms):
    if not candidates:
        return []
    merged = []
    cluster = [candidates[0]]
    for candidate in candidates[1:]:
        if candidate["timeMs"] - cluster[-1]["timeMs"] <= minimum_gap_ms:
            cluster.append(candidate)
        else:
            merged.append(max(cluster, key=lambda item: item["score"]))
            cluster = [candidate]
    merged.append(max(cluster, key=lambda item: item["score"]))
    return merged


def analyze_reference(video_path, reference_id, output_path, cut_threshold, minimum_shot_ms):
    video_path = Path(video_path).resolve()
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open reference video: {video_path}")
    fps, frame_count, width, height, duration_ms = video_metadata(capture)

    scores = []
    previous = None
    frame_index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        analysis_frame = resize_longest(frame, 192)
        if previous is not None:
            score = cut_score(previous, analysis_frame)
            scores.append({
                "frame": frame_index,
                "timeMs": frame_index * 1000.0 / fps,
                "score": score,
            })
        previous = analysis_frame
        frame_index += 1
    capture.release()

    candidates = []
    for index, item in enumerate(scores):
        if item["score"] < cut_threshold:
            continue
        lo = max(0, index - 2)
        hi = min(len(scores), index + 3)
        if item["score"] >= max(entry["score"] for entry in scores[lo:hi]):
            candidates.append(item)
    cuts = merge_cut_candidates(candidates, max(120.0, minimum_shot_ms * 0.65))


    boundaries = [0.0]
    for cut in cuts:
        cut_time = float(cut["timeMs"])
        if cut_time - boundaries[-1] < minimum_shot_ms:
            continue
        if duration_ms - cut_time < minimum_shot_ms:
            continue
        boundaries.append(cut_time)
    boundaries.append(duration_ms)

    reader = FrameReader(video_path)
    shots = []
    try:
        for index in range(len(boundaries) - 1):
            start_ms = boundaries[index]
            end_ms = boundaries[index + 1]
            anchors = []
            artifact_frames = []
            for time_ms in interior_anchor_times(start_ms, end_ms):
                frame = reader.read_ms(time_ms)
                if frame is None:
                    continue
                anchors.append({
                    "timeMs": float(time_ms),
                    "descriptor": frame_descriptor(frame),
                })
                artifact_frames.append(frame)
            if not anchors:
                continue
            shots.append({
                "shotId": f"shot:{index + 1:04d}",
                "order": index,
                "referenceStartMs": float(start_ms),
                "referenceEndMs": float(end_ms),
                "anchors": anchors,
                "_tailMetrics": reference_tail_metrics(artifact_frames),
                "evidenceRefs": [
                    f"reference-video:sha256:{sha256_file(video_path)}",
                    f"reference-range-ms:{round(start_ms)}-{round(end_ms)}",
                ],
            })
    finally:
        reader.close()

    excluded_ranges = []
    content_duration_ms = float(duration_ms)
    while len(shots) >= 2:
        artifact = classify_static_tail_artifact(shots[-1], shots[-2], duration_ms)
        if artifact is None:
            break
        excluded_ranges.insert(0, artifact)
        content_duration_ms = float(shots[-1]["referenceStartMs"])
        shots.pop()

    if not shots:
        raise RuntimeError("Reference analysis excluded every shot; refusing an empty Practice target.")
    for shot in shots:
        shot.pop("_tailMetrics", None)

    style_material = [
        {
            "durationMs": round(shot["referenceEndMs"] - shot["referenceStartMs"], 3),
            "anchors": [anchor["descriptor"]["dhash"] for anchor in shot["anchors"]],
        }
        for shot in shots
    ]
    style_fingerprint = hashlib.sha256(
        json.dumps(style_material, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    perceptual_reader = FrameReader(video_path)
    try:
        perceptual_signature = perceptual_signature_from_reader(
            perceptual_reader, content_duration_ms
        )
    finally:
        perceptual_reader.close()
    payload = {
        "schema": "editflow.practice-reference-analysis.v1",
        "referenceId": reference_id,
        "sourcePath": str(video_path),
        "sourceSha256": sha256_file(video_path),
        "video": {
            "fps": fps,
            "frameCount": frame_count,
            "width": width,
            "height": height,
            "durationMs": content_duration_ms,
            "sourceDurationMs": duration_ms,
        },
        "analysis": {
            "algorithmId": ALGORITHM_ID,
            "analyzerFingerprint": analyzer_fingerprint(),
            "cutThreshold": cut_threshold,
            "minimumShotMs": minimum_shot_ms,
            "excludedTailRangeCount": len(excluded_ranges),
        },
        "styleFingerprint": style_fingerprint,
        "perceptualSignature": perceptual_signature,
        "shots": shots,
        "excludedRanges": excluded_ranges,
        "evidenceRefs": [
            f"video:sha256:{sha256_file(video_path)}",
            f"practice-analyzer:sha256:{analyzer_fingerprint()}",
            *[
                f"practice-reference-excluded-range-ms:{round(item['referenceStartMs'])}-{round(item['referenceEndMs'])}:{item['kind']}"
                for item in excluded_ranges
            ],
        ],
    }
    Path(output_path).write_text(json.dumps(payload, indent=2), encoding="utf-8", newline="\n")
    return payload


def index_source(
    video_path,
    source_id,
    output_path,
    sample_step_ms,
    explicit_ffmpeg=None,
    proxy_dir=None,
    analysis_fps=DEFAULT_ANALYSIS_PROXY_FPS,
):
    video_path = Path(video_path).resolve()
    original_capture = cv2.VideoCapture(str(video_path))
    if not original_capture.isOpened():
        raise RuntimeError(f"Could not open source video: {video_path}")
    try:
        fps, frame_count, width, height, duration_ms = video_metadata(original_capture)
    finally:
        original_capture.release()

    source_sha = sha256_file(video_path)
    proxy_root = Path(proxy_dir).resolve() if proxy_dir else Path(output_path).resolve().parent / "proxies"
    proxy_path = proxy_root / (
        source_sha[:24] + "-" + str(int(round(float(analysis_fps) * 1000.0))) + ".avi"
    )
    proxy_path = ensure_analysis_proxy(
        video_path,
        proxy_path,
        explicit_ffmpeg=explicit_ffmpeg,
        analysis_fps=analysis_fps,
    )
    capture = cv2.VideoCapture(str(proxy_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open Practice analysis proxy: {proxy_path}")
    proxy_fps, _proxy_frame_count, proxy_width, proxy_height, _proxy_duration_ms = video_metadata(capture)
    step_frames = max(1, int(round((sample_step_ms / 1000.0) * proxy_fps)))
    samples = []
    frame_index = 0
    next_sample = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index >= next_sample:
            samples.append({
                "timeMs": frame_index * 1000.0 / proxy_fps,
                "frameIndex": frame_index,
                "descriptor": frame_descriptor(frame),
            })
            next_sample += step_frames
        frame_index += 1
    capture.release()
    if not samples:
        raise RuntimeError(f"No frames were indexed from {video_path}")

    proxy_sha = sha256_file(proxy_path)
    perceptual_signature = perceptual_signature_from_samples(samples)
    payload = {
        "schema": "editflow.practice-source-index.v1",
        "sourceId": source_id,
        "sourcePath": str(video_path),
        "sourceSha256": source_sha,
        "perceptualSignature": perceptual_signature,
        "analysisProxyPath": str(proxy_path),
        "video": {
            "fps": fps,
            "frameCount": frame_count,
            "width": width,
            "height": height,
            "durationMs": duration_ms,
        },
        "analysis": {
            "algorithmId": ALGORITHM_ID,
            "analyzerFingerprint": analyzer_fingerprint(),
            "sampleStepMs": sample_step_ms,
            "sampleCount": len(samples),
            "analysisProxyFps": proxy_fps,
            "analysisProxyWidth": proxy_width,
            "analysisProxyHeight": proxy_height,
            "analysisProxySha256": proxy_sha,
        },
        "samples": samples,
        "evidenceRefs": [
            f"video:sha256:{source_sha}",
            f"practice-analysis-proxy:sha256:{proxy_sha}",
            f"practice-analysis-proxy-fps:{proxy_fps:.6f}",
            f"practice-analyzer:sha256:{analyzer_fingerprint()}",
        ],
    }
    Path(output_path).write_text(json.dumps(payload, indent=2), encoding="utf-8", newline="\n")
    return payload


def nearest_sample(index_payload, time_ms):
    samples = index_payload["samples"]
    times = index_payload["_times"]
    position = bisect.bisect_left(times, time_ms)
    candidates = []
    if position < len(samples):
        candidates.append(samples[position])
    if position > 0:
        candidates.append(samples[position - 1])
    if not candidates:
        return None
    return min(candidates, key=lambda item: abs(item["timeMs"] - time_ms))


def load_artifact(path, expected_schema):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("schema") != expected_schema:
        raise ValueError(f"Expected {expected_schema}, got {payload.get('schema')}")
    analysis = payload.get("analysis", {})
    if analysis.get("algorithmId") != ALGORITHM_ID:
        raise ValueError("Practice media artifacts must use the same algorithm family.")
    if analysis.get("analyzerFingerprint") != analyzer_fingerprint():
        raise ValueError("Practice media artifact analyzer fingerprint is stale; rebuild it.")
    return payload


def dedupe_coarse_candidates(candidates, limit):
    output = []
    for item in sorted(candidates, key=lambda entry: entry["score"], reverse=True):
        step_ms = float(item["index"]["analysis"]["sampleStepMs"])
        duplicate = any(
            kept["index"]["sourceId"] == item["index"]["sourceId"]
            and abs(kept["sample"]["timeMs"] - item["sample"]["timeMs"]) < step_ms * 1.25
            for kept in output
        )
        if duplicate:
            continue
        output.append(item)
        if len(output) >= limit:
            break
    return output


COARSE_RATE_GRID = (0.25, 0.5, 1.0, 2.0, 4.0)


def coarse_temporal_candidate_score(shot, source_index, sample):
    anchors = shot["anchors"]
    center_anchor = anchors[len(anchors) // 2]
    selected = [anchors[0], center_anchor, anchors[-1]]
    selected = list({float(anchor["timeMs"]): anchor for anchor in selected}.values())
    sample_time = float(sample["timeMs"])
    source_duration = float(source_index["video"]["durationMs"])
    sample_step = float(source_index["analysis"]["sampleStepMs"])
    best = 0.0

    for direction in (1.0, -1.0):
        for rate in COARSE_RATE_GRID:
            slope = direction * rate
            similarities = []
            valid = True
            for anchor in selected:
                source_time = sample_time + slope * (
                    float(anchor["timeMs"]) - float(center_anchor["timeMs"])
                )
                if source_time < 0.0 or source_time >= source_duration:
                    valid = False
                    break
                source_sample = nearest_sample(source_index, source_time)
                if (
                    source_sample is None
                    or abs(float(source_sample["timeMs"]) - source_time) > max(450.0, sample_step * 0.80)
                ):
                    valid = False
                    break
                similarities.append(
                    descriptor_similarity(anchor["descriptor"], source_sample["descriptor"])
                )
            if not valid or not similarities:
                continue
            average = float(np.mean(similarities))
            minimum = float(np.min(similarities))
            consistency = clamp01(1.0 - float(np.std(similarities)) * 1.6)
            score = clamp01((0.68 * average) + (0.18 * minimum) + (0.14 * consistency))
            best = max(best, score)

    if best > 0.0:
        return best
    return descriptor_similarity(center_anchor["descriptor"], sample["descriptor"])


def coarse_candidates_for_shot(shot, source_indexes, limit=16):
    all_candidates = []
    per_source = []
    source_count = max(1, len(source_indexes))
    per_source_quota = max(1, min(3, int(limit) // source_count))
    effective_limit = max(int(limit), source_count * per_source_quota)

    for source_index in source_indexes:
        source_candidates = []
        for sample in source_index["samples"]:
            score = coarse_temporal_candidate_score(shot, source_index, sample)
            item = {
                "score": score,
                "sample": sample,
                "index": source_index,
            }
            source_candidates.append(item)
            all_candidates.append(item)
        per_source.extend(dedupe_coarse_candidates(source_candidates, per_source_quota))

    retained = list(per_source)
    retained_keys = {
        (item["index"]["sourceId"], float(item["sample"]["timeMs"]))
        for item in retained
    }
    for item in dedupe_coarse_candidates(all_candidates, effective_limit):
        key = (item["index"]["sourceId"], float(item["sample"]["timeMs"]))
        if key in retained_keys:
            continue
        retained.append(item)
        retained_keys.add(key)
        if len(retained) >= effective_limit:
            break

    return sorted(retained, key=lambda entry: entry["score"], reverse=True)


def candidate_center_times(sample_time_ms, sample_step_ms):
    radius = max(100.0, float(sample_step_ms) * 0.60)
    step = min(125.0, max(50.0, float(sample_step_ms) / 8.0))
    values = []
    offset = -radius
    while offset <= radius + 1e-6:
        values.append(sample_time_ms + offset)
        offset += step
    values.append(sample_time_ms)
    return sorted(set(round(value, 3) for value in values))


RATE_GRID = (0.25, 0.333333, 0.5, 0.666667, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0)


def classify_source_time_trajectory(points):
    ordered = sorted(points, key=lambda item: item["referenceTimeMs"])
    if len(ordered) < 2:
        return {"behavior": "COMPLEX", "rewind": None}
    meaningful = []
    for index in range(1, len(ordered)):
        previous = ordered[index - 1]
        current = ordered[index]
        reference_delta = float(current["referenceTimeMs"] - previous["referenceTimeMs"])
        source_delta = float(current["sourceTimeMs"] - previous["sourceTimeMs"])
        if reference_delta <= 1e-6 or abs(source_delta) < max(18.0, reference_delta * 0.04):
            continue
        meaningful.append({
            "index": index,
            "sourceDeltaMs": source_delta,
            "referenceDeltaMs": reference_delta,
        })
    if not meaningful:
        return {"behavior": "COMPLEX", "rewind": None}
    signs = [1 if item["sourceDeltaMs"] > 0 else -1 for item in meaningful]
    if all(value > 0 for value in signs):
        return {"behavior": "FORWARD", "rewind": None}
    if all(value < 0 for value in signs):
        return {"behavior": "REVERSE", "rewind": None}

    first_negative = next((index for index, value in enumerate(signs) if value < 0), None)
    if first_negative is not None and first_negative > 0:
        preceding = signs[:first_negative]
        trailing = signs[first_negative:]
        if all(value > 0 for value in preceding) and all(value < 0 for value in trailing):
            transition_point_index = meaningful[first_negative]["index"] - 1
            start = ordered[max(0, transition_point_index)]
            end = ordered[-1]
            rewind_span = max(0.0, float(start["sourceTimeMs"] - end["sourceTimeMs"]))
            reference_span = max(1.0, float(end["referenceTimeMs"] - start["referenceTimeMs"]))
            average_similarity = float(np.mean([
                float(item.get("similarity", 0.0))
                for item in ordered[max(0, transition_point_index):]
            ]))
            motion_strength = clamp01(rewind_span / max(90.0, reference_span * 0.35))
            confidence = clamp01((0.72 * average_similarity) + (0.28 * motion_strength))
            if rewind_span >= 55.0 and confidence >= 0.55:
                return {
                    "behavior": "FORWARD_THEN_REWIND",
                    "rewind": {
                        "detected": True,
                        "referenceStartMs": float(start["referenceTimeMs"]),
                        "referenceEndMs": float(end["referenceTimeMs"]),
                        "sourceStartMs": float(start["sourceTimeMs"]),
                        "sourceEndMs": float(end["sourceTimeMs"]),
                        "rewindSpanMs": float(rewind_span),
                        "confidence": confidence,
                    },
                }
    return {"behavior": "COMPLEX", "rewind": None}


def refine_candidate(shot, candidate, reference_reader, source_reader, local_refine=False):
    anchors = shot["anchors"]
    center_anchor = anchors[len(anchors) // 2]
    reference_center = reference_reader.read_ms(center_anchor["timeMs"])
    if reference_center is None:
        return None

    sample_time = float(candidate["sample"]["timeMs"])
    sample_step = float(candidate["index"]["analysis"]["sampleStepMs"])
    fast_centers = []
    for center_time in candidate_center_times(sample_time, sample_step):
        source_center = source_reader.read_ms(center_time)
        if source_center is None:
            continue
        fast_centers.append({
            "timeMs": center_time,
            "score": descriptor_similarity(
                cached_descriptor(reference_center),
                cached_descriptor(source_center),
            ),
        })
    fast_centers.sort(key=lambda item: item["score"], reverse=True)
    best_center = None
    for center in fast_centers[:3]:
        source_center = source_reader.read_ms(center["timeMs"])
        if source_center is None:
            continue
        score = feature_similarity(reference_center, source_center)
        if best_center is None or score > best_center["score"]:
            best_center = {"timeMs": center["timeMs"], "score": score}
    if best_center is None:
        return None

    reference_frames = {}
    for anchor in anchors:
        frame = reference_reader.read_ms(anchor["timeMs"])
        if frame is not None:
            reference_frames[anchor["timeMs"]] = frame
    if not reference_frames:
        return None

    best_mapping = None
    center_reference_ms = float(center_anchor["timeMs"])
    fast_mappings = []
    for direction in (1.0, -1.0):
        for rate in RATE_GRID:
            slope = direction * rate
            similarities = []
            valid = True
            for anchor in anchors:
                reference_frame = reference_frames.get(anchor["timeMs"])
                if reference_frame is None:
                    valid = False
                    break
                source_time = best_center["timeMs"] + slope * (anchor["timeMs"] - center_reference_ms)
                if source_time < 0 or source_time >= source_reader.duration_ms:
                    valid = False
                    break
                source_frame = source_reader.read_ms(source_time)
                if source_frame is None:
                    valid = False
                    break
                similarities.append(descriptor_similarity(
                    cached_descriptor(reference_frame),
                    cached_descriptor(source_frame),
                ))
            if not valid or not similarities:
                continue
            average = float(np.mean(similarities))
            minimum = float(np.min(similarities))
            consistency = clamp01(1.0 - float(np.std(similarities)) * 1.8)
            fast_mappings.append({
                "score": clamp01((0.72 * average) + (0.18 * minimum) + (0.10 * consistency)),
                "slope": slope,
                "centerSourceMs": best_center["timeMs"],
            })

    fast_mappings.sort(key=lambda item: item["score"], reverse=True)
    for fast_mapping in fast_mappings[:4]:
        similarities = []
        slope = fast_mapping["slope"]
        for anchor in anchors:
            reference_frame = reference_frames[anchor["timeMs"]]
            source_time = best_center["timeMs"] + slope * (anchor["timeMs"] - center_reference_ms)
            source_frame = source_reader.read_ms(source_time)
            if source_frame is None:
                similarities = []
                break
            similarities.append(feature_similarity(reference_frame, source_frame))
        if not similarities:
            continue
        average = float(np.mean(similarities))
        minimum = float(np.min(similarities))
        consistency = clamp01(1.0 - float(np.std(similarities)) * 1.8)
        item = {
            "score": clamp01((0.72 * average) + (0.18 * minimum) + (0.10 * consistency)),
            "appearance": average,
            "minimum": minimum,
            "consistency": consistency,
            "slope": slope,
            "centerSourceMs": best_center["timeMs"],
            "anchorSimilarities": similarities,
        }
        if best_mapping is None or item["score"] > best_mapping["score"]:
            best_mapping = item

    if best_mapping is None or not local_refine or len(anchors) < 2:
        return best_mapping

    selected_times = []
    selected_scores = []
    search_radius = min(320.0, max(140.0, (shot["referenceEndMs"] - shot["referenceStartMs"]) * 0.18))
    for anchor in anchors:
        reference_frame = reference_frames.get(anchor["timeMs"])
        if reference_frame is None:
            continue
        predicted = best_mapping["centerSourceMs"] + best_mapping["slope"] * (
            anchor["timeMs"] - center_reference_ms
        )
        local_best = None
        for delta in np.arange(-search_radius, search_radius + 1.0, 40.0):
            source_time = predicted + float(delta)
            if source_time < 0 or source_time >= source_reader.duration_ms:
                continue
            source_frame = source_reader.read_ms(source_time)
            if source_frame is None:
                continue
            score = feature_similarity(reference_frame, source_frame)
            if local_best is None or score > local_best["score"]:
                local_best = {"timeMs": source_time, "score": score}
        if local_best is not None:
            selected_times.append((float(anchor["timeMs"]), float(local_best["timeMs"])))
            selected_scores.append(float(local_best["score"]))

    if len(selected_times) < 2:
        return best_mapping

    trajectory = [
        {
            "referenceTimeMs": float(reference_time),
            "sourceTimeMs": float(source_time),
            "similarity": float(score),
        }
        for (reference_time, source_time), score in zip(selected_times, selected_scores)
    ]
    trajectory_result = classify_source_time_trajectory(trajectory)
    enriched_best = {
        **best_mapping,
        "trajectory": trajectory,
        "temporalBehavior": trajectory_result["behavior"],
        "rewind": trajectory_result["rewind"],
    }

    x = np.asarray([item[0] - center_reference_ms for item in selected_times], dtype=np.float64)
    y = np.asarray([item[1] for item in selected_times], dtype=np.float64)
    matrix = np.column_stack((x, np.ones_like(x)))
    fitted_slope, fitted_center = np.linalg.lstsq(matrix, y, rcond=None)[0]
    if (
        not math.isfinite(float(fitted_slope))
        or not math.isfinite(float(fitted_center))
        or abs(float(fitted_slope)) < 0.15
        or abs(float(fitted_slope)) > 4.5
        or math.copysign(1.0, float(fitted_slope)) != math.copysign(1.0, best_mapping["slope"])
    ):
        return enriched_best

    residual = y - (fitted_slope * x + fitted_center)
    fit_consistency = clamp01(1.0 - float(np.sqrt(np.mean(residual * residual))) / max(search_radius, 1.0))
    average = float(np.mean(selected_scores))
    minimum = float(np.min(selected_scores))
    consistency = clamp01(
        (0.55 * (1.0 - float(np.std(selected_scores)) * 1.8))
        + (0.45 * fit_consistency)
    )
    fitted_score = clamp01((0.70 * average) + (0.17 * minimum) + (0.13 * consistency))
    fitted = {
        "score": fitted_score,
        "appearance": average,
        "minimum": minimum,
        "consistency": consistency,
        "slope": float(fitted_slope),
        "centerSourceMs": float(fitted_center),
        "anchorSimilarities": selected_scores,
        "trajectory": trajectory,
        "temporalBehavior": trajectory_result["behavior"],
        "rewind": trajectory_result["rewind"],
    }
    if fitted_score >= best_mapping["score"] - 0.015:
        return fitted
    return enriched_best


def mapping_geometric_proof(
    shot,
    mapping,
    reference_reader,
    source_reader,
    max_anchors=None,
    normalize_for_effects=False,
):
    anchors = shot["anchors"]
    center_reference_ms = float(anchors[len(anchors) // 2]["timeMs"])
    selected_anchors = anchors
    if max_anchors is not None and len(anchors) > int(max_anchors):
        indexes = np.linspace(0, len(anchors) - 1, int(max_anchors))
        selected_anchors = [anchors[int(round(index))] for index in indexes]
    trajectory = mapping.get("trajectory") or []
    trajectory_by_reference = {
        round(float(item["referenceTimeMs"]), 3): float(item["sourceTimeMs"])
        for item in trajectory
    }
    evidence = []
    for anchor in selected_anchors:
        reference_time = float(anchor["timeMs"])
        source_time = trajectory_by_reference.get(round(reference_time, 3))
        if source_time is None:
            source_time = float(mapping["centerSourceMs"]) + float(mapping["slope"]) * (
                reference_time - center_reference_ms
            )
        if source_time < 0.0 or source_time >= source_reader.duration_ms:
            continue
        reference_frame = reference_reader.read_ms(reference_time)
        source_frame = source_reader.read_ms(source_time)
        if reference_frame is None or source_frame is None:
            continue
        if normalize_for_effects:
            item = effect_robust_feature_match_evidence(
                reference_frame,
                source_frame,
            )
        else:
            item = feature_match_evidence(reference_frame, source_frame)
        item = {**item, "referenceTimeMs": reference_time, "sourceTimeMs": source_time}
        evidence.append(item)

    supports = [float(item["geometrySupport"]) for item in evidence]
    coverages = [
        min(float(item["referenceCoverage"]), float(item["sourceCoverage"]))
        for item in evidence
    ]
    strong = [
        item
        for item in evidence
        if int(item["inlierCount"]) >= 6
        and float(item["inlierRatio"]) >= 0.45
        and min(float(item["referenceCoverage"]), float(item["sourceCoverage"])) >= 0.015
    ]
    anchor_count = len(evidence)
    strong_count = len(strong)
    effect_feature_modes = sorted({
        item.get("effectFeatureMode")
        for item in evidence
        if item.get("effectFeatureMode")
    })
    return {
        "anchorCount": anchor_count,
        "strongAnchorCount": strong_count,
        "strongAnchorFraction": (strong_count / anchor_count) if anchor_count else 0.0,
        "meanSupport": float(np.mean(supports)) if supports else 0.0,
        "minimumSupport": float(np.min(supports)) if supports else 0.0,
        "maximumInlierCount": max([int(item["inlierCount"]) for item in evidence], default=0),
        "meanInlierRatio": float(np.mean([item["inlierRatio"] for item in evidence])) if evidence else 0.0,
        "meanCoverage": float(np.mean(coverages)) if coverages else 0.0,
        "effectFeatureModes": effect_feature_modes,
    }


def solve_geometric_rescue_path(anchors, source_times, evidence_matrix, direction):
    count = len(anchors)
    sample_count = len(source_times)
    if count < 2 or sample_count < 1:
        return None
    negative = -1e9
    dp = np.full((count, sample_count), negative, dtype=np.float64)
    previous = np.full((count, sample_count), -1, dtype=np.int32)

    def pair_value(item):
        return (
            (0.72 * float(item["geometrySupport"]))
            + (0.28 * float(item["score"]))
        )

    for sample_index in range(sample_count):
        dp[0, sample_index] = pair_value(evidence_matrix[0][sample_index])

    for anchor_index in range(1, count):
        gap_ms = float(
            anchors[anchor_index]["timeMs"]
            - anchors[anchor_index - 1]["timeMs"]
        )
        minimum_delta = max(40.0, 0.15 * gap_ms)
        maximum_delta = max(350.0, (4.5 * gap_ms) + 250.0)
        for sample_index, sample_time in enumerate(source_times):
            value_here = pair_value(evidence_matrix[anchor_index][sample_index])
            for prior_index, prior_time in enumerate(source_times):
                delta = (float(sample_time) - float(prior_time)) * float(direction)
                if delta < minimum_delta or delta > maximum_delta:
                    continue
                candidate = dp[anchor_index - 1, prior_index] + value_here
                if candidate > dp[anchor_index, sample_index]:
                    dp[anchor_index, sample_index] = candidate
                    previous[anchor_index, sample_index] = prior_index

    final_index = int(np.argmax(dp[-1]))
    if dp[-1, final_index] <= negative / 2:
        return None
    indexes = [final_index]
    for anchor_index in range(count - 1, 0, -1):
        final_index = int(previous[anchor_index, final_index])
        if final_index < 0:
            return None
        indexes.append(final_index)
    indexes.reverse()

    path_times = [float(source_times[index]) for index in indexes]
    path_evidence = [
        evidence_matrix[anchor_index][indexes[anchor_index]]
        for anchor_index in range(count)
    ]
    reference_times = np.asarray(
        [float(anchor["timeMs"]) for anchor in anchors],
        dtype=np.float64,
    )
    center_reference = float(reference_times[len(reference_times) // 2])
    centered = reference_times - center_reference
    source_array = np.asarray(path_times, dtype=np.float64)
    matrix = np.column_stack((centered, np.ones_like(centered)))
    fitted_slope, fitted_center = np.linalg.lstsq(
        matrix,
        source_array,
        rcond=None,
    )[0]
    fitted = (fitted_slope * centered) + fitted_center
    residual_ms = float(np.sqrt(np.mean((source_array - fitted) ** 2)))
    fit_consistency = clamp01(1.0 - (residual_ms / 500.0))

    strong = [
        item
        for item in path_evidence
        if int(item["inlierCount"]) >= 6
        and float(item["inlierRatio"]) >= 0.45
        and min(
            float(item["referenceCoverage"]),
            float(item["sourceCoverage"]),
        ) >= 0.015
    ]
    mean_support = float(np.mean([
        float(item["geometrySupport"])
        for item in path_evidence
    ]))
    mean_feature = float(np.mean([
        float(item["score"])
        for item in path_evidence
    ]))
    rescue_score = clamp01(
        (0.62 * mean_support)
        + (0.23 * mean_feature)
        + (0.15 * fit_consistency)
    )
    return {
        "score": rescue_score,
        "strongAnchorCount": len(strong),
        "meanSupport": mean_support,
        "meanFeature": mean_feature,
        "fitConsistency": fit_consistency,
        "residualMs": residual_ms,
        "slope": float(fitted_slope),
        "centerSourceMs": float(fitted_center),
        "pathTimes": path_times,
        "pathEvidence": path_evidence,
    }


def geometric_rescue_candidate(
    shot,
    source_index,
    reference_reader,
    source_reader,
    maximum_samples=480,
):
    anchors = shot["anchors"]
    if len(anchors) < 2:
        return None
    indexes = sorted(set([0, len(anchors) // 2, len(anchors) - 1]))
    selected_anchors = [anchors[index] for index in indexes]
    reference_frames = [
        reference_reader.read_ms(anchor["timeMs"])
        for anchor in selected_anchors
    ]
    if any(frame is None for frame in reference_frames):
        return None

    samples = list(source_index["samples"])
    if len(samples) > int(maximum_samples):
        positions = np.linspace(0, len(samples) - 1, int(maximum_samples))
        samples = [samples[int(round(position))] for position in positions]
    source_times = [float(sample["timeMs"]) for sample in samples]
    if not source_times:
        return None

    evidence_matrix = []
    for reference_frame in reference_frames:
        row = []
        for source_time in source_times:
            source_frame = source_reader.read_ms(source_time)
            if source_frame is None:
                row.append({
                    "score": 0.0,
                    "inlierCount": 0,
                    "inlierRatio": 0.0,
                    "referenceCoverage": 0.0,
                    "sourceCoverage": 0.0,
                    "geometrySupport": 0.0,
                })
            else:
                row.append(effect_robust_feature_match_evidence(
                    reference_frame,
                    source_frame,
                ))
        evidence_matrix.append(row)

    paths = [
        solve_geometric_rescue_path(
            selected_anchors,
            source_times,
            evidence_matrix,
            direction,
        )
        for direction in (1.0, -1.0)
    ]
    paths = [item for item in paths if item is not None]
    if not paths:
        return None
    best = max(paths, key=lambda item: item["score"])
    rate = abs(float(best["slope"]))
    if (
        int(best["strongAnchorCount"]) < 2
        or float(best["meanSupport"]) < 0.60
        or float(best["residualMs"]) > 180.0
        or rate < 0.15
        or rate > 4.5
    ):
        return None

    path_evidence = best["pathEvidence"]
    strong_count = int(best["strongAnchorCount"])
    anchor_count = len(path_evidence)
    coverages = [
        min(
            float(item["referenceCoverage"]),
            float(item["sourceCoverage"]),
        )
        for item in path_evidence
    ]
    effect_feature_modes = sorted({
        item.get("effectFeatureMode")
        for item in path_evidence
        if item.get("effectFeatureMode")
    })
    geometric_proof = {
        "anchorCount": anchor_count,
        "strongAnchorCount": strong_count,
        "strongAnchorFraction": strong_count / max(1, anchor_count),
        "meanSupport": float(best["meanSupport"]),
        "minimumSupport": float(min(
            float(item["geometrySupport"])
            for item in path_evidence
        )),
        "maximumInlierCount": max(
            int(item["inlierCount"])
            for item in path_evidence
        ),
        "meanInlierRatio": float(np.mean([
            float(item["inlierRatio"])
            for item in path_evidence
        ])),
        "meanCoverage": float(np.mean(coverages)),
        "effectFeatureModes": effect_feature_modes,
    }
    trajectory = [
        {
            "referenceTimeMs": float(anchor["timeMs"]),
            "sourceTimeMs": float(source_time),
            "similarity": float(item["score"]),
        }
        for anchor, source_time, item in zip(
            selected_anchors,
            best["pathTimes"],
            path_evidence,
        )
    ]
    direction = "FORWARD" if float(best["slope"]) >= 0.0 else "REVERSE"
    return {
        "score": float(best["score"]),
        "appearance": float(best["meanFeature"]),
        "minimum": float(min(float(item["score"]) for item in path_evidence)),
        "consistency": float(best["fitConsistency"]),
        "slope": float(best["slope"]),
        "centerSourceMs": float(best["centerSourceMs"]),
        "anchorSimilarities": [
            float(item["score"])
            for item in path_evidence
        ],
        "trajectory": trajectory,
        "temporalBehavior": direction,
        "rewind": None,
        "geometricProof": geometric_proof,
        "rescueScore": float(best["score"]),
        "rescueResidualMs": float(best["residualMs"]),
    }


def candidate_rank_score(mapping):
    proof = mapping.get("geometricProof") or {}
    strong_count = int(proof.get("strongAnchorCount", 0))
    if strong_count < 2:
        return float(mapping["score"])
    repeated_geometry = clamp01(
        (0.62 * float(proof.get("meanSupport", 0.0)))
        + (0.38 * float(proof.get("strongAnchorFraction", 0.0)))
    )
    return float(mapping["score"]) + (0.18 * repeated_geometry)


def confidence_from_result(best, second_score):
    mapping = best["mapping"]
    appearance = float(mapping["appearance"])
    base = 1.0 / (1.0 + math.exp(-14.0 * (appearance - 0.60)))
    margin = max(0.0, candidate_rank_score(mapping) - float(second_score))
    uniqueness = clamp01(margin / 0.12)
    consistency = float(mapping["consistency"])
    proof = mapping.get("geometricProof") or {}
    geometry_certainty = 0.0
    if int(proof.get("strongAnchorCount", 0)) >= 2:
        repeated_geometry = clamp01(
            (0.62 * float(proof.get("meanSupport", 0.0)))
            + (0.38 * float(proof.get("strongAnchorFraction", 0.0)))
        )
        geometry_certainty = clamp01((repeated_geometry - 0.35) / 0.65)
    evidence_union = 1.0 - ((1.0 - base) * (1.0 - geometry_certainty))
    confidence = clamp01(
        (0.88 * evidence_union)
        + (0.06 * uniqueness)
        + (0.06 * consistency)
    )
    # An exact-scene claim must be backed by repeated spatial correspondence.
    # Appearance/temporal similarity alone may rank a candidate, but cannot
    # cross the default 0.95 exact-scene gate.
    if int(proof.get("strongAnchorCount", 0)) < 2:
        confidence = min(confidence, 0.949)
    # Exact-scene confidence also requires the winning source/timing hypothesis
    # to be materially distinct from the retained runner-up. Repeated geometry
    # can prove correspondence, but it cannot by itself resolve a near-tie
    # between different source hypotheses.
    if margin < 0.02:
        confidence = min(confidence, 0.949)
    if mapping.get("rescueScore") is not None:
        rescue_certified = (
            int(proof.get("strongAnchorCount", 0)) >= 3
            and float(mapping.get("rescueScore", 0.0)) >= 0.82
            and margin >= 0.08
        )
        if not rescue_certified:
            confidence = min(confidence, 0.949)
    return confidence


def candidate_item_key(item):
    return (
        item["index"]["sourceId"],
        float(item["sample"]["timeMs"]),
    )


def candidate_selection_score(item, continuity_source_id=None, continuity_bonus=0.0):
    score = candidate_rank_score(item["mapping"])
    if (
        continuity_source_id is not None
        and item["index"]["sourceId"] == continuity_source_id
    ):
        score += float(continuity_bonus)
    return score


def distinct_second_result(results, best):
    ordered = sorted(
        results,
        key=lambda item: candidate_rank_score(item["mapping"]),
        reverse=True,
    )
    for item in ordered:
        if item is best:
            continue
        if item["index"]["sourceId"] != best["index"]["sourceId"]:
            return item
        delta = abs(item["mapping"]["centerSourceMs"] - best["mapping"]["centerSourceMs"])
        step = float(best["index"]["analysis"]["sampleStepMs"])
        if delta >= max(800.0, step * 1.5):
            return item
    return None


def distinct_second_score(results, best):
    second = distinct_second_result(results, best)
    return 0.0 if second is None else candidate_rank_score(second["mapping"])


def finalize_candidate_geometry(
    shot,
    results,
    reference_reader,
    source_readers,
    continuity_source_id=None,
    continuity_bonus=0.0,
):
    if not results:
        return []

    fully_verified = set()

    # Full geometry can lower a provisional candidate that looked strongest
    # under the three-anchor screen. Stabilize both the actual selection winner
    # and its distinct runner-up so the final ordering and confidence margin are
    # computed from comparable full-reference evidence.
    for _ in range(max(2, len(results) * 2)):
        best = max(
            results,
            key=lambda item: candidate_selection_score(
                item,
                continuity_source_id,
                continuity_bonus,
            ),
        )
        second = distinct_second_result(results, best)
        targets = [best] + ([] if second is None else [second])
        pending = [
            item
            for item in targets
            if candidate_item_key(item) not in fully_verified
        ]
        if not pending:
            break

        for item in pending:
            reader = source_readers[item["index"]["sourceId"]]
            item["mapping"] = {
                **item["mapping"],
                "geometricProof": mapping_geometric_proof(
                    shot,
                    item["mapping"],
                    reference_reader,
                    reader,
                    normalize_for_effects=(
                        item["mapping"].get("rescueScore") is not None
                    ),
                ),
            }
            fully_verified.add(candidate_item_key(item))

    return sorted(
        results,
        key=lambda item: candidate_rank_score(item["mapping"]),
        reverse=True,
    )


def reference_boundary_continuity(reference_reader, previous_shot, shot):
    boundary_ms = float(shot["referenceStartMs"])
    offset_ms = min(
        100.0,
        max(35.0, (boundary_ms - float(previous_shot["referenceStartMs"])) * 0.18),
        max(35.0, (float(shot["referenceEndMs"]) - boundary_ms) * 0.18),
    )
    before = reference_reader.read_ms(max(float(previous_shot["referenceStartMs"]), boundary_ms - offset_ms))
    after = reference_reader.read_ms(min(float(shot["referenceEndMs"]), boundary_ms + offset_ms))
    if before is None or after is None:
        return None
    descriptor = descriptor_similarity(cached_descriptor(before), cached_descriptor(after))
    feature = feature_similarity(before, after)
    score = clamp01((0.45 * descriptor) + (0.55 * feature))
    return {
        "score": score,
        "descriptor": descriptor,
        "feature": feature,
        "offsetMs": offset_ms,
    }


def scene_identity_verified(match):
    if match is None or float(match.get("confidence", 0.0)) < 0.80:
        return False
    if (
        match.get("selectionMode") == "GEOMETRIC_RESCUE"
        and float(match.get("confidence", 0.0)) < 0.95
    ):
        return False
    proof = match.get("geometricProof") or {}
    return (
        int(proof.get("strongAnchorCount", 0)) >= 2
        and float(proof.get("strongAnchorFraction", 0.0)) >= 0.30
        and float(proof.get("meanSupport", 0.0)) >= 0.45
        and int(proof.get("maximumInlierCount", 0)) >= 6
    )


def source_continuity_bonus(boundary):
    if boundary is None:
        return 0.0
    score = float(boundary["score"])
    if score < 0.70:
        return 0.0
    return 0.06 * clamp01((score - 0.70) / 0.25)


def continuity_candidates(shot, source_index, reference_reader, source_reader, limit=4):
    ranked = []
    for sample in source_index["samples"]:
        score = coarse_temporal_candidate_score(shot, source_index, sample)
        ranked.append({
            "score": score,
            "sample": sample,
            "index": source_index,
        })
    ranked.sort(key=lambda item: item["score"], reverse=True)
    output = []
    for candidate in ranked[:max(1, int(limit))]:
        mapping = refine_candidate(
            shot,
            candidate,
            reference_reader,
            source_reader,
            local_refine=True,
        )
        if mapping is None:
            continue
        output.append({
            "candidate": candidate,
            "index": source_index,
            "sample": candidate["sample"],
            "coarseScore": candidate["score"],
            "mapping": mapping,
        })
    return output


def match_reference(reference_path, source_index_paths, output_path, coarse_limit):
    reference = load_artifact(reference_path, "editflow.practice-reference-analysis.v1")
    source_indexes = [
        load_artifact(path, "editflow.practice-source-index.v1")
        for path in source_index_paths
    ]
    for source_index in source_indexes:
        source_index["_times"] = [float(sample["timeMs"]) for sample in source_index["samples"]]

    reference_reader = FrameReader(reference["sourcePath"])
    source_readers = {
        source_index["sourceId"]: FrameReader(
            source_index.get("analysisProxyPath") or source_index["sourcePath"]
        )
        for source_index in source_indexes
    }
    matches = []
    try:
        for shot_index, shot in enumerate(reference["shots"]):
            previous_shot = reference["shots"][shot_index - 1] if shot_index > 0 else None
            previous_match = (
                matches[-1]
                if previous_shot is not None
                and matches
                and matches[-1]["shotId"] == previous_shot["shotId"]
                else None
            )
            boundary = (
                reference_boundary_continuity(reference_reader, previous_shot, shot)
                if previous_shot is not None
                else None
            )
            continuity_bonus = (
                source_continuity_bonus(boundary)
                if scene_identity_verified(previous_match)
                else 0.0
            )

            coarse = coarse_candidates_for_shot(shot, source_indexes, coarse_limit)
            refined = []
            for candidate in coarse:
                reader = source_readers[candidate["index"]["sourceId"]]
                mapping = refine_candidate(shot, candidate, reference_reader, reader)
                if mapping is None:
                    continue
                refined.append({
                    "candidate": candidate,
                    "index": candidate["index"],
                    "sample": candidate["sample"],
                    "coarseScore": candidate["score"],
                    "mapping": mapping,
                })
            refined.sort(key=lambda item: item["mapping"]["score"], reverse=True)
            if not refined:
                continue

            detailed_limit = min(
                len(refined),
                max(8, min(16, len(source_indexes) * 2)),
            )
            detailed_seeds = []
            retained_seed_keys = set()
            for source_index in source_indexes:
                source_id = source_index["sourceId"]
                source_best = next(
                    (item for item in refined if item["index"]["sourceId"] == source_id),
                    None,
                )
                if source_best is None:
                    continue
                detailed_seeds.append(source_best)
                retained_seed_keys.add(
                    (source_id, float(source_best["sample"]["timeMs"]))
                )
            for item in refined:
                key = (
                    item["index"]["sourceId"],
                    float(item["sample"]["timeMs"]),
                )
                if key in retained_seed_keys:
                    continue
                detailed_seeds.append(item)
                retained_seed_keys.add(key)
                if len(detailed_seeds) >= detailed_limit:
                    break

            detailed = []
            for item in detailed_seeds:
                reader = source_readers[item["index"]["sourceId"]]
                mapping = refine_candidate(
                    shot,
                    item["candidate"],
                    reference_reader,
                    reader,
                    local_refine=True,
                )
                if mapping is None:
                    continue
                detailed.append({**item, "mapping": mapping})
            continuity_source_id = (
                previous_match["sourceId"]
                if previous_match is not None and continuity_bonus > 0.0
                else None
            )
            if continuity_source_id is not None:
                continuity_index = next(
                    (
                        item
                        for item in source_indexes
                        if item["sourceId"] == continuity_source_id
                    ),
                    None,
                )
                if continuity_index is not None:
                    continuity_reader = source_readers[continuity_source_id]
                    continuity_items = continuity_candidates(
                        shot,
                        continuity_index,
                        reference_reader,
                        continuity_reader,
                    )
                    existing_keys = {
                        (
                            item["index"]["sourceId"],
                            float(item["sample"]["timeMs"]),
                        )
                        for item in detailed
                    }
                    for item in continuity_items:
                        key = (
                            item["index"]["sourceId"],
                            float(item["sample"]["timeMs"]),
                        )
                        if key in existing_keys:
                            continue
                        detailed.append(item)
                        existing_keys.add(key)

            if not detailed:
                continue

            geometry_candidates = []
            geometry_keys = set()
            for source_index in source_indexes:
                source_id = source_index["sourceId"]
                source_items = [
                    item for item in detailed
                    if item["index"]["sourceId"] == source_id
                ]
                if not source_items:
                    continue
                source_best = max(
                    source_items,
                    key=lambda item: float(item["mapping"]["score"]),
                )
                key = (
                    source_id,
                    float(source_best["sample"]["timeMs"]),
                )
                if key not in geometry_keys:
                    geometry_candidates.append(source_best)
                    geometry_keys.add(key)

            for item in sorted(
                detailed,
                key=lambda candidate: float(candidate["mapping"]["score"]),
                reverse=True,
            )[:4]:
                key = (
                    item["index"]["sourceId"],
                    float(item["sample"]["timeMs"]),
                )
                if key in geometry_keys:
                    continue
                geometry_candidates.append(item)
                geometry_keys.add(key)

            for item in geometry_candidates:
                reader = source_readers[item["index"]["sourceId"]]
                item["mapping"] = {
                    **item["mapping"],
                    "geometricProof": mapping_geometric_proof(
                        shot,
                        item["mapping"],
                        reference_reader,
                        reader,
                        max_anchors=3,
                    ),
                }

            repeated_geometry_present = any(
                int(item["mapping"].get("geometricProof", {}).get("strongAnchorCount", 0)) >= 2
                and float(item["mapping"].get("geometricProof", {}).get("meanSupport", 0.0)) >= 0.75
                for item in detailed
            )
            if not repeated_geometry_present:
                for source_index in source_indexes:
                    source_id = source_index["sourceId"]
                    reader = source_readers[source_id]
                    rescue_mapping = geometric_rescue_candidate(
                        shot,
                        source_index,
                        reference_reader,
                        reader,
                    )
                    if rescue_mapping is None:
                        continue
                    rescue_sample = nearest_sample(
                        source_index,
                        float(rescue_mapping["centerSourceMs"]),
                    )
                    if rescue_sample is None:
                        continue
                    detailed.append({
                        "candidate": {
                            "score": float(rescue_mapping["rescueScore"]),
                            "sample": rescue_sample,
                            "index": source_index,
                        },
                        "index": source_index,
                        "sample": rescue_sample,
                        "coarseScore": float(rescue_mapping["rescueScore"]),
                        "mapping": rescue_mapping,
                    })

            refined = finalize_candidate_geometry(
                shot,
                detailed,
                reference_reader,
                source_readers,
                continuity_source_id,
                continuity_bonus,
            )
            best = max(
                refined,
                key=lambda item: candidate_selection_score(
                    item,
                    continuity_source_id,
                    continuity_bonus,
                ),
            )
            mapping = best["mapping"]
            second_score = distinct_second_score(refined, best)
            center_reference = shot["anchors"][len(shot["anchors"]) // 2]["timeMs"]
            mapped_start = mapping["centerSourceMs"] + mapping["slope"] * (
                shot["referenceStartMs"] - center_reference
            )
            mapped_end = mapping["centerSourceMs"] + mapping["slope"] * (
                shot["referenceEndMs"] - center_reference
            )
            source_duration = float(best["index"]["video"]["durationMs"])
            trajectory = mapping.get("trajectory") or []
            trajectory_source_times = [float(item["sourceTimeMs"]) for item in trajectory]
            source_start = min([mapped_start, mapped_end, *trajectory_source_times])
            source_end = max([mapped_start, mapped_end, *trajectory_source_times])
            source_start = max(0.0, source_start)
            source_end = min(source_duration, source_end)
            confidence = confidence_from_result(best, second_score)
            temporal_behavior = mapping.get("temporalBehavior") or (
                "FORWARD" if mapping["slope"] >= 0 else "REVERSE"
            )
            rewind = mapping.get("rewind")
            continuity_applied = (
                continuity_source_id is not None
                and continuity_bonus > 0.0
                and best["index"]["sourceId"] == continuity_source_id
            )
            candidate_score = candidate_rank_score(mapping)
            candidate_margin = candidate_score - float(second_score)
            selection_mode = (
                "GEOMETRIC_RESCUE"
                if mapping.get("rescueScore") is not None
                else (
                    "REFERENCE_CONTINUITY_PRIOR"
                    if continuity_applied
                    else "VISUAL_BEST"
                )
            )
            boundary_evidence = (
                [
                    f"practice-reference-boundary-continuity:{boundary['score']:.6f}",
                    f"practice-reference-boundary-descriptor:{boundary['descriptor']:.6f}",
                    f"practice-reference-boundary-feature:{boundary['feature']:.6f}",
                ]
                if boundary is not None
                else []
            )
            matches.append({
                "shotId": shot["shotId"],
                "sourceId": best["index"]["sourceId"],
                "sourcePath": best["index"]["sourcePath"],
                "sourceStartMs": float(source_start),
                "sourceEndMs": float(source_end),
                "direction": "FORWARD" if mapping["slope"] >= 0 else "REVERSE",
                "playbackRate": float(abs(mapping["slope"])),
                "trajectory": trajectory,
                "temporalBehavior": temporal_behavior,
                **({"rewind": rewind} if rewind is not None else {}),
                "appearanceSimilarity": float(mapping["appearance"]),
                "temporalSimilarity": float(mapping["consistency"]),
                "motionSimilarity": float(mapping["minimum"]),
                "geometricProof": mapping.get("geometricProof", {}),
                "confidence": confidence,
                "candidateScore": float(candidate_score),
                "runnerUpScore": float(second_score),
                "candidateMargin": float(candidate_margin),
                **(
                    {"referenceBoundaryContinuity": float(boundary["score"])}
                    if boundary is not None else {}
                ),
                "selectionMode": selection_mode,
                "evidenceRefs": [
                    f"reference-shot:{shot['shotId']}",
                    f"source-video:sha256:{best['index']['sourceSha256']}",
                    f"practice-analyzer:sha256:{analyzer_fingerprint()}",
                    f"coarse-score:{best['coarseScore']:.6f}",
                    f"refined-score:{mapping['score']:.6f}",
                    f"practice-candidate-score:{candidate_score:.6f}",
                    f"practice-runner-up-score:{second_score:.6f}",
                    f"practice-candidate-margin:{candidate_margin:.6f}",
                    f"practice-scene-selection-mode:{selection_mode}",
                    *(
                        [
                            f"practice-geometric-rescue-score:{mapping['rescueScore']:.6f}",
                            f"practice-geometric-rescue-residual-ms:{mapping.get('rescueResidualMs', 0.0):.3f}",
                            "practice-geometric-rescue-full-verification:CLAHE_SIFT_PLUS_STRICT_ORB_ALL_ANCHORS_V2",
                        ]
                        if mapping.get("rescueScore") is not None
                        else []
                    ),
                    *[
                        f"practice-geometric-effect-feature-mode:{mode}"
                        for mode in mapping.get("geometricProof", {}).get("effectFeatureModes", [])
                    ],
                    f"practice-geometric-mean-support:{mapping.get('geometricProof', {}).get('meanSupport', 0.0):.6f}",
                    f"practice-geometric-strong-anchors:{mapping.get('geometricProof', {}).get('strongAnchorCount', 0)}",
                    f"practice-geometric-strong-fraction:{mapping.get('geometricProof', {}).get('strongAnchorFraction', 0.0):.6f}",
                    f"practice-geometric-max-inliers:{mapping.get('geometricProof', {}).get('maximumInlierCount', 0)}",
                    f"practice-geometric-mean-coverage:{mapping.get('geometricProof', {}).get('meanCoverage', 0.0):.6f}",
                    f"practice-temporal-behavior:{temporal_behavior}",
                    *boundary_evidence,
                    *(
                        [
                            f"practice-source-continuity-prior:{continuity_source_id}",
                            f"practice-source-continuity-bonus:{continuity_bonus:.6f}",
                        ]
                        if continuity_applied
                        else []
                    ),
                    *(
                        [f"practice-rewind-span-ms:{rewind['rewindSpanMs']:.3f}"]
                        if rewind is not None else []
                    ),
                ],
            })
    finally:
        reference_reader.close()
        for reader in source_readers.values():
            reader.close()


    payload = {
        "schema": "editflow.practice-scene-matches.v1",
        "referenceId": reference["referenceId"],
        "analysis": {
            "algorithmId": ALGORITHM_ID,
            "analyzerFingerprint": analyzer_fingerprint(),
            "coarseCandidateLimit": coarse_limit,
            "coarseCandidateStrategy": "SOURCE_BALANCED_TEMPORAL_V2",
            "refinementMode": "PROXY_PROGRESSIVE_SOURCE_BALANCED_GEOMETRIC_V3",
            "geometricVerificationMode": "SOURCE_BEST_PLUS_TOP4_THREE_ANCHOR_THEN_STABLE_FULL_FINALISTS_V2",
            "geometricFinalizationMode": "ITERATIVE_FULL_WINNER_DISTINCT_RUNNER_UP_V1",
            "geometricRankingMinimumStrongAnchors": 2,
            "geometricRankingSampledAnchors": 3,
            "geometricRescueMode": "BOUNDED_THREE_ANCHOR_COHERENT_PATH_V1",
            "geometricRescuePhotometricNormalization": "CLAHE_V1",
            "geometricRescueEffectEvidenceMode": "CLAHE_SIFT_PLUS_STRICT_ORB_FALLBACK_V1",
            "geometricRescueOrbMinimumInliers": 12,
            "geometricRescueOrbMinimumInlierRatio": 0.55,
            "geometricRescueOrbMinimumCoverage": 0.02,
            "geometricRescueOrbMinimumSupport": 0.72,
            "geometricRescueFullVerificationMode": "CLAHE_SIFT_PLUS_STRICT_ORB_ALL_ANCHORS_V2",
            "geometricRescueExactSceneGate": "THREE_STRONG_ANCHORS_SCORE_0_82_MARGIN_0_08_V1",
            "geometricRescueMaximumSamplesPerSource": 480,
            "geometricRescueMinimumStrongAnchors": 2,
            "geometricRescueMinimumMeanSupport": 0.60,
            "geometricRescueMaximumResidualMs": 180.0,
            "geometricRescueExactMinimumStrongAnchors": 3,
            "geometricRescueExactMinimumScore": 0.82,
            "geometricRescueExactMinimumCandidateMargin": 0.08,
            "sourceContinuityMode": "REFERENCE_BOUNDARY_V1",
            "sourceContinuityIdentityGate": "CONFIDENCE_0_80_PLUS_REPEATED_GEOMETRY_V1",
            "sourceContinuityThreshold": 0.70,
            "sourceContinuityMaximumBonus": 0.06,
            "detailedCandidateLimit": max(
                8,
                min(16, len(source_indexes) * 2),
            ),
        },
        "sourceIndexIds": [item["sourceId"] for item in source_indexes],
        "matches": matches,
        "evidenceRefs": [
            *reference.get("evidenceRefs", []),
            *[
                ref
                for source_index in source_indexes
                for ref in source_index.get("evidenceRefs", [])
            ],
            f"practice-analyzer:sha256:{analyzer_fingerprint()}",
            "practice-scene-match-mode:PROXY_PROGRESSIVE_SOURCE_BALANCED_GEOMETRIC_V3",
        ],
    }
    Path(output_path).write_text(json.dumps(payload, indent=2), encoding="utf-8", newline="\n")
    return payload


def resolve_ffmpeg(explicit=None):
    import os
    import shutil

    candidates = []
    if explicit:
        candidates.append(explicit)
    env_value = os.environ.get("EDITFLOW_FFMPEG_PATH")
    if env_value:
        candidates.append(env_value)
    path_value = shutil.which("ffmpeg")
    if path_value:
        candidates.append(path_value)
    for candidate in candidates:
        path = Path(candidate).expanduser()
        if path.is_file():
            return str(path.resolve())
    try:
        import imageio_ffmpeg
        bundled = Path(imageio_ffmpeg.get_ffmpeg_exe())
        if bundled.is_file():
            return str(bundled.resolve())
    except Exception:
        pass
    raise RuntimeError(
        "Practice audio matching requires FFmpeg. Configure --ffmpeg, "
        "EDITFLOW_FFMPEG_PATH, PATH, or imageio-ffmpeg."
    )


def decode_audio_f32(media_path, ffmpeg_exe, sample_rate=11025):
    import subprocess

    command = [
        ffmpeg_exe,
        "-v", "error",
        "-i", str(media_path),
        "-vn",
        "-ac", "1",
        "-ar", str(sample_rate),
        "-f", "f32le",
        "pipe:1",
    ]
    completed = subprocess.run(
        command,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        message = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError("FFmpeg audio decode failed: " + message)
    samples = np.frombuffer(completed.stdout, dtype="<f4").astype(np.float32, copy=False)
    if samples.size < sample_rate // 2:
        raise RuntimeError("Decoded audio is too short for Practice matching.")
    samples = np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)
    peak = float(np.max(np.abs(samples)))
    if peak > 1e-8:
        samples = samples / peak
    return samples


def active_audio_range(samples, sample_rate):
    block = max(64, int(round(sample_rate * 0.10)))
    count = int(math.ceil(samples.size / block))
    rms = []
    for index in range(count):
        chunk = samples[index * block:(index + 1) * block]
        if chunk.size == 0:
            continue
        rms.append(float(np.sqrt(np.mean(chunk * chunk) + 1e-12)))
    values = np.asarray(rms, dtype=np.float32)
    if values.size == 0:
        return 0, samples.size
    threshold = max(0.004, float(np.max(values)) * 0.035)
    active = np.flatnonzero(values >= threshold)
    if active.size == 0:
        return 0, samples.size
    start = max(0, int(active[0]) * block - block)
    end = min(samples.size, (int(active[-1]) + 2) * block)
    if end - start < sample_rate:
        return 0, samples.size
    return start, end


def zscore(values):
    values = np.asarray(values, dtype=np.float32)
    mean = np.mean(values, axis=0, keepdims=True)
    std = np.std(values, axis=0, keepdims=True)
    return (values - mean) / np.maximum(std, 1e-5)


def audio_feature_series(samples, sample_rate):
    frame_size = 2048
    hop = 512
    if samples.size < frame_size * 2:
        raise RuntimeError("Audio is too short for spectral matching.")
    window = np.hanning(frame_size).astype(np.float32)
    rows = []
    previous_mag = None
    boundaries = np.asarray([0, 120, 300, 700, 1500, 3000, sample_rate / 2], dtype=np.float32)
    frequencies = np.fft.rfftfreq(frame_size, d=1.0 / sample_rate)
    for start in range(0, samples.size - frame_size + 1, hop):
        frame = samples[start:start + frame_size] * window
        magnitude = np.abs(np.fft.rfft(frame)).astype(np.float32)
        total = float(np.sum(magnitude)) + 1e-8
        bands = []
        for low, high in zip(boundaries[:-1], boundaries[1:]):
            mask = (frequencies >= low) & (frequencies < high)
            bands.append(float(np.sum(magnitude[mask])) / total)
        energy = math.log1p(float(np.sqrt(np.mean(frame * frame) + 1e-12)) * 30.0)
        if previous_mag is None:
            flux = 0.0
        else:
            delta = magnitude - previous_mag
            flux = float(np.sum(np.maximum(delta, 0.0))) / total
        previous_mag = magnitude
        rows.append([energy, flux, *bands])
    matrix = np.asarray(rows, dtype=np.float32)
    if matrix.shape[0] < 8:
        raise RuntimeError("Audio produced too few analysis frames.")
    energy_delta = np.diff(matrix[:, 0], prepend=matrix[0, 0])
    flux = matrix[:, 1]
    band_delta = np.linalg.norm(
        np.diff(matrix[:, 2:], axis=0, prepend=matrix[0:1, 2:]),
        axis=1,
    )
    features = np.column_stack((energy_delta, flux, band_delta))
    return zscore(features), hop


def resample_feature_series(features, target_length):
    if target_length < 4:
        raise ValueError("Audio template length is too small.")
    if target_length == features.shape[0]:
        return features
    source_axis = np.linspace(0.0, 1.0, features.shape[0], dtype=np.float32)
    target_axis = np.linspace(0.0, 1.0, target_length, dtype=np.float32)
    columns = [
        np.interp(target_axis, source_axis, features[:, index])
        for index in range(features.shape[1])
    ]
    return zscore(np.column_stack(columns).astype(np.float32))


def normalized_valid_correlation(source, template):
    if source.shape[0] < template.shape[0]:
        return np.zeros(0, dtype=np.float32)
    channel_scores = []
    length = template.shape[0]
    ones = np.ones(length, dtype=np.float32)
    for channel in range(template.shape[1]):
        source_values = source[:, channel].astype(np.float32)
        template_values = template[:, channel].astype(np.float32)
        template_values = template_values - float(np.mean(template_values))
        template_norm = float(np.linalg.norm(template_values))
        if template_norm <= 1e-8:
            continue
        numerator = np.correlate(source_values, template_values, mode="valid")
        sums = np.convolve(source_values, ones, mode="valid")
        sums_sq = np.convolve(source_values * source_values, ones, mode="valid")
        variance_sum = np.maximum(1e-8, sums_sq - ((sums * sums) / float(length)))
        denominator = np.sqrt(variance_sum) * template_norm
        channel_scores.append(np.clip(numerator / denominator, -1.0, 1.0))
    if not channel_scores:
        return np.zeros(source.shape[0] - length + 1, dtype=np.float32)
    return np.mean(np.vstack(channel_scores), axis=0).astype(np.float32)


AUDIO_RATE_GRID = (0.50, 0.667, 0.75, 0.80, 0.90, 1.0, 1.10, 1.20, 1.25, 1.50, 2.0)


def audio_candidate(reference_features, source_features, rate):
    target_length = max(4, int(round(reference_features.shape[0] * float(rate))))
    if target_length > source_features.shape[0]:
        return None
    template = resample_feature_series(reference_features, target_length)
    scores = normalized_valid_correlation(source_features, template)
    if scores.size == 0:
        return None
    best_index = int(np.argmax(scores))
    best_corr = float(scores[best_index])
    exclusion = max(2, target_length // 6)
    masked = scores.copy()
    left = max(0, best_index - exclusion)
    right = min(masked.size, best_index + exclusion + 1)
    masked[left:right] = -1.0
    second_corr = float(np.max(masked)) if masked.size > right - left else -1.0
    similarity = clamp01((best_corr + 1.0) * 0.5)
    uniqueness = clamp01((best_corr - second_corr) / 0.20)
    confidence = clamp01((0.88 * similarity) + (0.12 * uniqueness))
    return {
        "rate": float(rate),
        "startFrame": best_index,
        "templateFrames": target_length,
        "correlation": best_corr,
        "similarity": similarity,
        "confidence": confidence,
        "uniqueness": uniqueness,
    }


def parse_audio_source(value):
    parts = value.split("|||", 1)
    if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
        raise ValueError("--source-audio must use sourceId|||path format.")
    return parts[0].strip(), parts[1].strip()


def match_reference_audio(reference_media, reference_id, source_values, output_path, explicit_ffmpeg=None):
    sample_rate = 11025
    ffmpeg_exe = resolve_ffmpeg(explicit_ffmpeg)
    reference_samples = decode_audio_f32(reference_media, ffmpeg_exe, sample_rate)
    active_start, active_end = active_audio_range(reference_samples, sample_rate)
    active_reference = reference_samples[active_start:active_end]
    reference_features, hop = audio_feature_series(active_reference, sample_rate)

    candidates = []
    for source_value in source_values:
        source_id, source_path = parse_audio_source(source_value)
        samples = decode_audio_f32(source_path, ffmpeg_exe, sample_rate)
        source_features, source_hop = audio_feature_series(samples, sample_rate)
        if source_hop != hop:
            raise RuntimeError("Practice audio feature hop mismatch.")
        for rate in AUDIO_RATE_GRID:
            candidate = audio_candidate(reference_features, source_features, rate)
            if candidate is None:
                continue
            candidate.update({
                "sourceId": source_id,
                "sourcePath": str(Path(source_path).resolve()),
                "sourceSha256": sha256_file(source_path),
            })
            candidates.append(candidate)

    candidates.sort(key=lambda item: (item["confidence"], item["similarity"]), reverse=True)
    best = candidates[0] if candidates else None
    if best is None:
        payload = {
            "schema": "editflow.practice-audio-match.v1",
            "referenceId": reference_id,
            "match": None,
            "evidenceRefs": [
                f"practice-audio-analyzer:sha256:{analyzer_fingerprint()}",
            ],
        }
    else:
        source_start_ms = (best["startFrame"] * hop * 1000.0) / sample_rate
        reference_start_ms = active_start * 1000.0 / sample_rate
        reference_end_ms = active_end * 1000.0 / sample_rate
        reference_duration_ms = reference_end_ms - reference_start_ms
        source_end_ms = source_start_ms + (reference_duration_ms * best["rate"])
        match_material = (
            reference_id
            + "|" + best["sourceId"]
            + "|" + f"{source_start_ms:.3f}"
            + "|" + f"{source_end_ms:.3f}"
            + "|" + f"{best['rate']:.6f}"
        )
        match_id = "practice-audio-match:" + hashlib.sha256(
            match_material.encode("utf-8")
        ).hexdigest()[:20]
        segment_id = match_id + ":segment:001"
        evidence = [
            f"practice-audio-analyzer:sha256:{analyzer_fingerprint()}",
            f"source-audio:sha256:{best['sourceSha256']}",
            f"audio-correlation:{best['correlation']:.6f}",
            f"audio-uniqueness:{best['uniqueness']:.6f}",
            f"audio-playback-rate:{best['rate']:.6f}",
        ]
        payload = {
            "schema": "editflow.practice-audio-match.v1",
            "referenceId": reference_id,
            "analysis": {
                "algorithmId": "editflow.practice-audio-match.v1",
                "analyzerFingerprint": analyzer_fingerprint(),
                "sampleRate": sample_rate,
                "ffmpegExecutable": Path(ffmpeg_exe).name,
            },
            "match": {
                "matchId": match_id,
                "sourceId": best["sourceId"],
                "sourcePath": best["sourcePath"],
                "segments": [{
                    "segmentId": segment_id,
                    "referenceStartMs": float(reference_start_ms),
                    "referenceEndMs": float(reference_end_ms),
                    "sourceStartMs": float(source_start_ms),
                    "sourceEndMs": float(source_end_ms),
                    "playbackRate": float(best["rate"]),
                    "correlation": float(best["correlation"]),
                    "confidence": float(best["confidence"]),
                    "evidenceRefs": evidence,
                }],
                "overallConfidence": float(best["confidence"]),
                "evidenceRefs": evidence,
            },
            "evidenceRefs": evidence,
        }
    Path(output_path).write_text(json.dumps(payload, indent=2), encoding="utf-8", newline="\n")
    return payload


def _mean(values, fallback=0.0):
    finite = [float(value) for value in values if math.isfinite(float(value))]
    return float(sum(finite) / len(finite)) if finite else float(fallback)


def _frame_pair_similarity(reference_frame, render_frame):
    if reference_frame is None or render_frame is None:
        return None
    height, width = reference_frame.shape[:2]
    render_frame = cv2.resize(render_frame, (width, height), interpolation=cv2.INTER_AREA)
    scene_identity = feature_similarity(reference_frame, render_frame)

    ref_descriptor = frame_descriptor(reference_frame)
    render_descriptor = frame_descriptor(render_frame)
    global_similarity = descriptor_similarity(ref_descriptor, render_descriptor)

    ref_gray = cv2.cvtColor(reference_frame, cv2.COLOR_BGR2GRAY)
    render_gray = cv2.cvtColor(render_frame, cv2.COLOR_BGR2GRAY)
    ref_gray = cv2.resize(ref_gray, (128, 72), interpolation=cv2.INTER_AREA)
    render_gray = cv2.resize(render_gray, (128, 72), interpolation=cv2.INTER_AREA)
    pixel_similarity = clamp01(1.0 - float(np.mean(cv2.absdiff(ref_gray, render_gray))) / 255.0)

    ref_edges = cv2.Canny(ref_gray, 60, 150)
    render_edges = cv2.Canny(render_gray, 60, 150)
    edge_similarity = clamp01(
        1.0 - float(np.mean(cv2.absdiff(ref_edges, render_edges))) / 255.0
    )

    ref_hsv = cv2.cvtColor(
        cv2.resize(reference_frame, (96, 54), interpolation=cv2.INTER_AREA),
        cv2.COLOR_BGR2HSV,
    )
    render_hsv = cv2.cvtColor(
        cv2.resize(render_frame, (96, 54), interpolation=cv2.INTER_AREA),
        cv2.COLOR_BGR2HSV,
    )
    ref_hist = cv2.calcHist([ref_hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])
    render_hist = cv2.calcHist([render_hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])
    cv2.normalize(ref_hist, ref_hist, alpha=1, norm_type=cv2.NORM_L1)
    cv2.normalize(render_hist, render_hist, alpha=1, norm_type=cv2.NORM_L1)
    color_similarity = clamp01(float(np.minimum(ref_hist, render_hist).sum()))

    return {
        "sceneIdentity": scene_identity,
        "framing": clamp01((0.60 * scene_identity) + (0.25 * global_similarity) + (0.15 * edge_similarity)),
        "colorFinish": color_similarity,
        "pixelStructure": clamp01((0.55 * pixel_similarity) + (0.45 * edge_similarity)),
    }


def _flow_signature(first_frame, second_frame):
    if first_frame is None or second_frame is None:
        return None
    first = cv2.cvtColor(
        cv2.resize(first_frame, (128, 72), interpolation=cv2.INTER_AREA),
        cv2.COLOR_BGR2GRAY,
    )
    second = cv2.cvtColor(
        cv2.resize(second_frame, (128, 72), interpolation=cv2.INTER_AREA),
        cv2.COLOR_BGR2GRAY,
    )
    flow = cv2.calcOpticalFlowFarneback(
        first, second, None, 0.5, 3, 15, 3, 5, 1.2, 0,
    )
    x = float(np.median(flow[..., 0]))
    y = float(np.median(flow[..., 1]))
    magnitude = float(np.median(np.sqrt(np.square(flow[..., 0]) + np.square(flow[..., 1]))))
    return x, y, magnitude


def _flow_similarity(reference_flow, render_flow):
    if reference_flow is None or render_flow is None:
        return 0.0
    rx, ry, rm = reference_flow
    ax, ay, am = render_flow
    magnitude_scale = max(0.25, rm, am)
    magnitude_similarity = clamp01(1.0 - abs(rm - am) / magnitude_scale)
    rnorm = math.hypot(rx, ry)
    anorm = math.hypot(ax, ay)
    if rnorm <= 1e-5 and anorm <= 1e-5:
        direction_similarity = 1.0
    elif rnorm <= 1e-5 or anorm <= 1e-5:
        direction_similarity = 0.5
    else:
        cosine = ((rx * ax) + (ry * ay)) / (rnorm * anorm)
        direction_similarity = clamp01((cosine + 1.0) * 0.5)
    return clamp01((0.65 * magnitude_similarity) + (0.35 * direction_similarity))


def _detect_cut_times(video_path, cut_threshold, minimum_gap_ms):
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video for cut comparison: {video_path}")
    fps, _count, _width, _height, duration_ms = video_metadata(capture)
    scores = []
    previous = None
    frame_index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        analysis_frame = resize_longest(frame, 192)
        if previous is not None:
            score = cut_score(previous, analysis_frame)
            scores.append({
                "frame": frame_index,
                "timeMs": frame_index * 1000.0 / fps,
                "score": score,
            })
        previous = analysis_frame
        frame_index += 1
    capture.release()
    candidates = []
    for index, item in enumerate(scores):
        if item["score"] < cut_threshold:
            continue
        lo = max(0, index - 2)
        hi = min(len(scores), index + 3)
        if item["score"] >= max(entry["score"] for entry in scores[lo:hi]):
            candidates.append(item)
    cuts = merge_cut_candidates(candidates, minimum_gap_ms)
    return [float(item["timeMs"]) for item in cuts], float(duration_ms), float(fps)


def _expected_source_time_for_match(shot, match, reference_time_ms):
    trajectory = sorted(
        match.get("trajectory") or [],
        key=lambda item: float(item["referenceTimeMs"]),
    )
    if len(trajectory) >= 2:
        if reference_time_ms <= float(trajectory[0]["referenceTimeMs"]):
            left, right = trajectory[0], trajectory[1]
        elif reference_time_ms >= float(trajectory[-1]["referenceTimeMs"]):
            left, right = trajectory[-2], trajectory[-1]
        else:
            left, right = trajectory[0], trajectory[1]
            for index in range(1, len(trajectory)):
                candidate = trajectory[index]
                if reference_time_ms <= float(candidate["referenceTimeMs"]):
                    left, right = trajectory[index - 1], candidate
                    break
        ref_delta = float(right["referenceTimeMs"]) - float(left["referenceTimeMs"])
        if abs(ref_delta) <= 1e-6:
            return float(left["sourceTimeMs"])
        phase = (reference_time_ms - float(left["referenceTimeMs"])) / ref_delta
        return float(left["sourceTimeMs"]) + phase * (
            float(right["sourceTimeMs"]) - float(left["sourceTimeMs"])
        )

    reference_start = float(shot["referenceStartMs"])
    rate = float(match.get("playbackRate", 1.0))
    if match.get("direction") == "REVERSE":
        return float(match["sourceEndMs"]) - rate * (reference_time_ms - reference_start)
    return float(match["sourceStartMs"]) + rate * (reference_time_ms - reference_start)


def _measure_render_source_trajectory(shot, match, render_reader, source_reader):
    trajectory = match.get("trajectory") or []
    sample_times = [
        float(item["referenceTimeMs"])
        for item in trajectory
        if float(shot["referenceStartMs"]) <= float(item["referenceTimeMs"])
        <= float(shot["referenceEndMs"])
    ]
    if len(sample_times) < 3:
        sample_times = interior_anchor_times(
            float(shot["referenceStartMs"]),
            float(shot["referenceEndMs"]),
        )
    sample_times = sorted(set(round(value, 3) for value in sample_times))
    duration = float(shot["referenceEndMs"]) - float(shot["referenceStartMs"])
    radius = min(320.0, max(120.0, duration * 0.18))
    observed = []
    for reference_time in sample_times:
        render_frame = render_reader.read_ms(reference_time)
        if render_frame is None:
            continue
        expected_source = _expected_source_time_for_match(shot, match, reference_time)
        best = None
        for delta in np.arange(-radius, radius + 1.0, 40.0):
            source_time = expected_source + float(delta)
            if source_time < 0 or source_time >= source_reader.duration_ms:
                continue
            source_frame = source_reader.read_ms(source_time)
            if source_frame is None:
                continue
            similarity = feature_similarity(render_frame, source_frame)
            if best is None or similarity > best["similarity"]:
                best = {
                    "referenceTimeMs": float(reference_time),
                    "sourceTimeMs": float(source_time),
                    "similarity": float(similarity),
                }
        if best is not None:
            observed.append(best)
    result = classify_source_time_trajectory(observed)
    expected_behavior = match.get("temporalBehavior") or (
        "REVERSE" if match.get("direction") == "REVERSE" else "FORWARD"
    )
    observed_behavior = result["behavior"]
    score = 1.0 if observed_behavior == expected_behavior else 0.0
    reasons = []
    expected_rewind = match.get("rewind")
    observed_rewind = result.get("rewind")
    if expected_behavior == "FORWARD_THEN_REWIND":
        if observed_rewind is None:
            score = 0.0
            reasons.append("Measured source-time rewind was not reproduced.")
        else:
            expected_span = max(1.0, float(expected_rewind["rewindSpanMs"]))
            observed_span = float(observed_rewind["rewindSpanMs"])
            span_score = math.exp(-abs(observed_span - expected_span) / expected_span)
            timing_error = (
                abs(float(observed_rewind["referenceStartMs"]) - float(expected_rewind["referenceStartMs"]))
                + abs(float(observed_rewind["referenceEndMs"]) - float(expected_rewind["referenceEndMs"]))
            ) / 2.0
            timing_score = math.exp(-timing_error / max(90.0, duration * 0.12))
            score = clamp01((0.55 * span_score) + (0.45 * timing_score))
            if observed_behavior != "FORWARD_THEN_REWIND":
                score *= 0.4
            if score < 0.78:
                reasons.append("Measured rewind span/timing diverges from the Finish source-time trajectory.")
    elif expected_behavior in ("FORWARD", "REVERSE") and observed_behavior == "COMPLEX":
        score = 0.45
    return {
        "shotId": shot["shotId"],
        "sourceId": match["sourceId"],
        "expectedBehavior": expected_behavior,
        "observedBehavior": observed_behavior,
        "score": clamp01(score),
        "expectedRewind": expected_rewind,
        "observedRewind": observed_rewind,
        "sampleCount": len(observed),
        "meanSourceSimilarity": _mean([item["similarity"] for item in observed], 0.0),
        "reasons": reasons,
    }


def compare_render_to_reference(
    reference_json,
    reference_video,
    render_video,
    output_path,
    cut_threshold=0.42,
    matches_json=None,
):
    reference = load_artifact(reference_json, "editflow.practice-reference-analysis.v1")
    expected_matches = []
    if matches_json is not None:
        matches_payload = json.loads(Path(matches_json).read_text(encoding="utf-8"))
        if matches_payload.get("schema") != "editflow.practice-expected-scene-matches.v1":
            raise ValueError("Expected-scene match artifact has an unsupported schema.")
        expected_matches = matches_payload.get("matches") or []
    reference_video = Path(reference_video).resolve()
    render_video = Path(render_video).resolve()
    if not reference_video.is_file() or not render_video.is_file():
        raise ValueError("Reference/render comparison requires existing video files.")

    reference_reader = FrameReader(reference_video)
    render_reader = FrameReader(render_video)
    per_shot = []
    motion_scores = []
    try:
        for shot in reference["shots"]:
            sample_times = interior_anchor_times(
                float(shot["referenceStartMs"]),
                float(shot["referenceEndMs"]),
            )
            samples = []
            prior_time = None
            prior_reference = None
            prior_render = None
            for time_ms in sample_times:
                ref_frame = reference_reader.read_ms(time_ms)
                render_frame = render_reader.read_ms(time_ms)
                similarity = _frame_pair_similarity(ref_frame, render_frame)
                if similarity is not None:
                    samples.append(similarity)
                if prior_time is not None:
                    motion_scores.append(_flow_similarity(
                        _flow_signature(prior_reference, ref_frame),
                        _flow_signature(prior_render, render_frame),
                    ))
                prior_time = time_ms
                prior_reference = ref_frame
                prior_render = render_frame
            per_shot.append({
                "shotId": shot["shotId"],
                "sceneIdentity": _mean([item["sceneIdentity"] for item in samples]),
                "framing": _mean([item["framing"] for item in samples]),
                "colorFinish": _mean([item["colorFinish"] for item in samples]),
                "pixelStructure": _mean([item["pixelStructure"] for item in samples]),
                "sampleCount": len(samples),
            })
    finally:
        reference_reader.close()
        render_reader.close()

    temporal_diagnostics = []
    if expected_matches:
        matches_by_shot = {item["shotId"]: item for item in expected_matches}
        temporal_render_reader = FrameReader(render_video)
        source_readers = {}
        try:
            for shot in reference["shots"]:
                match = matches_by_shot.get(shot["shotId"])
                if match is None or not match.get("sourcePath"):
                    continue
                source_path = str(Path(match["sourcePath"]).resolve())
                if source_path not in source_readers:
                    if not Path(source_path).is_file():
                        continue
                    source_readers[source_path] = FrameReader(source_path)
                temporal_diagnostics.append(_measure_render_source_trajectory(
                    shot,
                    match,
                    temporal_render_reader,
                    source_readers[source_path],
                ))
        finally:
            temporal_render_reader.close()
            for reader in source_readers.values():
                reader.close()

    source_temporal_alignment = _mean(
        [item["score"] for item in temporal_diagnostics],
        1.0,
    )
    required_rewind_shot_ids = [
        item["shotId"]
        for item in expected_matches
        if item.get("temporalBehavior") == "FORWARD_THEN_REWIND"
        or item.get("rewind", {}).get("detected") is True
    ]
    verified_rewind_shot_ids = [
        item["shotId"]
        for item in temporal_diagnostics
        if item["shotId"] in required_rewind_shot_ids
        and item["observedBehavior"] == "FORWARD_THEN_REWIND"
        and item["score"] >= 0.78
    ]
    temporal_behavior_reasons = [
        f"{item['shotId']}: {reason}"
        for item in temporal_diagnostics
        for reason in item["reasons"]
        if item["shotId"] in required_rewind_shot_ids
    ]
    missing_rewind_shots = sorted(
        set(required_rewind_shot_ids) - set(verified_rewind_shot_ids)
    )
    for shot_id in missing_rewind_shots:
        message = f"{shot_id}: required Finish rewind is not machine-verified in the final render."
        if message not in temporal_behavior_reasons:
            temporal_behavior_reasons.append(message)
    temporal_behavior_passed = len(missing_rewind_shots) == 0

    expected_cuts = [
        float(shot["referenceStartMs"])
        for shot in reference["shots"][1:]
    ]
    minimum_gap_ms = max(120.0, float(reference["analysis"]["minimumShotMs"]) * 0.65)
    render_cuts, render_duration_ms, render_fps = _detect_cut_times(
        render_video,
        cut_threshold,
        minimum_gap_ms,
    )
    tolerance_ms = max(42.0, 2.0 * 1000.0 / max(render_fps, 1.0))
    errors = []
    matched_render_indexes = set()
    for expected in expected_cuts:
        if not render_cuts:
            errors.append(tolerance_ms * 4.0)
            continue
        index, observed = min(
            enumerate(render_cuts),
            key=lambda entry: abs(entry[1] - expected),
        )
        matched_render_indexes.add(index)
        errors.append(abs(observed - expected))
    mean_cut_error = _mean(errors, tolerance_ms * 4.0)
    cut_timing = math.exp(-mean_cut_error / max(tolerance_ms, 1.0))
    cut_count_penalty = abs(len(render_cuts) - len(expected_cuts)) / max(1, len(expected_cuts))
    cut_timing = clamp01(cut_timing * (1.0 - min(0.75, 0.35 * cut_count_penalty)))

    reference_duration_ms = float(reference["video"]["durationMs"])
    duration_error_ratio = abs(render_duration_ms - reference_duration_ms) / max(reference_duration_ms, 1.0)
    duration_alignment = math.exp(-duration_error_ratio / 0.01)
    temporal_alignment = clamp01(
        (0.35 * duration_alignment)
        + (0.30 * cut_timing)
        + (0.35 * source_temporal_alignment)
    ) if temporal_diagnostics else clamp01(
        (0.55 * duration_alignment) + (0.45 * cut_timing)
    )

    shot_scene_scores = [item["sceneIdentity"] for item in per_shot]
    wrong_scene_count = sum(1 for score in shot_scene_scores if score < 0.55)
    unmatched_scene_count = sum(
        1 for item in per_shot if item["sampleCount"] == 0 or item["sceneIdentity"] < 0.35
    )
    evidence = [
        f"practice-render-compare:sha256:{analyzer_fingerprint()}",
        f"reference-video:sha256:{sha256_file(reference_video)}",
        f"render-video:sha256:{sha256_file(render_video)}",
        f"practice-source-temporal-alignment:{source_temporal_alignment:.6f}",
        f"practice-required-rewind-shots:{len(required_rewind_shot_ids)}",
        f"practice-verified-rewind-shots:{len(verified_rewind_shot_ids)}",
    ]
    payload = {
        "schema": "editflow.practice-content-structure-evaluation.v1",
        "referenceId": reference["referenceId"],
        "renderPath": str(render_video),
        "breakdown": {
            "sceneIdentity": _mean([item["sceneIdentity"] for item in per_shot]),
            "temporalAlignment": temporal_alignment,
            "cutTiming": cut_timing,
            "framing": _mean([item["framing"] for item in per_shot]),
            "motion": _mean(motion_scores, 1.0),
            "colorFinish": _mean([item["colorFinish"] for item in per_shot]),
            "pixelStructure": _mean([item["pixelStructure"] for item in per_shot]),
        },
        "wrongSceneCount": wrong_scene_count,
        "unmatchedSceneCount": unmatched_scene_count,
        "temporalBehaviorProof": {
            "sourceTemporalAlignment": source_temporal_alignment,
            "requiredRewindShotIds": required_rewind_shot_ids,
            "verifiedRewindShotIds": verified_rewind_shot_ids,
            "passed": temporal_behavior_passed,
            "reasons": temporal_behavior_reasons,
            "diagnostics": temporal_diagnostics,
        },
        "cutDiagnostics": {
            "expectedCutsMs": expected_cuts,
            "renderCutsMs": render_cuts,
            "meanAbsoluteErrorMs": mean_cut_error,
            "toleranceMs": tolerance_ms,
            "matchedRenderCutCount": len(matched_render_indexes),
        },
        "shots": per_shot,
        "analysis": {
            "algorithmId": "editflow.practice-render-compare.v1",
            "analyzerFingerprint": analyzer_fingerprint(),
        },
        "evidenceRefs": evidence,
    }
    Path(output_path).write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
        newline="\n",
    )
    return payload


def build_parser():
    parser = argparse.ArgumentParser(
        description="EditFlow Practice reference decomposition, source indexing, scene matching, and audio matching."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    reference = subparsers.add_parser("reference")
    reference.add_argument("--video", required=True)
    reference.add_argument("--reference-id", required=True)
    reference.add_argument("--output", required=True)
    reference.add_argument("--cut-threshold", type=float, default=0.42)
    reference.add_argument("--minimum-shot-ms", type=float, default=180.0)

    source = subparsers.add_parser("index")
    source.add_argument("--video", required=True)
    source.add_argument("--source-id", required=True)
    source.add_argument("--output", required=True)
    source.add_argument("--sample-step-ms", type=float, default=250.0)
    source.add_argument("--analysis-fps", type=float, default=DEFAULT_ANALYSIS_PROXY_FPS)
    source.add_argument("--proxy-dir")
    source.add_argument("--ffmpeg")

    match = subparsers.add_parser("match")
    match.add_argument("--reference-json", required=True)
    match.add_argument("--source-index-json", action="append", required=True)
    match.add_argument("--output", required=True)
    match.add_argument("--coarse-limit", type=int, default=16)

    audio = subparsers.add_parser("audio-match")
    audio.add_argument("--reference-media", required=True)
    audio.add_argument("--reference-id", required=True)
    audio.add_argument("--source-audio", action="append", required=True)
    audio.add_argument("--output", required=True)
    audio.add_argument("--ffmpeg")

    compare = subparsers.add_parser("compare-render")
    compare.add_argument("--reference-json", required=True)
    compare.add_argument("--reference-video", required=True)
    compare.add_argument("--render-video", required=True)
    compare.add_argument("--matches-json")
    compare.add_argument("--output", required=True)
    compare.add_argument("--cut-threshold", type=float, default=0.42)
    return parser


def main():
    args = build_parser().parse_args()
    if args.command == "reference":
        if not (0.1 <= args.cut_threshold <= 0.95):
            raise ValueError("--cut-threshold must be in [0.1, 0.95].")
        if args.minimum_shot_ms < 80:
            raise ValueError("--minimum-shot-ms must be at least 80.")
        payload = analyze_reference(
            args.video,
            args.reference_id,
            args.output,
            args.cut_threshold,
            args.minimum_shot_ms,
        )
        print(json.dumps({
            "ok": True,
            "command": "reference",
            "output": str(Path(args.output).resolve()),
            "shotCount": len(payload["shots"]),
            "styleFingerprint": payload["styleFingerprint"],
        }))
    elif args.command == "index":
        if args.sample_step_ms < 100 or args.sample_step_ms > 5000:
            raise ValueError("--sample-step-ms must be in [100, 5000].")
        if args.analysis_fps < 4 or args.analysis_fps > 30:
            raise ValueError("--analysis-fps must be in [4, 30].")
        payload = index_source(
            args.video,
            args.source_id,
            args.output,
            args.sample_step_ms,
            explicit_ffmpeg=args.ffmpeg,
            proxy_dir=args.proxy_dir,
            analysis_fps=args.analysis_fps,
        )
        print(json.dumps({
            "ok": True,
            "command": "index",
            "output": str(Path(args.output).resolve()),
            "sampleCount": len(payload["samples"]),
            "sourceSha256": payload["sourceSha256"],
            "analysisProxyPath": payload["analysisProxyPath"],
        }))
    elif args.command == "match":
        if args.coarse_limit < 2 or args.coarse_limit > 64:
            raise ValueError("--coarse-limit must be in [2, 64].")
        payload = match_reference(
            args.reference_json,
            args.source_index_json,
            args.output,
            args.coarse_limit,
        )
        print(json.dumps({
            "ok": True,
            "command": "match",
            "output": str(Path(args.output).resolve()),
            "matchCount": len(payload["matches"]),
        }))
    elif args.command == "audio-match":
        payload = match_reference_audio(
            args.reference_media,
            args.reference_id,
            args.source_audio,
            args.output,
            args.ffmpeg,
        )
        print(json.dumps({
            "ok": True,
            "command": "audio-match",
            "output": str(Path(args.output).resolve()),
            "matched": payload["match"] is not None,
            "confidence": (
                None if payload["match"] is None
                else payload["match"]["overallConfidence"]
            ),
        }))
    else:
        if not (0.1 <= args.cut_threshold <= 0.95):
            raise ValueError("--cut-threshold must be in [0.1, 0.95].")
        payload = compare_render_to_reference(
            args.reference_json,
            args.reference_video,
            args.render_video,
            args.output,
            args.cut_threshold,
            args.matches_json,
        )
        print(json.dumps({
            "ok": True,
            "command": "compare-render",
            "output": str(Path(args.output).resolve()),
            "sceneIdentity": payload["breakdown"]["sceneIdentity"],
            "cutTiming": payload["breakdown"]["cutTiming"],
            "wrongSceneCount": payload["wrongSceneCount"],
        }))


if __name__ == "__main__":
    main()
