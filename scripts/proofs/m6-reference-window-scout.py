#!/usr/bin/env python3
import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np


SCOUT_ALGORITHM_ID = "editflow.m6.reference-window-scout.v1"


def clamp01(value):
    return float(min(1.0, max(0.0, value)))


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


def robust_z(values):
    values = np.asarray(values, dtype=np.float64)
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    scale = max(1e-6, mad * 1.4826)
    return np.clip((values - median) / scale, 0.0, 8.0)


def analyze_step(previous_gray, current_frame):
    gray = cv2.cvtColor(current_frame, cv2.COLOR_BGR2GRAY)
    diff = float(np.mean(cv2.absdiff(previous_gray, gray)) / 255.0)
    flow = cv2.calcOpticalFlowFarneback(
        previous_gray, gray, None, 0.5, 3, 15, 3, 5, 1.1, 0
    )
    dx = flow[..., 0]
    dy = flow[..., 1]
    magnitude = np.sqrt(dx * dx + dy * dy)
    diagonal = max(1.0, math.hypot(gray.shape[1], gray.shape[0]))
    motion = float(np.percentile(magnitude, 90) / diagonal)
    median_dx = float(np.median(dx))
    median_dy = float(np.median(dy))
    residual = np.sqrt((dx - median_dx) ** 2 + (dy - median_dy) ** 2)
    nonrigid = float(np.percentile(residual, 90) / diagonal)
    laplacian = cv2.Laplacian(gray, cv2.CV_32F)
    sharpness = float(np.var(laplacian) / (255.0 * 255.0))
    b, g, r = cv2.split(current_frame.astype(np.float32) / 255.0)
    chromatic = float(
        (np.mean(np.abs(r - g)) + np.mean(np.abs(g - b)) + np.mean(np.abs(r - b)))
        / 3.0
    )
    edges = cv2.Canny(gray, 60, 150)
    edge_density = float(np.mean(edges > 0))
    return gray, {
        "frameDifference": diff,
        "motionP90Normalized": motion,
        "nonrigidP90Normalized": nonrigid,
        "sharpness": sharpness,
        "chromaticSeparationProxy": chromatic,
        "edgeDensity": edge_density,
    }


def parse_args():
    parser = argparse.ArgumentParser(
        description="Cheap full-video scout for high-information M6 reference windows."
    )
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--analysis-size", type=int, default=240)
    parser.add_argument("--sample-step", type=int, default=1)
    parser.add_argument("--window-seconds", type=float, default=0.8)
    parser.add_argument("--top", type=int, default=12)
    parser.add_argument("--min-separation-seconds", type=float, default=0.65)
    return parser.parse_args()


def main():
    args = parse_args()
    video_path = Path(args.video).resolve()
    output_path = Path(args.output).resolve()
    if not video_path.is_file():
        raise FileNotFoundError(video_path)
    if args.analysis_size < 96 or args.analysis_size > 480:
        raise ValueError("--analysis-size must be in [96, 480].")
    if args.sample_step < 1 or args.top < 1:
        raise ValueError("--sample-step and --top must be positive.")
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if not math.isfinite(fps) or fps <= 0 or total < 2:
        raise RuntimeError("Video metadata is invalid.")

    samples = []
    previous_gray = None
    frame_index = -1
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frame_index += 1
        if frame_index % args.sample_step:
            continue
        frame = resize_for_analysis(frame, args.analysis_size)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if previous_gray is not None:
            gray, metrics = analyze_step(previous_gray, frame)
            samples.append({
                "frameIndex": frame_index,
                "timeSeconds": frame_index / fps,
                **metrics,
            })
        previous_gray = gray
    capture.release()
    if len(samples) < 3:
        raise RuntimeError("Not enough sampled frames to scout.")

    metric_names = (
        "frameDifference",
        "motionP90Normalized",
        "nonrigidP90Normalized",
        "chromaticSeparationProxy",
    )
    z = {
        name: robust_z([sample[name] for sample in samples])
        for name in metric_names
    }
    sharpness_values = np.asarray([sample["sharpness"] for sample in samples])
    blur_change = np.abs(np.diff(sharpness_values, prepend=sharpness_values[0]))
    blur_z = robust_z(blur_change)
    for index, sample in enumerate(samples):
        # Scene-cut difference is useful but deliberately underweighted; compound
        # motion/non-rigid/optical behavior should outrank a plain hard cut.
        sample["scoutScore"] = float(
            0.15 * z["frameDifference"][index]
            + 0.28 * z["motionP90Normalized"][index]
            + 0.32 * z["nonrigidP90Normalized"][index]
            + 0.15 * z["chromaticSeparationProxy"][index]
            + 0.10 * blur_z[index]
        )

    ranked = sorted(samples, key=lambda item: item["scoutScore"], reverse=True)
    selected = []
    for item in ranked:
        if any(
            abs(item["timeSeconds"] - prior["timeSeconds"])
            < args.min_separation_seconds
            for prior in selected
        ):
            continue
        half = args.window_seconds / 2.0
        selected.append({
            **item,
            "windowStartSeconds": max(0.0, item["timeSeconds"] - half),
            "windowEndSeconds": min(total / fps, item["timeSeconds"] + half),
        })
        if len(selected) >= args.top:
            break

    payload = {
        "schema": "editflow.m6.reference-window-scout.v1",
        "algorithmId": SCOUT_ALGORITHM_ID,
        "authority": "SCOUT_ONLY_NOT_FIDELITY_EVIDENCE",
        "video": {
            "path": str(video_path),
            "fps": fps,
            "frameCount": total,
            "durationSeconds": total / fps,
        },
        "settings": {
            "analysisSize": args.analysis_size,
            "sampleStep": args.sample_step,
            "windowSeconds": args.window_seconds,
            "top": args.top,
            "minSeparationSeconds": args.min_separation_seconds,
        },
        "rankedWindows": selected,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True),
        encoding="utf-8",
        newline="\n",
    )
    print(json.dumps({
        "ok": True,
        "output": str(output_path),
        "topWindows": [
            {
                "timeSeconds": round(item["timeSeconds"], 3),
                "score": round(item["scoutScore"], 3),
                "start": round(item["windowStartSeconds"], 3),
                "end": round(item["windowEndSeconds"], 3),
            }
            for item in selected
        ],
    }))


if __name__ == "__main__":
    main()
