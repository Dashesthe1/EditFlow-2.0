#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


SCHEMA = "editflow.m6.direct-ab-contact-sheet.v1"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build a normalized-phase direct A/B sheet from two dense probes."
    )
    parser.add_argument("--reference-probe-json", required=True)
    parser.add_argument("--render-probe-json", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--samples", type=int, default=7)
    parser.add_argument("--cell-size", type=int, default=220)
    return parser.parse_args()


def load_probe(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    frames = payload.get("frames")
    if not isinstance(frames, list) or len(frames) < 2:
        raise ValueError(f"Probe has insufficient frames: {path}")
    return payload, frames


def sampled_frames(frames, count):
    if count < 3 or count > 15:
        raise ValueError("--samples must be in [3, 15].")
    indices = np.linspace(0, len(frames) - 1, count)
    return [(int(round(index)), frames[int(round(index))]) for index in indices]


def fit_cell(image, size):
    height, width = image.shape[:2]
    if height <= 0 or width <= 0:
        raise ValueError("Invalid frame dimensions.")
    scale = min(size / width, size / height)
    resized = cv2.resize(
        image,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR,
    )
    canvas = np.zeros((size, size, 3), dtype=np.uint8)
    y = (size - resized.shape[0]) // 2
    x = (size - resized.shape[1]) // 2
    canvas[y:y + resized.shape[0], x:x + resized.shape[1]] = resized
    return canvas


def frame_cell(frame, phase, size):
    png_path = Path(frame["pngPath"])
    image = cv2.imread(str(png_path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(png_path)
    cell = fit_cell(image, size)
    cv2.putText(
        cell,
        f"{phase:.2f}",
        (8, size - 10),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )
    return cell


def row(label, frames, count, size, label_width=180):
    sampled = sampled_frames(frames, count)
    cells = []
    denominator = max(1, len(frames) - 1)
    for index, frame in sampled:
        cells.append(frame_cell(frame, index / denominator, size))
    strip = np.hstack(cells)
    label_cell = np.zeros((size, label_width, 3), dtype=np.uint8)
    cv2.putText(
        label_cell,
        label,
        (10, size // 2),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.62,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )
    return np.hstack([label_cell, strip])


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    args = parse_args()
    if args.cell_size < 120 or args.cell_size > 480:
        raise ValueError("--cell-size must be in [120, 480].")

    reference_probe, reference_frames = load_probe(args.reference_probe_json)
    render_probe, render_frames = load_probe(args.render_probe_json)
    reference_row = row("REFERENCE", reference_frames, args.samples, args.cell_size)
    render_row = row("EDITFLOW", render_frames, args.samples, args.cell_size)
    sheet = np.vstack([reference_row, render_row])

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output), sheet):
        raise RuntimeError(f"Could not write A/B sheet: {output}")

    result = {
        "schema": SCHEMA,
        "output": str(output),
        "sha256": sha256_file(output),
        "samples": args.samples,
        "referenceSourceId": reference_probe.get("sourceId"),
        "referenceSourceVideoSha256": reference_probe.get("sourceVideoSha256"),
        "renderSourceId": render_probe.get("sourceId"),
        "renderSourceVideoSha256": render_probe.get("sourceVideoSha256"),
    }
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
