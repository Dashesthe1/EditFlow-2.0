#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np


PROBE_ALGORITHM_ID = "editflow.m6.dense-video-probe.v12"


def analyzer_fingerprint():
    digest = hashlib.sha256()
    digest.update(Path(__file__).resolve().read_bytes())
    digest.update(PROBE_ALGORITHM_ID.encode("utf-8"))
    digest.update(str(cv2.__version__).encode("utf-8"))
    digest.update(str(np.__version__).encode("utf-8"))
    return digest.hexdigest()


def clamp01(value):
    return float(min(1.0, max(0.0, value)))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resize_for_analysis(frame, longest):
    height, width = frame.shape[:2]
    scale = min(1.0, float(longest) / max(width, height))
    if scale == 1.0:
        return frame
    return cv2.resize(
        frame,
        (max(2, round(width * scale)), max(2, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def gray_u8(frame):
    return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)


def farneback_flow(previous, current):
    return cv2.calcOpticalFlowFarneback(
        previous, current, None, 0.5, 4, 19, 3, 5, 1.2, 0
    )


def flow_stats(flow):
    dx = flow[..., 0]
    dy = flow[..., 1]
    magnitude = np.sqrt(dx * dx + dy * dy)
    median = np.array([np.median(dx), np.median(dy)], dtype=np.float64)
    mean_mag = float(np.mean(magnitude))
    p90_mag = float(np.percentile(magnitude, 90))
    coherent = float(np.linalg.norm(np.mean(flow.reshape(-1, 2), axis=0)))
    coherence = clamp01(coherent / max(mean_mag, 1e-6))
    residual = np.sqrt((dx - median[0]) ** 2 + (dy - median[1]) ** 2)
    return median, mean_mag, p90_mag, coherence, float(np.percentile(residual, 90))


def affine_step(previous, current):
    points0 = cv2.goodFeaturesToTrack(
        previous, maxCorners=500, qualityLevel=0.01, minDistance=6, blockSize=5
    )
    if points0 is None or len(points0) < 4:
        return None
    points1, status, _error = cv2.calcOpticalFlowPyrLK(
        previous, current, points0, None, winSize=(21, 21), maxLevel=3
    )
    if points1 is None or status is None:
        return None
    keep = status.reshape(-1) == 1
    source = points0.reshape(-1, 2)[keep]
    target = points1.reshape(-1, 2)[keep]
    if len(source) < 4:
        return None
    matrix, inliers = cv2.estimateAffinePartial2D(
        source,
        target,
        method=cv2.RANSAC,
        ransacReprojThreshold=2.5,
        maxIters=1000,
        confidence=0.995,
        refineIters=10,
    )
    if matrix is None:
        return None
    a, b, tx = [float(v) for v in matrix[0]]
    c, d, ty = [float(v) for v in matrix[1]]
    scale = math.sqrt(max(1e-12, a * a + c * c))
    rotation = math.degrees(math.atan2(c, a))
    inlier_ratio = (
        float(np.mean(inliers.reshape(-1) > 0))
        if inliers is not None and len(inliers)
        else 0.0
    )
    height, width = current.shape[:2]
    extreme_scale_step = scale < 0.85 or scale > 1.18
    minimum_inlier_ratio = 0.55 if extreme_scale_step else 0.35
    plausible = (
        inlier_ratio >= minimum_inlier_ratio
        and 0.60 <= scale <= 1.70
        and abs(rotation) <= 12.0
        and abs(tx) <= width * 0.30
        and abs(ty) <= height * 0.30
    )
    if not plausible:
        return None
    return matrix.astype(np.float32), scale, rotation, tx, ty, inlier_ratio


def dense_affine_step(flow):
    height, width = flow.shape[:2]
    stride = max(4, min(height, width) // 36)
    ys = np.arange(stride // 2, height, stride, dtype=np.int32)
    xs = np.arange(stride // 2, width, stride, dtype=np.int32)
    if len(xs) < 3 or len(ys) < 3:
        return None
    yy, xx = np.meshgrid(ys, xs, indexing="ij")
    source = np.column_stack((xx.reshape(-1), yy.reshape(-1))).astype(np.float32)
    delta = flow[yy, xx].reshape(-1, 2).astype(np.float32)
    diagonal = max(math.hypot(width, height), 1.0)
    finite = np.isfinite(delta).all(axis=1)
    magnitude = np.linalg.norm(delta, axis=1)
    keep = finite & (magnitude <= diagonal * 0.35)
    source = source[keep]
    delta = delta[keep]
    if len(source) < 12:
        return None
    target = source + delta
    matrix, inliers = cv2.estimateAffinePartial2D(
        source, target, method=cv2.RANSAC, ransacReprojThreshold=2.5,
        maxIters=1000, confidence=0.995, refineIters=10,
    )
    if matrix is None:
        return None
    a, b, tx = [float(v) for v in matrix[0]]
    c, d, ty = [float(v) for v in matrix[1]]
    scale = math.sqrt(max(1e-12, a * a + c * c))
    rotation = math.degrees(math.atan2(c, a))
    inlier_ratio = float(np.mean(inliers.reshape(-1) > 0)) if inliers is not None else 0.0
    plausible = (
        inlier_ratio >= 0.12
        and 0.60 <= scale <= 1.70
        and abs(rotation) <= 12.0
        and abs(tx) <= width * 0.30
        and abs(ty) <= height * 0.30
    )
    if not plausible:
        return None
    return matrix.astype(np.float32), scale, rotation, tx, ty, inlier_ratio


def motion_compensated_residual(previous, current, matrix):
    height, width = current.shape[:2]
    warped = cv2.warpAffine(
        previous,
        matrix,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT101,
    )
    residual = cv2.absdiff(warped, current)
    mean = float(np.mean(residual) / 255.0)
    p90 = float(np.percentile(residual, 90) / 255.0)
    active = float(np.mean(residual >= 28))
    return mean, p90, active


def independent_motion_observation(flow, matrix):
    height, width = flow.shape[:2]
    if height < 8 or width < 8:
        return None
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    predicted_x = matrix[0, 0] * xx + matrix[0, 1] * yy + matrix[0, 2]
    predicted_y = matrix[1, 0] * xx + matrix[1, 1] * yy + matrix[1, 2]
    predicted = np.stack((predicted_x - xx, predicted_y - yy), axis=-1)
    residual = flow.astype(np.float32) - predicted
    residual_mag = np.linalg.norm(residual, axis=2)
    finite = np.isfinite(residual_mag)
    values = residual_mag[finite]
    if values.size < max(64, int(height * width * 0.25)):
        return None

    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    p75 = float(np.percentile(values, 75))
    p90 = float(np.percentile(values, 90))
    threshold = max(0.75, p75, median + 2.5 * max(mad, 0.15))
    if p90 < threshold * 1.12:
        return None

    mask = ((residual_mag >= threshold) & finite).astype(np.uint8) * 255
    kernel = np.ones((3, 3), dtype=np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    total = float(height * width)
    candidates = []
    for label in range(1, count):
        area = float(stats[label, cv2.CC_STAT_AREA])
        coverage = area / total
        if coverage < 0.008 or coverage > 0.48:
            continue
        component = labels == label
        component_residual = residual_mag[component]
        if component_residual.size == 0:
            continue
        strength = float(np.median(component_residual))
        contrast = strength / max(median + mad, 0.35)
        score = coverage * min(4.0, contrast)
        candidates.append((score, label, coverage, strength))
    if not candidates:
        return None

    _score, label, coverage, strength = max(candidates, key=lambda item: item[0])
    component = labels == label
    left = int(stats[label, cv2.CC_STAT_LEFT])
    top = int(stats[label, cv2.CC_STAT_TOP])
    box_width = int(stats[label, cv2.CC_STAT_WIDTH])
    box_height = int(stats[label, cv2.CC_STAT_HEIGHT])
    bounding_box = [
        clamp01(float(left) / max(width, 1)),
        clamp01(float(top) / max(height, 1)),
        clamp01(float(box_width) / max(width, 1)),
        clamp01(float(box_height) / max(height, 1)),
    ]
    # Clamp width/height against the normalized origin so floating-point
    # roundoff cannot produce a box that extends outside [0, 1].
    bounding_box[2] = min(bounding_box[2], 1.0 - bounding_box[0])
    bounding_box[3] = min(bounding_box[3], 1.0 - bounding_box[1])
    residual_vectors = residual[component]
    if residual_vectors.size == 0:
        return None
    relative_vector = np.median(residual_vectors, axis=0)
    centroid = centroids[label]
    subject_centroid = {
        "x": clamp01(float(centroid[0]) / max(width - 1, 1)),
        "y": clamp01(float(centroid[1]) / max(height - 1, 1)),
    }
    relative_motion = {
        "x": float(relative_vector[0]) / max(width, 1),
        "y": float(relative_vector[1]) / max(height, 1),
    }
    relative_magnitude = math.hypot(relative_motion["x"], relative_motion["y"])
    separation = clamp01(relative_magnitude * 5.0)
    border = max(2, int(round(min(width, height) * 0.035)))
    border_mask = np.zeros((height, width), dtype=bool)
    border_mask[:border, :] = True
    border_mask[-border:, :] = True
    border_mask[:, :border] = True
    border_mask[:, -border:] = True
    edge_contact = float(np.mean(component[border_mask])) if np.any(border_mask) else 0.0
    occlusion = clamp01(
        max(0.0, coverage - 0.18) * 1.8
        * min(1.0, edge_contact * 8.0)
    )
    confidence = clamp01(
        (0.55 * min(1.0, strength / max(threshold * 1.5, 1e-6)))
        + (0.30 * min(1.0, coverage / 0.12))
        + (0.15 * min(1.0, p90 / max(threshold * 2.0, 1e-6)))
    )
    if confidence < 0.45 or separation < 0.025:
        return None
    return {
        "subjectCentroid": subject_centroid,
        "boundingBox": bounding_box,
        "relativeMotion": relative_motion,
        "maskCoverage": clamp01(coverage),
        "subjectSeparation": separation,
        "occlusion": occlusion,
        "confidence": confidence,
        "thresholdPixels": threshold,
        "residualP90Pixels": p90,
    }


def bbox_iou(left, right):
    lx, ly, lw, lh = [float(value) for value in left]
    rx, ry, rw, rh = [float(value) for value in right]
    ix1 = max(lx, rx)
    iy1 = max(ly, ry)
    ix2 = min(lx + lw, rx + rw)
    iy2 = min(ly + lh, ry + rh)
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = max(0.0, lw * lh + rw * rh - intersection)
    return 0.0 if union <= 1e-9 else intersection / union


def bbox_centroid(box):
    x, y, width, height = [float(value) for value in box]
    return {"x": clamp01(x + width * 0.5), "y": clamp01(y + height * 0.5)}


def bbox_centroid_distance(left, right):
    a = bbox_centroid(left)
    b = bbox_centroid(right)
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def bbox_touches_edge(box, margin=0.025):
    x, y, width, height = [float(value) for value in box]
    return (
        x <= margin
        or y <= margin
        or x + width >= 1.0 - margin
        or y + height >= 1.0 - margin
    )


def predict_bbox(box, matrix, width, height):
    if matrix is None:
        return [float(value) for value in box]
    x, y, box_width, box_height = [float(value) for value in box]
    corners = np.array([
        [x * width, y * height, 1.0],
        [(x + box_width) * width, y * height, 1.0],
        [x * width, (y + box_height) * height, 1.0],
        [(x + box_width) * width, (y + box_height) * height, 1.0],
    ], dtype=np.float32)
    transformed = corners @ matrix.T
    left = clamp01(float(np.min(transformed[:, 0])) / max(width, 1))
    top = clamp01(float(np.min(transformed[:, 1])) / max(height, 1))
    right = clamp01(float(np.max(transformed[:, 0])) / max(width, 1))
    bottom = clamp01(float(np.max(transformed[:, 1])) / max(height, 1))
    predicted_width = max(1.0 / max(width, 1), right - left)
    predicted_height = max(1.0 / max(height, 1), bottom - top)
    predicted_width = min(predicted_width, 1.0 - left)
    predicted_height = min(predicted_height, 1.0 - top)
    return [left, top, predicted_width, predicted_height]


def bind_subject_identity(semantic, diagnostics, track, observation, matrix, width, height, source_index, max_gap_frames):
    """
    Maintain one fail-closed primary semantic identity inside this analyzed source.

    Independent-motion components are observations, not semantic segmentation masks.
    They may seed and refresh identity, but they never set subjectMaskValidated=True.
    During short low-motion/edge-occlusion gaps, the existing identity is predicted
    through the accepted camera affine. A spatially contradictory new component is
    not silently rebound to the old identity.
    """
    if observation is not None:
        candidate_box = observation["boundingBox"]
        candidate_confidence = float(observation["confidence"])
        if track is None or track.get("state") == "LOST":
            serial = 1 if track is None else int(track.get("serial", 0)) + 1
            track = {
                "semanticId": f"subject:primary:v{serial}",
                "serial": serial,
                "box": list(candidate_box),
                "confidence": candidate_confidence,
                "gapFrames": 0,
                "ageFrames": 1,
                "lastOcclusion": float(observation["occlusion"]),
                "state": "OBSERVED",
            }
        else:
            prior_box = track["box"]
            overlap = bbox_iou(prior_box, candidate_box)
            centroid_distance = bbox_centroid_distance(prior_box, candidate_box)
            prior_area = max(1e-6, float(prior_box[2]) * float(prior_box[3]))
            candidate_area = max(1e-6, float(candidate_box[2]) * float(candidate_box[3]))
            area_ratio = max(prior_area, candidate_area) / min(prior_area, candidate_area)
            same_identity = (
                overlap >= 0.03
                or (
                    centroid_distance <= 0.24
                    and area_ratio <= 5.0
                    and int(track.get("gapFrames", 0)) <= max_gap_frames
                )
            )
            if same_identity:
                track["box"] = list(candidate_box)
                track["confidence"] = candidate_confidence
                track["gapFrames"] = 0
                track["ageFrames"] = int(track.get("ageFrames", 0)) + 1
                track["lastOcclusion"] = float(observation["occlusion"])
                track["state"] = "OBSERVED"
            else:
                # Preserve the established identity for the bounded gap instead of
                # rebinding an unrelated foreground component.
                diagnostics["objectIdentityConflict"] = 1.0
                observation = None

    if observation is None and track is not None and track.get("state") != "LOST":
        gap = int(track.get("gapFrames", 0)) + 1
        track["gapFrames"] = gap
        track["ageFrames"] = int(track.get("ageFrames", 0)) + 1
        track["box"] = predict_bbox(track["box"], matrix, width, height)
        if gap <= max_gap_frames:
            occluded = float(track.get("lastOcclusion", 0.0)) >= 0.12 or bbox_touches_edge(track["box"])
            track["state"] = "PREDICTED_OCCLUDED" if occluded else "PREDICTED_LOW_MOTION"
            track["confidence"] = clamp01(float(track.get("confidence", 0.0)) * 0.82)
        else:
            track["state"] = "LOST"
            track["confidence"] = 0.0

    if track is None:
        semantic["subjectTrackState"] = "UNOBSERVED"
        semantic["subjectMaskSource"] = "NONE"
        semantic["subjectMaskValidated"] = False
        diagnostics["subjectIdentityBound"] = 0.0
        return None

    semantic_id = str(track["semanticId"])
    state = str(track["state"])
    box = [float(value) for value in track["box"]]
    confidence = clamp01(float(track.get("confidence", 0.0)))
    semantic["subjectSemanticId"] = semantic_id
    semantic["subjectTrackState"] = state
    semantic["subjectIdentityConfidence"] = confidence
    semantic["subjectBoundingBox"] = box
    semantic["subjectCentroid"] = bbox_centroid(box)
    semantic["subjectMaskValidated"] = False
    semantic["subjectEvidenceIds"] = [
        f"dense-subject-track:{semantic_id}",
        f"dense-subject-frame:{source_index}",
        f"dense-subject-state:{state}",
    ]
    if state == "OBSERVED" and observation is not None:
        semantic["subjectMaskSource"] = "MOTION_COMPONENT"
        semantic["subjectVisibility"] = clamp01(0.55 + 0.45 * confidence)
    elif state == "PREDICTED_OCCLUDED":
        semantic["subjectMaskSource"] = "NONE"
        semantic["subjectVisibility"] = clamp01(0.15 + 0.25 * confidence)
    elif state == "PREDICTED_LOW_MOTION":
        semantic["subjectMaskSource"] = "NONE"
        semantic["subjectVisibility"] = clamp01(0.40 + 0.35 * confidence)
    else:
        semantic["subjectMaskSource"] = "NONE"
        semantic["subjectVisibility"] = 0.0
    diagnostics["subjectIdentityBound"] = 0.0 if state in {"UNOBSERVED", "LOST"} else 1.0
    diagnostics["subjectIdentityConfidence"] = confidence
    diagnostics["subjectTrackGapFrames"] = float(track.get("gapFrames", 0))
    diagnostics["subjectTrackAgeFrames"] = float(track.get("ageFrames", 0))
    return track


def edge_echo_surface(gray):
    edges = cv2.Canny(gray, 60, 150).astype(np.float32) / 255.0
    if float(edges.mean()) < 0.0001:
        return None
    edges -= float(edges.mean())
    height, width = edges.shape
    padded = np.zeros((height * 2, width * 2), dtype=np.float32)
    padded[:height, :width] = edges
    spectrum = np.fft.rfft2(padded)
    autocorr = np.fft.irfft2(spectrum * np.conj(spectrum), s=padded.shape).real
    autocorr = np.fft.fftshift(autocorr)
    cy, cx = np.array(autocorr.shape) // 2
    center = float(autocorr[cy, cx])
    if center <= 1e-6:
        return None
    autocorr /= center
    yy, xx = np.ogrid[:autocorr.shape[0], :autocorr.shape[1]]
    radius = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    search = (radius >= 5) & (radius <= min(height, width) * 0.28)
    return {
        "values": np.where(search, autocorr, 0.0).astype(np.float32),
        "search": search,
        "cy": int(cy),
        "cx": int(cx),
        "height": height,
        "width": width,
        "minPairRadius": max(8.0, min(height, width) * 0.025),
    }


def edge_echo_metrics(surface, temporal_baseline):
    if surface is None:
        return 1, 0.0, 0.0, 0.0
    values = surface["values"]
    search = surface["search"]
    cy, cx = surface["cy"], surface["cx"]
    min_pair_radius = surface["minPairRadius"]
    maxima = values == cv2.dilate(values, np.ones((7, 7), np.uint8))
    pair_coords = np.argwhere(maxima & (values >= 0.16))
    pairs = []
    for py, px in pair_coords:
        dy = float(py - cy)
        dx = float(px - cx)
        pair_radius = math.hypot(dx, dy)
        if pair_radius < min_pair_radius:
            continue
        if dy < 0.0 or (abs(dy) < 0.5 and dx <= 0.0):
            continue
        pairs.append((float(values[py, px]), pair_radius))
    pairs.sort(reverse=True)

    # Raw autocorrelation measures repeated spatial texture as well as temporal
    # copies. M6 defining shutter evidence must be transient relative to the
    # same clip's temporal baseline, otherwise ordinary windows, faces, text,
    # or moving source detail can masquerade as duplicated image states.
    if temporal_baseline is None:
        residual = values
    else:
        # Autocorrelation is translation-invariant in theory, but subpixel
        # sampling and codec ringing can move a persistent edge-pair peak by a
        # few pixels between frames. Subtract a local envelope of the temporal
        # baseline so ordinary moving texture remains baseline behavior instead
        # of being reclassified as a transient duplicate state.
        baseline_envelope = cv2.dilate(
            temporal_baseline.astype(np.float32), np.ones((5, 5), np.uint8)
        )
        residual = np.maximum(values - baseline_envelope, 0.0)
    residual_peak = float(np.max(residual[search])) if np.any(search) else 0.0
    residual_threshold = max(0.025, residual_peak * 0.55)
    residual_maxima = residual == cv2.dilate(
        residual.astype(np.float32), np.ones((7, 7), np.uint8)
    )
    residual_pairs = []
    for py, px in np.argwhere(residual_maxima & (residual >= residual_threshold)):
        dy = float(py - cy)
        dx = float(px - cx)
        pair_radius = math.hypot(dx, dy)
        if pair_radius < min_pair_radius:
            continue
        if dy < 0.0 or (abs(dy) < 0.5 and dx <= 0.0):
            continue
        residual_pairs.append((float(residual[py, px]), pair_radius))
    residual_pairs.sort(reverse=True)
    if residual_peak >= 0.035 and residual_pairs:
        strongest_residual = residual_pairs[0][0]
        strong_threshold = max(0.035, strongest_residual * 0.65)
        strong_pairs = [pair for pair in residual_pairs if pair[0] >= strong_threshold]
        state_count = 1 + min(4, len(strong_pairs))
        echo_strength = clamp01(residual_peak)
        overlap_threshold = max(0.02, residual_peak * 0.35)
        overlap_density = clamp01(
            float(np.mean(residual[search] >= overlap_threshold)) * 12.0
        )
        echo_offset_pixels = residual_pairs[0][1]
        state_separation = clamp01(
            echo_offset_pixels / max(math.hypot(surface["width"], surface["height"]), 1.0)
        )
    else:
        state_count = 1
        echo_strength = 0.0
        overlap_density = 0.0
        state_separation = 0.0
    return state_count, echo_strength, overlap_density, state_separation


def read_window(video_path, start_seconds, end_seconds, longest):
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if not math.isfinite(fps) or fps <= 0:
        raise RuntimeError("Video reported an invalid frame rate.")
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    source_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    source_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    start_index = max(0, int(round(start_seconds * fps)))
    end_index = min(total - 1, int(round(end_seconds * fps)))
    if end_index - start_index + 1 < 3:
        raise RuntimeError("Dense window must contain at least three frames.")
    frames = []
    capture.set(cv2.CAP_PROP_POS_FRAMES, start_index)
    for index in range(start_index, end_index + 1):
        ok, frame = capture.read()
        if not ok:
            break
        frames.append((index, resize_for_analysis(frame, longest)))
    capture.release()
    if len(frames) != end_index - start_index + 1:
        raise RuntimeError("Could not decode every requested source frame.")
    return fps, total, source_width, source_height, frames


def read_cached_window(probe_path, longest):
    retained = json.loads(Path(probe_path).read_text(encoding="utf-8"))
    video = retained.get("video", {})
    fps = float(video.get("fps", 0.0))
    if not math.isfinite(fps) or fps <= 0:
        raise RuntimeError("Retained probe reported an invalid frame rate.")
    frames = []
    for item in retained.get("frames", []):
        png_path = Path(str(item.get("pngPath", "")))
        frame = cv2.imread(str(png_path), cv2.IMREAD_COLOR)
        if frame is None:
            raise FileNotFoundError(png_path)
        frames.append((int(item["sourceFrameIndex"]), resize_for_analysis(frame, longest)))
    if len(frames) < 3:
        raise RuntimeError("Retained probe must contain at least three cached frame images.")
    return {
        "retained": retained,
        "fps": fps,
        "total": int(video.get("frameCount", len(frames))),
        "width": int(video.get("width", frames[0][1].shape[1])),
        "height": int(video.get("height", frames[0][1].shape[0])),
        "frames": frames,
    }


def analyze_frames(frames, fps):
    grays = [gray_u8(frame) for _index, frame in frames]
    echo_surfaces = [edge_echo_surface(gray) for gray in grays]
    echo_values = [
        surface["values"] for surface in echo_surfaces if surface is not None
    ]
    temporal_echo_baseline = (
        np.median(np.stack(echo_values, axis=0), axis=0).astype(np.float32)
        if echo_values
        else None
    )
    sharpness = np.array(
        [float(cv2.Laplacian(gray, cv2.CV_64F).var()) for gray in grays],
        dtype=np.float64,
    )
    sharp_reference = max(float(np.percentile(sharpness, 90)), 1e-6)
    cumulative_scale = 1.0
    cumulative_rotation = 0.0
    background_centroid_x = 0.5
    background_centroid_y = 0.5
    subject_track = None
    max_subject_gap_frames = max(2, min(12, int(round(fps * 0.20))))
    output = []
    for offset, ((source_index, frame), gray) in enumerate(zip(frames, grays)):
        state_count, echo_strength, overlap_density, state_separation = edge_echo_metrics(
            echo_surfaces[offset], temporal_echo_baseline
        )
        semantic = {
            "displacement": {"x": 0.0, "y": 0.0},
            "scale": cumulative_scale,
            "rotationDegrees": cumulative_rotation,
            "blurStrength": clamp01(1.0 - sharpness[offset] / sharp_reference),
            "distortionStrength": 0.0,
            "overlapDensity": overlap_density,
            "stateSeparation": state_separation,
            "temporalStateCount": state_count,
            "occlusion": 0.0,
            "perspectiveEnergy": 0.0,
            "cameraMotion": {"x": 0.0, "y": 0.0},
        }
        diagnostics = {
            "edgeEchoStrength": echo_strength,
            "stateSeparationNormalized": state_separation,
            "flowMeanPixels": 0.0,
            "flowP90Pixels": 0.0,
            "flowCoherence": 1.0,
            "flowResidualP90Pixels": 0.0,
            "affineInlierRatio": 0.0,
            "affineFallbackUsed": 0.0,
            "motionCompensatedResidualMean": 0.0,
            "motionCompensatedResidualP90": 0.0,
            "motionCompensatedResidualCoverage": 0.0,
            "objectMotionDetected": 0.0,
            "objectMotionConfidence": 0.0,
            "objectMaskCoverage": 0.0,
            "objectRelativeMotion": 0.0,
            "objectIdentityConflict": 0.0,
            "subjectIdentityBound": 0.0,
            "subjectIdentityConfidence": 0.0,
            "subjectTrackGapFrames": 0.0,
            "subjectTrackAgeFrames": 0.0,
        }
        affine_matrix = None
        object_motion = None
        height, width = gray.shape
        if offset > 0:
            previous = grays[offset - 1]
            flow = farneback_flow(previous, gray)
            median, mean_mag, p90_mag, coherence, flow_residual = flow_stats(flow)
            height, width = gray.shape
            diagonal = max(math.hypot(width, height), 1.0)
            semantic["displacement"] = {
                "x": float(median[0] / width),
                "y": float(median[1] / height),
            }
            semantic["cameraMotion"] = dict(semantic["displacement"])
            affine = affine_step(previous, gray)
            if affine is None:
                affine = dense_affine_step(flow)
                if affine is not None:
                    diagnostics["affineFallbackUsed"] = 1.0
            if affine is not None:
                matrix, step_scale, step_rotation, tx, ty, inlier_ratio = affine
                affine_matrix = matrix
                cumulative_scale *= step_scale
                cumulative_rotation += step_rotation
                semantic["scale"] = float(cumulative_scale)
                semantic["rotationDegrees"] = float(cumulative_rotation)
                background_centroid_x = clamp01(background_centroid_x + tx / max(width, 1))
                background_centroid_y = clamp01(background_centroid_y + ty / max(height, 1))
                semantic["backgroundCentroid"] = {
                    "x": float(background_centroid_x),
                    "y": float(background_centroid_y),
                }
                object_motion = independent_motion_observation(flow, matrix)
                if object_motion is not None:
                    semantic["subjectCentroid"] = object_motion["subjectCentroid"]
                    semantic["subjectSeparation"] = object_motion["subjectSeparation"]
                    semantic["maskCoverage"] = object_motion["maskCoverage"]
                    semantic["occlusion"] = object_motion["occlusion"]
                    diagnostics["objectMotionDetected"] = 1.0
                    diagnostics["objectMotionConfidence"] = object_motion["confidence"]
                    diagnostics["objectMaskCoverage"] = object_motion["maskCoverage"]
                    diagnostics["objectRelativeMotion"] = math.hypot(
                        object_motion["relativeMotion"]["x"],
                        object_motion["relativeMotion"]["y"],
                    )
                    diagnostics["objectResidualThresholdPixels"] = object_motion["thresholdPixels"]
                    diagnostics["objectResidualP90Pixels"] = object_motion["residualP90Pixels"]
                residual_mean, residual_p90, active = motion_compensated_residual(
                    previous, gray, matrix
                )
                nonrigid = clamp01(
                    residual_mean * 2.4
                    + residual_p90 * 1.4
                    + (flow_residual / diagonal) * 3.0
                )
                semantic["distortionStrength"] = nonrigid
                # Whole-frame residual coverage remains diagnostic. Foreground
                # occlusion is emitted only by the bounded independent-motion
                # component heuristic above, never by residual coverage alone.
                diagnostics["affineInlierRatio"] = inlier_ratio
                diagnostics["motionCompensatedResidualMean"] = residual_mean
                diagnostics["motionCompensatedResidualP90"] = residual_p90
                diagnostics["motionCompensatedResidualCoverage"] = active
            else:
                # Untrackable deformation is evidence, not zero distortion. Use
                # translation-removed flow residual as a conservative lower bound.
                semantic["distortionStrength"] = clamp01(
                    (flow_residual / diagonal) * 3.0
                )
                diagnostics["affineFallbackUsed"] = 2.0
            diagnostics["flowMeanPixels"] = mean_mag
            diagnostics["flowP90Pixels"] = p90_mag
            diagnostics["flowCoherence"] = coherence
            diagnostics["flowResidualP90Pixels"] = flow_residual

        subject_track = bind_subject_identity(
            semantic,
            diagnostics,
            subject_track,
            object_motion,
            affine_matrix,
            width,
            height,
            source_index,
            max_subject_gap_frames,
        )
        if diagnostics["objectIdentityConflict"] >= 1.0:
            # A rejected component is not allowed to contribute subject/mask truth.
            semantic.pop("subjectSeparation", None)
            semantic.pop("maskCoverage", None)
            semantic["occlusion"] = 0.0
            diagnostics["objectMotionDetected"] = 0.0
            diagnostics["objectMotionConfidence"] = 0.0
            diagnostics["objectMaskCoverage"] = 0.0
            diagnostics["objectRelativeMotion"] = 0.0
        output.append(
            {
                "sourceFrameIndex": source_index,
                "timeMs": float(source_index * 1000.0 / fps),
                "frame": frame,
                "semantic": semantic,
                "diagnostics": diagnostics,
            }
        )
    return output


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract every-frame M6 effect evidence from a bounded video window."
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--video")
    source.add_argument("--input-probe-json")
    parser.add_argument("--start", type=float)
    parser.add_argument("--end", type=float)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-id", default="")
    parser.add_argument("--source-kind", choices=("REFERENCE", "RENDER"))
    parser.add_argument("--analysis-size", type=int, default=360)
    return parser.parse_args()


def main():
    args = parse_args()
    output_path = Path(args.output).resolve()
    if args.analysis_size < 96 or args.analysis_size > 720:
        raise ValueError("--analysis-size must be in [96, 720].")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame_dir = output_path.parent / f"{output_path.stem}-frames"
    frame_dir.mkdir(parents=True, exist_ok=True)

    retained = None
    video_path = None
    if args.video is not None:
        video_path = Path(args.video).resolve()
        if not video_path.is_file():
            raise FileNotFoundError(video_path)
        if args.start is None or args.end is None or args.start < 0 or args.end <= args.start:
            raise ValueError("Video analysis requires valid --start and --end values.")
        if args.source_kind is None:
            raise ValueError("Video analysis requires --source-kind.")
        fps, total, width, height, frames = read_window(
            video_path, args.start, args.end, args.analysis_size
        )
        source_id = args.source_id or video_path.stem
        source_kind = args.source_kind
        source_sha256 = sha256_file(video_path)
        requested_start = args.start
        requested_end = args.end
    else:
        cached = read_cached_window(Path(args.input_probe_json).resolve(), args.analysis_size)
        retained = cached["retained"]
        fps, total, width, height, frames = (
            cached["fps"], cached["total"], cached["width"], cached["height"], cached["frames"]
        )
        source_id = args.source_id or str(retained.get("sourceId", "retained-probe"))
        source_kind = args.source_kind or str(retained.get("sourceKind", ""))
        if source_kind not in ("REFERENCE", "RENDER"):
            raise ValueError("Retained probe must provide REFERENCE or RENDER sourceKind.")
        source_sha256 = str(retained.get("sourceVideoSha256", ""))
        if len(source_sha256) != 64:
            raise ValueError("Retained probe must preserve the immutable source-video SHA-256.")
        retained_range = retained.get("range", {})
        requested_start = retained_range.get("requestedStartSeconds")
        requested_end = retained_range.get("requestedEndSeconds")

    analyzed = analyze_frames(frames, fps)
    payload_frames = []
    for index, item in enumerate(analyzed):
        png_path = frame_dir / f"frame-{index:04d}.png"
        if not cv2.imwrite(str(png_path), item["frame"]):
            raise RuntimeError(f"Could not write frame image: {png_path}")
        payload_frames.append(
            {
                "sourceFrameIndex": item["sourceFrameIndex"],
                "timeMs": item["timeMs"],
                "pngPath": str(png_path),
                "semantic": item["semantic"],
                "diagnostics": item["diagnostics"],
            }
        )

    payload = {
        "schema": "editflow.dense-video-probe.v1",
        "sourceId": source_id,
        "sourceKind": source_kind,
        "sourceVideoSha256": source_sha256,
        "video": {
            "fps": fps,
            "frameCount": total,
            "width": width,
            "height": height,
        },
        "range": {
            "requestedStartSeconds": requested_start,
            "requestedEndSeconds": requested_end,
            "startFrame": frames[0][0],
            "endFrame": frames[-1][0],
        },
        "analysis": {
            "algorithmId": PROBE_ALGORITHM_ID,
            "analyzerFingerprint": analyzer_fingerprint(),
            "dependencies": {
                "opencv": str(cv2.__version__),
                "numpy": str(np.__version__),
            },
            "longestEdge": args.analysis_size,
            "frameCount": len(payload_frames),
            "algorithms": [
                "Farneback dense optical flow",
                "pyramidal Lucas-Kanade feature tracking",
                "RANSAC estimateAffinePartial2D",
                "dense-flow affine fallback",
                "motion-compensated residual",
                "fail-closed persistent primary-subject identity tracker",
                "edge autocorrelation echo detector",
                "Laplacian sharpness proxy",
            ],
        },
        "frames": payload_frames,
    }
    output_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8", newline="\n"
    )
    print(json.dumps({
        "ok": True,
        "output": str(output_path),
        "frameCount": len(payload_frames),
        "fps": fps,
        "sourceVideoSha256": payload["sourceVideoSha256"],
        "analyzerFingerprint": payload["analysis"]["analyzerFingerprint"],
        "algorithmId": payload["analysis"]["algorithmId"],
    }))


if __name__ == "__main__":
    main()
