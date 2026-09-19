#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np


PROBE_ALGORITHM_ID = "editflow.m6.dense-video-probe.v6"


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
    if points0 is None or len(points0) < 8:
        return None
    points1, status, _error = cv2.calcOpticalFlowPyrLK(
        previous, current, points0, None, winSize=(21, 21), maxLevel=3
    )
    if points1 is None or status is None:
        return None
    keep = status.reshape(-1) == 1
    source = points0.reshape(-1, 2)[keep]
    target = points1.reshape(-1, 2)[keep]
    if len(source) < 8:
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
    plausible = (
        inlier_ratio >= 0.35
        and 0.85 <= scale <= 1.18
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
    strongest_pair = pairs[0][0] if pairs else 0.0
    strong_threshold = max(0.18, strongest_pair * 0.65)
    strong_pairs = [pair for pair in pairs if pair[0] >= strong_threshold]
    state_count = 1 + min(4, len(strong_pairs))
    echo_strength = clamp01(strongest_pair)
    overlap_density = clamp01(float(np.mean(values[search] >= 0.16)) * 12.0)

    residual = values if temporal_baseline is None else np.maximum(
        values - temporal_baseline, 0.0
    )
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
        echo_offset_pixels = residual_pairs[0][1]
        state_separation = clamp01(
            echo_offset_pixels / max(math.hypot(surface["width"], surface["height"]), 1.0)
        )
    else:
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
            "motionCompensatedResidualMean": 0.0,
            "motionCompensatedResidualP90": 0.0,
            "motionCompensatedResidualCoverage": 0.0,
        }
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
            if affine is not None:
                matrix, step_scale, step_rotation, tx, ty, inlier_ratio = affine
                cumulative_scale *= step_scale
                cumulative_rotation += step_rotation
                semantic["scale"] = float(cumulative_scale)
                semantic["rotationDegrees"] = float(cumulative_rotation)
                residual_mean, residual_p90, active = motion_compensated_residual(
                    previous, gray, matrix
                )
                nonrigid = clamp01(
                    residual_mean * 2.4
                    + residual_p90 * 1.4
                    + (flow_residual / diagonal) * 3.0
                )
                semantic["distortionStrength"] = nonrigid
                # Residual coverage is recorded diagnostically, not mislabeled as
                # foreground occlusion. Occlusion requires a matte/depth cue.
                diagnostics["affineInlierRatio"] = inlier_ratio
                diagnostics["motionCompensatedResidualMean"] = residual_mean
                diagnostics["motionCompensatedResidualP90"] = residual_p90
                diagnostics["motionCompensatedResidualCoverage"] = active
            diagnostics["flowMeanPixels"] = mean_mag
            diagnostics["flowP90Pixels"] = p90_mag
            diagnostics["flowCoherence"] = coherence
            diagnostics["flowResidualP90Pixels"] = flow_residual
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
    parser.add_argument("--video", required=True)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-id", default="")
    parser.add_argument("--source-kind", choices=("REFERENCE", "RENDER"), required=True)
    parser.add_argument("--analysis-size", type=int, default=360)
    return parser.parse_args()


def main():
    args = parse_args()
    video_path = Path(args.video).resolve()
    output_path = Path(args.output).resolve()
    if not video_path.is_file():
        raise FileNotFoundError(video_path)
    if args.start < 0 or args.end <= args.start:
        raise ValueError("--end must be greater than --start and both must be non-negative.")
    if args.analysis_size < 96 or args.analysis_size > 720:
        raise ValueError("--analysis-size must be in [96, 720].")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame_dir = output_path.parent / f"{output_path.stem}-frames"
    frame_dir.mkdir(parents=True, exist_ok=True)

    fps, total, width, height, frames = read_window(
        video_path, args.start, args.end, args.analysis_size
    )
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
        "sourceId": args.source_id or video_path.stem,
        "sourceKind": args.source_kind,
        "sourceVideoSha256": sha256_file(video_path),
        "video": {
            "fps": fps,
            "frameCount": total,
            "width": width,
            "height": height,
        },
        "range": {
            "requestedStartSeconds": args.start,
            "requestedEndSeconds": args.end,
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
                "motion-compensated residual",
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
