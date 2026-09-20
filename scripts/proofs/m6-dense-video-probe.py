#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np


PROBE_ALGORITHM_ID = "editflow.m6.dense-video-probe.v17"
ECHO_ANALYSIS_LONGEST = 360
ECHO_SPATIAL_PAIR_MIN = 0.035
TEMPORAL_ECHO_MOTION_COVERAGE_MIN = 0.04
TEMPORAL_ECHO_MOTION_P90_MIN = 0.03
TEMPORAL_ECHO_PERSISTENT_OCCUPANCY_MAX = 0.35
TEMPORAL_ECHO_CORROBORATION_RADIUS = 1


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


def normalized_frame_mae(previous, current):
    return float(np.mean(cv2.absdiff(previous, current)) / 255.0)


def color_histogram_distance(previous, current):
    hist_previous = cv2.calcHist(
        [previous], [0, 1], None, [32, 32], [0, 256, 0, 256]
    )
    hist_current = cv2.calcHist(
        [current], [0, 1], None, [32, 32], [0, 256, 0, 256]
    )
    cv2.normalize(hist_previous, hist_previous)
    cv2.normalize(hist_current, hist_current)
    return float(cv2.compareHist(
        hist_previous, hist_current, cv2.HISTCMP_BHATTACHARYYA
    ))


def persistent_shot_boundary_metrics(previous, current, following):
    enter_mae = normalized_frame_mae(previous, current)
    hold_mae = normalized_frame_mae(current, following)
    bridge_mae = normalized_frame_mae(previous, following)
    enter_hist = color_histogram_distance(previous, current)
    hold_hist = color_histogram_distance(current, following)
    bridge_hist = color_histogram_distance(previous, following)
    persistent_regime_jump = (
        enter_mae >= 0.075
        and bridge_mae >= enter_mae * 0.70
    )
    persistent_regime_histogram_change = (
        enter_hist >= 0.10
        and bridge_hist >= enter_hist * 0.65
    )
    persistent_jump = (
        persistent_regime_jump
        and hold_mae <= max(0.0125, enter_mae * 0.22)
    )
    persistent_histogram_change = (
        persistent_regime_histogram_change
        and hold_hist <= 0.08
        and hold_hist <= enter_hist * 0.45
    )
    return {
        "candidate": bool(persistent_jump and persistent_histogram_change),
        "baselineSegmentCandidate": bool(
            persistent_regime_jump and persistent_regime_histogram_change
        ),
        "entryFrameMae": enter_mae,
        "holdFrameMae": hold_mae,
        "bridgeFrameMae": bridge_mae,
        "entryHistogramDistance": enter_hist,
        "holdHistogramDistance": hold_hist,
        "bridgeHistogramDistance": bridge_hist,
    }


