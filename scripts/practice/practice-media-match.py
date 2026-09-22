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


_SIFT = cv2.SIFT_create(nfeatures=600)
_FRAME_DESCRIPTOR_CACHE = {}
_FRAME_FEATURE_CACHE = {}


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


def feature_similarity(reference_frame, source_frame):
    ref_global, ref_keypoints, ref_desc = cached_features(reference_frame)
    src_global, src_keypoints, src_desc = cached_features(source_frame)
    global_score = descriptor_similarity(ref_global, src_global)
    if ref_desc is None or src_desc is None or len(ref_desc) < 4 or len(src_desc) < 4:
        return clamp01(global_score * 0.88)

    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(ref_desc, src_desc, k=2)
    good = [m for m, n in pairs if m.distance < 0.75 * n.distance]
    if len(good) < 4:
        return clamp01(global_score * 0.90)

    source_points = np.float32([ref_keypoints[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    target_points = np.float32([src_keypoints[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    _matrix, mask = cv2.findHomography(source_points, target_points, cv2.RANSAC, 4.0)
    inlier_ratio = float(np.mean(mask.reshape(-1) > 0)) if mask is not None else 0.0
    match_strength = clamp01(len(good) / 30.0)
    feature_score = clamp01((0.58 * inlier_ratio) + (0.42 * match_strength))
    return clamp01((0.42 * global_score) + (0.58 * feature_score))


def interior_anchor_times(start_ms, end_ms):
    duration = end_ms - start_ms
    if duration <= 0:
        return []
    if duration < 900:
        phases = [0.25, 0.50, 0.75]
    else:
        phases = [0.18, 0.38, 0.62, 0.82]
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
            for time_ms in interior_anchor_times(start_ms, end_ms):
                frame = reader.read_ms(time_ms)
                if frame is None:
                    continue
                anchors.append({
                    "timeMs": float(time_ms),
                    "descriptor": frame_descriptor(frame),
                })
            if not anchors:
                continue
            shots.append({
                "shotId": f"shot:{index + 1:04d}",
                "order": index,
                "referenceStartMs": float(start_ms),
                "referenceEndMs": float(end_ms),
                "anchors": anchors,
                "evidenceRefs": [
                    f"reference-video:sha256:{sha256_file(video_path)}",
                    f"reference-range-ms:{round(start_ms)}-{round(end_ms)}",
                ],
            })
    finally:
        reader.close()

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
            "durationMs": duration_ms,
        },
        "analysis": {
            "algorithmId": ALGORITHM_ID,
            "analyzerFingerprint": analyzer_fingerprint(),
            "cutThreshold": cut_threshold,
            "minimumShotMs": minimum_shot_ms,
        },
        "styleFingerprint": style_fingerprint,
        "shots": shots,
        "evidenceRefs": [
            f"video:sha256:{sha256_file(video_path)}",
            f"practice-analyzer:sha256:{analyzer_fingerprint()}",
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
    payload = {
        "schema": "editflow.practice-source-index.v1",
        "sourceId": source_id,
        "sourcePath": str(video_path),
        "sourceSha256": source_sha,
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


def coarse_candidates_for_shot(shot, source_indexes, limit=16):
    anchors = shot["anchors"]
    anchor = anchors[len(anchors) // 2]
    candidates = []
    for source_index in source_indexes:
        for sample in source_index["samples"]:
            score = descriptor_similarity(anchor["descriptor"], sample["descriptor"])
            candidates.append({
                "score": score,
                "sample": sample,
                "index": source_index,
            })
    return dedupe_coarse_candidates(candidates, limit)


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
        return best_mapping

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
    }
    if fitted_score >= best_mapping["score"] - 0.015:
        return fitted
    return best_mapping


def confidence_from_result(best, second_score):
    appearance = float(best["mapping"]["appearance"])
    base = 1.0 / (1.0 + math.exp(-14.0 * (appearance - 0.60)))
    margin = max(0.0, float(best["mapping"]["score"]) - float(second_score))
    uniqueness = clamp01(margin / 0.12)
    consistency = float(best["mapping"]["consistency"])
    return clamp01((0.90 * base) + (0.05 * uniqueness) + (0.05 * consistency))


def distinct_second_score(results, best):
    for item in results[1:]:
        if item["index"]["sourceId"] != best["index"]["sourceId"]:
            return item["mapping"]["score"]
        delta = abs(item["mapping"]["centerSourceMs"] - best["mapping"]["centerSourceMs"])
        step = float(best["index"]["analysis"]["sampleStepMs"])
        if delta >= max(800.0, step * 1.5):
            return item["mapping"]["score"]
    return 0.0


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
        for shot in reference["shots"]:
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

            detailed_seeds = list(refined[:min(6, len(refined))])
            represented_sources = {item["index"]["sourceId"] for item in detailed_seeds}
            for item in refined[len(detailed_seeds):]:
                source_id = item["index"]["sourceId"]
                if source_id in represented_sources:
                    continue
                detailed_seeds.append(item)
                represented_sources.add(source_id)
                if len(detailed_seeds) >= min(8, len(refined)):
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
            detailed.sort(key=lambda item: item["mapping"]["score"], reverse=True)
            if not detailed:
                continue

            refined = detailed
            best = refined[0]
            second_score = distinct_second_score(refined, best)
            mapping = best["mapping"]
            center_reference = shot["anchors"][len(shot["anchors"]) // 2]["timeMs"]
            mapped_start = mapping["centerSourceMs"] + mapping["slope"] * (
                shot["referenceStartMs"] - center_reference
            )
            mapped_end = mapping["centerSourceMs"] + mapping["slope"] * (
                shot["referenceEndMs"] - center_reference
            )
            source_duration = float(best["index"]["video"]["durationMs"])
            source_start = min(mapped_start, mapped_end)
            source_end = max(mapped_start, mapped_end)
            source_start = max(0.0, source_start)
            source_end = min(source_duration, source_end)
            confidence = confidence_from_result(best, second_score)
            matches.append({
                "shotId": shot["shotId"],
                "sourceId": best["index"]["sourceId"],
                "sourcePath": best["index"]["sourcePath"],
                "sourceStartMs": float(source_start),
                "sourceEndMs": float(source_end),
                "direction": "FORWARD" if mapping["slope"] >= 0 else "REVERSE",
                "playbackRate": float(abs(mapping["slope"])),
                "appearanceSimilarity": float(mapping["appearance"]),
                "temporalSimilarity": float(mapping["consistency"]),
                "motionSimilarity": float(mapping["minimum"]),
                "confidence": confidence,
                "evidenceRefs": [
                    f"reference-shot:{shot['shotId']}",
                    f"source-video:sha256:{best['index']['sourceSha256']}",
                    f"practice-analyzer:sha256:{analyzer_fingerprint()}",
                    f"coarse-score:{best['coarseScore']:.6f}",
                    f"refined-score:{mapping['score']:.6f}",
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
            "refinementMode": "PROXY_PROGRESSIVE_V1",
            "detailedCandidateLimit": min(8, coarse_limit),
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
            "practice-scene-match-mode:PROXY_PROGRESSIVE_V1",
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


def compare_render_to_reference(
    reference_json,
    reference_video,
    render_video,
    output_path,
    cut_threshold=0.42,
):
    reference = load_artifact(reference_json, "editflow.practice-reference-analysis.v1")
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
    temporal_alignment = clamp01(
        (0.55 * math.exp(-duration_error_ratio / 0.01))
        + (0.45 * cut_timing)
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
    source.add_argument("--sample-step-ms", type=float, default=750.0)
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
