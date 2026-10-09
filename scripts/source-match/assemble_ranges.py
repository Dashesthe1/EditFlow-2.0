"""Materialize only a saved, complete GPT-reviewed timestamp manifest. No AE writes."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

import av
import numpy as np


def fingerprint(file):
    p = Path(file).resolve()
    s = p.stat()
    h = hashlib.sha256(f"{p}|{s.st_size}|{s.st_mtime_ns}".encode())
    with p.open("rb") as f:
        for offset in [0, max(0, s.st_size // 2 - 32768), max(0, s.st_size - 65536)]:
            f.seek(offset)
            h.update(f.read(65536))
    return h.hexdigest()


def atomic_json(file, value):
    file = Path(file)
    temp = file.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as f:
        json.dump(value, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    temp.replace(file)


def pixels(frame):
    return frame.reformat(width=96, height=64, format="rgb24").to_ndarray().astype(float)


def frames(file, start=0, end=None):
    with av.open(str(file)) as c:
        s = c.streams.video[0]
        origin = float((s.start_time or 0) * s.time_base)
        if start:
            c.seek(max(0, int((origin + start - 1) / float(s.time_base))), stream=s, backward=True)
        times, first, last = [], None, None
        next_time = None
        for frame in c.decode(s):
            if frame.pts is None:
                raise ValueError("SOURCE_FRAME_PTS_REQUIRED")
            t = float(frame.pts * frame.time_base) - origin
            if t < start - .000002:
                continue
            if end is not None and t >= end - .000002:
                next_time = t
                break
            times.append(dict(time=t, pts=frame.pts, timeBase=str(frame.time_base)))
            if first is None:
                first = pixels(frame)
            last = pixels(frame)
        return times, first, last, next_time


def materialize(shot, source, directory, ffmpeg, encoder):
    started = time.monotonic()
    if fingerprint(source["path"]) != source["fingerprint"]:
        raise ValueError("SOURCE_CHANGED_SINCE_MATCH")
    start, end = shot["sourceStart"], shot["sourceEndExclusive"]
    if not 0 <= start < end <= source["duration"] + .000002:
        raise ValueError("INVALID_SAVED_SOURCE_RANGE")
    original, first, last, next_time = frames(source["path"], start, end)
    if not original or abs(original[0]["time"] - start) > .000002:
        raise ValueError("CUT_START_IS_NOT_THE_SAVED_SOURCE_FRAME")
    if next_time is not None and abs(next_time - end) > .000002:
        raise ValueError("CUT_END_IS_NOT_THE_SAVED_EXCLUSIVE_BOUNDARY")
    # AE's HEVC importer crashed on the real 10-bit fixture. Use editing codecs:
    # CPU ProRes preserves 10-bit precision; NVENC H.264 is explicitly 8-bit.
    extension = ".mp4" if encoder == "NVENC" else ".mov"
    target = Path(directory) / (shot["shotId"] + extension)
    temp = target.with_suffix(".partial" + extension)
    with av.open(source["path"]) as c:
        stream = c.streams.video[0]
        context = stream.codec_context
        colors = [v for flag, value in [("-color_primaries", context.color_primaries),
                  ("-color_trc", context.color_trc), ("-colorspace", context.colorspace),
                  ("-color_range", context.color_range)] if value and value != 2 for v in [flag, str(value)]]
    codec = (["-c:v", "h264_nvenc", "-preset", "p2", "-rc", "constqp", "-qp", "10",
              "-pix_fmt", "yuv420p"] if encoder == "NVENC" else
             ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-threads", "2"])
    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin"]
    if encoder == "NVENC":
        args += ["-hwaccel", "cuda"]
    args += ["-ss", f"{start:.9f}", "-i", source["path"], "-t", f"{end-start:.9f}",
             "-map", "0:v:0", "-map_metadata", "0", "-an", "-sn", "-dn", "-fps_mode", "passthrough",
             *codec, *colors, "-movflags", "+faststart", "-y", str(temp)]
    try:
        # Cache reuse still verifies actual frame count, timing, and endpoints.
        if not target.exists():
            result = subprocess.run(args, capture_output=True, timeout=240)
            if result.returncode:
                raise RuntimeError(result.stderr.decode(errors="replace")[-2000:])
            temp.replace(target)
        cut, cut_first, cut_last, _ = frames(target)
        if len(cut) != len(original):
            raise ValueError(f"CUT_FRAME_COUNT_MISMATCH: {len(cut)} versus {len(original)}")
        timing_error = max(abs((a["time"]-original[0]["time"])-(b["time"]-cut[0]["time"]))
                           for a, b in zip(original, cut))
        if timing_error > .0001:
            raise ValueError("CUT_FRAME_TIMING_CHANGED")
        pixel_error = max(float(np.mean(np.abs(first-cut_first))), float(np.mean(np.abs(last-cut_last))))
        if pixel_error > 10:
            raise ValueError("CUT_ENDPOINT_PIXELS_MISMATCH")
        if fingerprint(source["path"]) != source["fingerprint"]:
            raise ValueError("SOURCE_CHANGED_DURING_EXTRACTION")
        return dict(**shot, workingPath=str(target), clipOrigin=cut[0]["time"],
                    sourceFrames=original, frameCount=len(cut), frameTimingErrorSeconds=timing_error,
                    endpointPixelMeanError=pixel_error, workingFingerprint=fingerprint(target),
                    extractionSeconds=time.monotonic()-started, encoder=encoder,
                    workingCodec="H264_8BIT_QP10" if encoder == "NVENC" else "PRORES_422_HQ_10BIT")
    except Exception:
        temp.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        raise


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", required=True)
    p.add_argument("--ffmpeg", required=True)
    args = p.parse_args()
    file = Path(args.manifest)
    manifest = json.loads(file.read_text(encoding="utf-8"))
    assert manifest["schema"] == "editflow.official-source-timestamps.v1"
    if fingerprint(manifest["reference"]["path"]) != manifest["reference"]["fingerprint"]:
        raise ValueError("REFERENCE_CHANGED_SINCE_MATCH")
    directory = file.parent
    started = time.monotonic()
    sources = {s["path"]: s for s in manifest["sources"]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        # map returns results in Finished order, regardless of decoder completion.
        shots = list(pool.map(lambda shot: materialize(shot, sources[shot["sourcePath"]], directory,
                          args.ffmpeg, manifest["encoder"]), manifest["shots"]))
    atomic_json(directory / "materialized.json", dict(schema="editflow.source-assembly-media.v1", shots=shots,
                extractionSeconds=time.monotonic()-started, encoder=manifest["encoder"]))


if __name__ == "__main__":
    main()