def edge_echo_surface(gray):
    # Keep autocorrelation on one physical sampling scale. State separation is
    # normalized later, but Canny peaks, dilation windows, and baseline
    # envelopes are pixel-domain operations; arbitrary source resolution made
    # the same shutter construction appear/disappear across analysis sizes.
    height, width = gray.shape
    scale = min(1.0, float(ECHO_ANALYSIS_LONGEST) / max(width, height))
    if scale < 1.0:
        gray = cv2.resize(
            gray,
            (max(2, round(width * scale)), max(2, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
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
    # Event existence remains amplitude-relative so weak texture cannot become
    # a temporal state. Spatial actuation is different: once the event is
    # proven, measure the nearest independently reliable copy rather than the
    # strongest harmonic. This keeps duplicate-spread measurement causal when
    # band/source periodicity produces a farther, higher autocorrelation peak.
    separation_pairs = []
    for py, px in np.argwhere(residual_maxima & (residual >= ECHO_SPATIAL_PAIR_MIN)):
        dy = float(py - cy)
        dx = float(px - cx)
        pair_radius = math.hypot(dx, dy)
        if pair_radius < min_pair_radius:
            continue
        if dy < 0.0 or (abs(dy) < 0.5 and dx <= 0.0):
            continue
        separation_pairs.append((float(residual[py, px]), pair_radius))
    separation_pairs.sort(reverse=True)
    strong_pairs = []
    if residual_peak >= 0.035 and residual_pairs:
        strongest_residual = residual_pairs[0][0]
        strong_threshold = max(0.035, strongest_residual * 0.65)
        strong_pairs = [pair for pair in residual_pairs if pair[0] >= strong_threshold]

    if strong_pairs:
        state_count = 1 + min(4, len(strong_pairs))
        echo_strength = clamp01(residual_peak)
        overlap_threshold = max(0.02, residual_peak * 0.35)
        overlap_density = clamp01(
            float(np.mean(residual[search] >= overlap_threshold)) * 12.0
        )
        # The nearest reliable strong residual is the visible spacing between
        # simultaneous states. A farther, slightly stronger autocorrelation
        # harmonic often comes from band periodicity or source structure and
        # must not become the construction actuator for duplicate spread.
        spatial_pairs = separation_pairs if separation_pairs else strong_pairs
        echo_offset_pixels = min(spatial_pairs, key=lambda pair: pair[1])[1]
        state_separation = clamp01(
            echo_offset_pixels / max(math.hypot(surface["width"], surface["height"]), 1.0)
        )
    else:
        # A global residual can exceed the event threshold while every valid
        # off-center pair remains below the reliability floor. That is not
        # multi-state evidence; fail closed instead of emitting a state or
        # attempting to actuate separation from an empty candidate set.
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

    # Edge autocorrelation must be normalized against the local shot, not the
    # entire transition window. A whole-window median mixes unrelated pre/post
    # cut textures and can make the destination shot look like a persistent
    # multi-state echo. Persistent RGB continuity gives us conservative segment
    # starts before any semantic echo evidence is derived.
    boundary_metrics_by_offset = [None] * len(frames)
    for offset in range(1, max(1, len(frames) - 1)):
        if offset + 1 >= len(frames):
            break
        boundary_metrics_by_offset[offset] = persistent_shot_boundary_metrics(
            frames[offset - 1][1], frames[offset][1], frames[offset + 1][1]
        )
    # A stylized transition can evolve for several frames, so the strict
    # hard-cut detector may intentionally remain false. For echo normalization,
    # choose the strongest persistent appearance-regime onset instead. This
    # suppresses destination-shot texture without isolating the effect frames
    # into their own baseline (which would erase the transient we need to see).
    regime_candidates = [
        (offset, metrics)
        for offset, metrics in enumerate(boundary_metrics_by_offset)
        if metrics is not None and metrics["baselineSegmentCandidate"]
    ]
    segment_starts = [0]
    if regime_candidates:
        dominant_offset, _metrics = max(
            regime_candidates,
            key=lambda item: (
                item[1]["entryFrameMae"]
                * max(item[1]["entryHistogramDistance"], 1e-6)
                * max(item[1]["bridgeFrameMae"], 1e-6)
            ),
        )
        if dominant_offset >= 3 and len(frames) - dominant_offset >= 3:
            segment_starts.append(dominant_offset)
    segment_ends = segment_starts[1:] + [len(frames)]
    temporal_echo_baselines = [None] * len(frames)
    temporal_echo_baseline_ranges = [None] * len(frames)
    # Do not learn the echo baseline from the transition itself. Around a
    # detected appearance-regime boundary, reserve ~150 ms on each adjacent
    # segment as an effect guard. This keeps stable shot texture available for
    # normalization while preventing the defining shutter/fragmentation frames
    # from subtracting themselves out of the baseline.
    transition_guard_frames = max(2, int(round(max(float(fps), 1.0) * 0.15)))
    for start, end in zip(segment_starts, segment_ends):
        baseline_start = start + (transition_guard_frames if start > 0 else 0)
        baseline_end = end - (transition_guard_frames if end < len(frames) else 0)
        # Very short segments cannot afford the guard. Fall back to the full
        # segment rather than manufacturing a baseline from fewer than 3 frames.
        if baseline_end - baseline_start < 3:
            baseline_start, baseline_end = start, end
        echo_values = [
            echo_surfaces[index]["values"]
            for index in range(baseline_start, baseline_end)
            if echo_surfaces[index] is not None
        ]
        # Use the guarded temporal median as the same-shot texture baseline.
        # A max/union baseline can erase legitimate short-lived temporal copies.
        # Resolution is normalized before autocorrelation, and repeated source
        # texture is rejected later by independent motion-compensated residual
        # evidence plus event-local occupancy/anchor gates.
        baseline = (
            np.median(np.stack(echo_values, axis=0), axis=0).astype(np.float32)
            if echo_values
            else None
        )
        for index in range(start, end):
            temporal_echo_baselines[index] = baseline
            temporal_echo_baseline_ranges[index] = {
                "start": baseline_start,
                "end": baseline_end,
                "guardFrames": transition_guard_frames,
            }

    sharpness = np.array(
        [float(cv2.Laplacian(gray, cv2.CV_64F).var()) for gray in grays],
        dtype=np.float64,
    )
    sharp_reference = max(float(np.percentile(sharpness, 90)), 1e-6)
    cumulative_scale = 1.0
    cumulative_rotation = 0.0
    output = []
    for offset, ((source_index, frame), gray) in enumerate(zip(frames, grays)):
        state_count, echo_strength, overlap_density, state_separation = edge_echo_metrics(
            echo_surfaces[offset], temporal_echo_baselines[offset]
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
            "shotBoundaryDiscontinuity": False,
        }
        baseline_range = temporal_echo_baseline_ranges[offset] or {
            "start": 0,
            "end": len(frames),
            "guardFrames": 0,
        }
        diagnostics = {
            "edgeEchoStrength": echo_strength,
            "temporalEchoRawStateCount": float(state_count),
            "temporalEchoRawOverlapDensity": overlap_density,
            "temporalEchoRawStateSeparation": state_separation,
            "temporalEchoMotionCorroborated": 0.0,
            "temporalEchoBaselineStartOffset": float(baseline_range["start"]),
            "temporalEchoBaselineEndOffset": float(baseline_range["end"]),
            "temporalEchoBaselineGuardFrames": float(baseline_range["guardFrames"]),
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
            "shotBoundaryDiscontinuity": 0.0,
            "entryFrameMae": 0.0,
            "holdFrameMae": 0.0,
            "bridgeFrameMae": 0.0,
            "entryHistogramDistance": 0.0,
            "holdHistogramDistance": 0.0,
            "bridgeHistogramDistance": 0.0,
        }
        if offset > 0:
            previous = grays[offset - 1]
            boundary_metrics = {
                "candidate": False,
                "entryFrameMae": 0.0,
                "holdFrameMae": 0.0,
                "bridgeFrameMae": 0.0,
                "entryHistogramDistance": 0.0,
                "holdHistogramDistance": 0.0,
                "bridgeHistogramDistance": 0.0,
            }
            retained_boundary_metrics = boundary_metrics_by_offset[offset]
            if retained_boundary_metrics is not None:
                boundary_metrics = retained_boundary_metrics
                for key in (
                    "entryFrameMae", "holdFrameMae", "bridgeFrameMae",
                    "entryHistogramDistance", "holdHistogramDistance",
                    "bridgeHistogramDistance",
                ):
                    diagnostics[key] = float(boundary_metrics[key])
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
                residual_mean, residual_p90, active = motion_compensated_residual(
                    previous, gray, matrix
                )
                diagnostics["affineInlierRatio"] = inlier_ratio
                diagnostics["motionCompensatedResidualMean"] = residual_mean
                diagnostics["motionCompensatedResidualP90"] = residual_p90
                diagnostics["motionCompensatedResidualCoverage"] = active
                shot_boundary = bool(
                    boundary_metrics["candidate"]
                    and (
                        diagnostics["affineFallbackUsed"] > 0.0
                        or inlier_ratio < 0.45
                    )
                )
                if shot_boundary:
                    semantic["shotBoundaryDiscontinuity"] = True
                    diagnostics["shotBoundaryDiscontinuity"] = 1.0
                    semantic["displacement"] = {"x": 0.0, "y": 0.0}
                    semantic["cameraMotion"] = {"x": 0.0, "y": 0.0}
                    semantic["distortionStrength"] = 0.0
                else:
                    cumulative_scale *= step_scale
                    cumulative_rotation += step_rotation
                    semantic["scale"] = float(cumulative_scale)
                    semantic["rotationDegrees"] = float(cumulative_rotation)
                    semantic["distortionStrength"] = clamp01(
                        residual_mean * 2.4
                        + residual_p90 * 1.4
                        + (flow_residual / diagonal) * 3.0
                    )
            else:
                diagnostics["affineFallbackUsed"] = 2.0
                shot_boundary = bool(boundary_metrics["candidate"])
                if shot_boundary:
                    semantic["shotBoundaryDiscontinuity"] = True
                    diagnostics["shotBoundaryDiscontinuity"] = 1.0
                    semantic["displacement"] = {"x": 0.0, "y": 0.0}
                    semantic["cameraMotion"] = {"x": 0.0, "y": 0.0}
                    semantic["distortionStrength"] = 0.0
                else:
                    # Untrackable deformation remains evidence when the appearance
                    # change does not persist as a new shot.
                    semantic["distortionStrength"] = clamp01(
                        (flow_residual / diagonal) * 3.0
                    )
            diagnostics["flowMeanPixels"] = mean_mag
            diagnostics["flowP90Pixels"] = p90_mag
            diagnostics["flowCoherence"] = coherence
            diagnostics["flowResidualP90Pixels"] = flow_residual

        # Mark independent motion corroboration now; final promotion to
        # semantic multi-state evidence happens after the full shot segment is
        # available so persistent transforming texture can be rejected.
        if semantic["temporalStateCount"] >= 2:
            echo_corroborated = (
                not semantic["shotBoundaryDiscontinuity"]
                and diagnostics["motionCompensatedResidualCoverage"]
                    >= TEMPORAL_ECHO_MOTION_COVERAGE_MIN
                and diagnostics["motionCompensatedResidualP90"]
                    >= TEMPORAL_ECHO_MOTION_P90_MIN
            )
            diagnostics["temporalEchoMotionCorroborated"] = (
                1.0 if echo_corroborated else 0.0
            )
        output.append(
            {
                "sourceFrameIndex": source_index,
                "timeMs": float(source_index * 1000.0 / fps),
                "frame": frame,
                "semantic": semantic,
                "diagnostics": diagnostics,
            }
        )

    # Promote raw echo evidence only when it belongs to a short, independently
    # corroborated event. A held copy may survive one frame beyond the residual
    # impulse, but a repeated pattern that remains corroborated through much of
    # the shot is source texture, not temporal fragmentation.
    transition_anchor_offset = (
        segment_starts[1] if len(segment_starts) > 1 else None
    )
    for start, end in zip(segment_starts, segment_ends):
        segment_length = max(1, end - start)
        corroborated_offsets = [
            index
            for index in range(start, end)
            if output[index]["diagnostics"]["temporalEchoRawStateCount"] >= 2
            and output[index]["diagnostics"]["temporalEchoMotionCorroborated"] > 0.5
        ]
        corroborated_occupancy = len(corroborated_offsets) / segment_length
        persistent_texture = (
            corroborated_occupancy > TEMPORAL_ECHO_PERSISTENT_OCCUPANCY_MAX
        )
        for index in range(start, end):
            item = output[index]
            diagnostics = item["diagnostics"]
            semantic = item["semantic"]
            raw_echo = diagnostics["temporalEchoRawStateCount"] >= 2
            neighbor_corroborated = any(
                abs(index - candidate) <= TEMPORAL_ECHO_CORROBORATION_RADIUS
                for candidate in corroborated_offsets
            )
            within_transition_anchor = (
                transition_anchor_offset is None
                or abs(index - transition_anchor_offset) <= transition_guard_frames
            )
            promoted = (
                raw_echo
                and neighbor_corroborated
                and not persistent_texture
                and within_transition_anchor
            )
            diagnostics["temporalEchoCorroboratedOccupancy"] = corroborated_occupancy
            diagnostics["temporalEchoTransitionAnchorOffset"] = (
                -1.0 if transition_anchor_offset is None
                else float(transition_anchor_offset)
            )
            diagnostics["temporalEchoWithinTransitionAnchor"] = (
                1.0 if within_transition_anchor else 0.0
            )
            diagnostics["temporalEchoPersistentSourceTexture"] = (
                1.0 if persistent_texture else 0.0
            )
            diagnostics["temporalEchoPromoted"] = 1.0 if promoted else 0.0
            if raw_echo and not promoted:
                semantic["temporalStateCount"] = 1
                semantic["overlapDensity"] = 0.0
                semantic["stateSeparation"] = 0.0
                diagnostics["stateSeparationNormalized"] = 0.0
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
                "persistent shot-boundary rejection",
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
