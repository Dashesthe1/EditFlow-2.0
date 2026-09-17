from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


def make_base(width: int, height: int) -> np.ndarray:
    rng = np.random.default_rng(230517)
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    tile = 32
    for y in range(0, height, tile):
        for x in range(0, width, tile):
            value = 55 if ((x // tile) + (y // tile)) % 2 == 0 else 185
            frame[y : y + tile, x : x + tile] = (value, 255 - value, 110)
    noise = rng.integers(0, 56, size=frame.shape, dtype=np.uint8)
    frame = cv2.add(frame, noise)
    for index in range(48):
        x = int(rng.integers(18, width - 18))
        y = int(rng.integers(18, height - 18))
        radius = int(rng.integers(3, 10))
        color = tuple(int(v) for v in rng.integers(30, 245, size=3))
        cv2.circle(frame, (x, y), radius, color, -1, cv2.LINE_AA)
    return frame


def write_clip(output: Path, width: int, height: int, fps: int, frames: int) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"MJPG")
    writer = cv2.VideoWriter(str(output), fourcc, float(fps), (width, height))
    if not writer.isOpened():
        raise RuntimeError("OpenCV could not open deterministic MJPG AVI writer")
    base = make_base(width, height)
    try:
        for index in range(frames):
            dx = float(index) * 1.4
            dy = float(index) * 0.55
            matrix = np.float32([[1.0, 0.0, dx], [0.0, 1.0, dy]])
            frame = cv2.warpAffine(base, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
            cx = int(width * 0.63 + index * 0.35)
            cy = int(height * 0.43 + index * 0.15)
            cv2.rectangle(frame, (cx - 58, cy - 42), (cx + 58, cy + 42), (245, 245, 245), 3, cv2.LINE_AA)
            cv2.line(frame, (cx - 52, cy), (cx + 52, cy), (10, 10, 10), 2, cv2.LINE_AA)
            cv2.line(frame, (cx, cy - 36), (cx, cy + 36), (10, 10, 10), 2, cv2.LINE_AA)
            writer.write(frame)
    finally:
        writer.release()
    if not output.exists() or output.stat().st_size < 10_000:
        raise RuntimeError("Synthetic Mocha proof source was not materialized")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=360)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--frames", type=int, default=90)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    result = Path(args.result).resolve()
    write_clip(output, args.width, args.height, args.fps, args.frames)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    payload = {
        "ok": True,
        "sourcePath": str(output),
        "sha256": digest,
        "width": args.width,
        "height": args.height,
        "fps": args.fps,
        "frames": args.frames,
        "bytes": output.stat().st_size,
        "generator": "OPENCV_MJPG_DETERMINISTIC_V1",
    }
    result.parent.mkdir(parents=True, exist_ok=True)
    result.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
