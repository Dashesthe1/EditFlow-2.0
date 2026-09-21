#!/usr/bin/env python3
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np

ALGORITHM_ID = "editflow.practice-media-match.v1"
DEFAULT_ANALYSIS_SIZE = 320


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
_FRAME_FEATURE_CACHE = {}


def cached_features(frame):
    key = id(frame)
    cached = _FRAME_FEATURE_CACHE.get(key)
    if cached is not None:
        return cached
    descriptor = frame_descriptor(frame)
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


def index_source(video_path, source_id, output_path, sample_step_ms):
    video_path = Path(video_path).resolve()
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open source video: {video_path}")
    fps, frame_count, width, height, duration_ms = video_metadata(capture)
    step_frames = max(1, int(round((sample_step_ms / 1000.0) * fps)))
    samples = []
    frame_index = 0
    next_sample = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index >= next_sample:
            samples.append({
                "timeMs": frame_index * 1000.0 / fps,
                "frameIndex": frame_index,
                "descriptor": frame_descriptor(frame),
            })
            next_sample += step_frames
        frame_index += 1
    capture.release()
    if not samples:
        raise RuntimeError(f"No frames were indexed from {video_path}")

    source_sha = sha256_file(video_path)
    payload = {
        "schema": "editflow.practice-source-index.v1",
        "sourceId": source_id,
        "sourcePath": str(video_path),
        "sourceSha256": source_sha,
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
        },
        "samples": samples,
        "evidenceRefs": [
            f"video:sha256:{source_sha}",
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


def refine_candidate(shot, candidate, reference_reader, source_reader):
    anchors = shot["anchors"]
    center_anchor = anchors[len(anchors) // 2]
    reference_center = reference_reader.read_ms(center_anchor["timeMs"])
    if reference_center is None:
        return None

    sample_time = float(candidate["sample"]["timeMs"])
    sample_step = float(candidate["index"]["analysis"]["sampleStepMs"])
    best_center = None
    for center_time in candidate_center_times(sample_time, sample_step):
        source_center = source_reader.read_ms(center_time)
        if source_center is None:
            continue
        score = feature_similarity(reference_center, source_center)
        if best_center is None or score > best_center["score"]:
            best_center = {"timeMs": center_time, "score": score}
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
                similarities.append(feature_similarity(reference_frame, source_frame))
            if not valid or not similarities:
                continue
            average = float(np.mean(similarities))
            minimum = float(np.min(similarities))
            consistency = clamp01(1.0 - float(np.std(similarities)) * 1.8)
            score = clamp01((0.72 * average) + (0.18 * minimum) + (0.10 * consistency))
            item = {
                "score": score,
                "appearance": average,
                "minimum": minimum,
                "consistency": consistency,
                "slope": slope,
                "centerSourceMs": best_center["timeMs"],
                "anchorSimilarities": similarities,
            }
            if best_mapping is None or item["score"] > best_mapping["score"]:
                best_mapping = item

    if best_mapping is None or len(anchors) < 2:
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
        source_index["sourceId"]: FrameReader(source_index["sourcePath"])
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
                    "index": candidate["index"],
                    "sample": candidate["sample"],
                    "coarseScore": candidate["score"],
                    "mapping": mapping,
                })
            refined.sort(key=lambda item: item["mapping"]["score"], reverse=True)
            if not refined:
                continue

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
        ],
    }
    Path(output_path).write_text(json.dumps(payload, indent=2), encoding="utf-8", newline="\n")
    return payload


def build_parser():
    parser = argparse.ArgumentParser(
        description="EditFlow Practice reference decomposition, source indexing, and scene matching."
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

    match = subparsers.add_parser("match")
    match.add_argument("--reference-json", required=True)
    match.add_argument("--source-index-json", action="append", required=True)
    match.add_argument("--output", required=True)
    match.add_argument("--coarse-limit", type=int, default=16)
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
        payload = index_source(args.video, args.source_id, args.output, args.sample_step_ms)
        print(json.dumps({
            "ok": True,
            "command": "index",
            "output": str(Path(args.output).resolve()),
            "sampleCount": len(payload["samples"]),
            "sourceSha256": payload["sourceSha256"],
        }))
    else:
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


if __name__ == "__main__":
    main()
