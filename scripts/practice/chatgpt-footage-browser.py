"""Mechanical footage access only: metadata and GPT-requested timestamps. No ranking."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np


def ffmpeg_path(value):
    if value:
        return value
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def metadata(video):
    cap = cv2.VideoCapture(video)
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
        height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not cap.isOpened() or fps <= 0 or count <= 0:
            raise ValueError("Could not read footage metadata")
        return dict(fps=fps, frameCount=int(count), width=int(width), height=int(height),
                    durationMs=count / fps * 1000)
    finally:
        cap.release()


def run(args):
    info = metadata(args.video)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if args.command == "metadata":
        digest = hashlib.sha256()
        with open(args.video, "rb") as source:
            for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
                digest.update(block)
        # Uniform identity samples protect duplicate-media/held-out gates. They
        # never produce shot candidates, similarity rankings or editorial choices.
        hashes = []
        cap = cv2.VideoCapture(args.video)
        try:
            for index in range(16):
                cap.set(cv2.CAP_PROP_POS_MSEC, info["durationMs"] * (index + .5) / 16)
                ok, frame = cap.read()
                if not ok:
                    continue
                gray = cv2.cvtColor(cv2.resize(frame, (64, 64), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
                gray = cv2.equalizeHist(gray)
                tiny = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
                bits = (tiny[:, 1:] > tiny[:, :-1]).flatten()
                value = 0
                for bit_index, bit in enumerate(bits):
                    value |= int(bit) << bit_index
                hashes.append("%016x" % value)
        finally:
            cap.release()
        if len(hashes) < 8:
            raise ValueError("Could not derive raw-media identity samples")
        result = dict(schema="editflow.practice-source-index.v1", sourceId=args.source_id,
                      sourcePath=args.video, sourceSha256=digest.hexdigest(), video=info,
                      perceptualSignature=",".join(hashes),
                      evidenceRefs=["raw-metadata-only:no-candidates"])
    else:
        times = json.loads(args.times_json)
        if (not isinstance(times, list) or not 1 <= len(times) <= 48
                or any(isinstance(t, bool) or not isinstance(t, (int, float))
                       or not math.isfinite(t) or t < 0 or t >= info["durationMs"] for t in times)):
            raise ValueError("Request 1–48 explicit in-bounds timestamps")
        frames = []
        tiles = []
        executable = ffmpeg_path(args.ffmpeg)
        def extract(item):
            index, time_ms = item
            target = output.parent / (output.stem + "-%03d.png" % index)
            if not target.exists():
                subprocess.run([executable, "-hide_banner", "-loglevel", "error", "-y",
                                "-ss", str(time_ms / 1000), "-threads", "2", "-i", args.video,
                                "-frames:v", "1", "-vf", "scale=%d:-2" % args.width,
                                "-threads", "1", "-an", str(target)], check=True, timeout=45,
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            pixels = cv2.imread(str(target))
            if pixels is None:
                raise ValueError("Frame extraction produced no pixels")
            return index, time_ms, target, pixels

        # Only decode explicitly requested moments. Bounded concurrency speeds up
        # long HEVC sources without a full-film proxy or any candidate generation.
        with ThreadPoolExecutor(max_workers=min(4, len(times))) as pool:
            extracted = list(pool.map(extract, enumerate(times)))
        for index, time_ms, target, pixels in extracted:
            frames.append(dict(timeMs=time_ms, path=str(target),
                               sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
            tile = np.zeros((204, 320, 3), dtype=np.uint8)
            h, w = pixels.shape[:2]
            scale = min(320 / w, 180 / h)
            resized = cv2.resize(pixels, (max(1, round(w * scale)), max(1, round(h * scale))))
            rh, rw = resized.shape[:2]
            tile[:rh, :rw] = resized
            label = "%03d | %02d:%02d:%06.3f" % (index, time_ms // 3600000,
                     (time_ms // 60000) % 60, (time_ms / 1000) % 60)
            cv2.putText(tile, label, (4, 197), cv2.FONT_HERSHEY_SIMPLEX, .45, (255, 255, 255), 1)
            tiles.append(tile)
        cols = min(4, len(tiles))
        sheet = np.zeros((math.ceil(len(tiles) / cols) * 204, cols * 320, 3), dtype=np.uint8)
        for index, tile in enumerate(tiles):
            row, col = divmod(index, cols)
            sheet[row * 204:(row + 1) * 204, col * 320:(col + 1) * 320] = tile
        sheet_path = str(output.with_suffix(".sheet.jpg"))
        if not cv2.imwrite(sheet_path, sheet):
            raise ValueError("Contact sheet could not be written")
        result = dict(schema="editflow.chatgpt-footage-inspection.v1", video=info,
                      frames=frames, contactSheetPath=sheet_path)
    temporary = str(output) + ".tmp-" + str(os.getpid())
    Path(temporary).write_text(json.dumps(result), encoding="utf8")
    os.replace(temporary, output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["metadata", "browse"])
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-id", default="")
    parser.add_argument("--times-json", default="[]")
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--ffmpeg", default="")
    args = parser.parse_args()
    if not 160 <= args.width <= 1920:
        parser.error("width must be 160–1920")
    run(args)
