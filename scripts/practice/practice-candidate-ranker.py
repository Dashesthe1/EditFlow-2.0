from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


FUNNEL = (
    ("COARSE", 160, 32),
    ("MID", 360, 8),
    ("FULL", 0, 2),
)


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    av = a.astype(np.float32).reshape(-1)
    bv = b.astype(np.float32).reshape(-1)
    if av.std() < 1e-6 or bv.std() < 1e-6:
        return 1.0 if np.allclose(av, bv) else 0.0
    return float(np.corrcoef(av, bv)[0, 1])


def _resize(image: np.ndarray, width: int) -> np.ndarray:
    if width <= 0 or image.shape[1] <= width:
        return image
    scale = width / image.shape[1]
    height = max(1, int(round(image.shape[0] * scale)))
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)


def _crop(image: np.ndarray, roi: dict | None) -> np.ndarray:
    if roi is None:
        return image
    h, w = image.shape[:2]
    x0 = max(0, min(w - 1, int(round(float(roi["x0"]) * w))))
    x1 = max(x0 + 1, min(w, int(round(float(roi["x1"]) * w))))
    y0 = max(0, min(h - 1, int(round(float(roi["y0"]) * h))))
    y1 = max(y0 + 1, min(h, int(round(float(roi["y1"]) * h))))
    return image[y0:y1, x0:x1]


def _pair_score(reference: np.ndarray, candidate: np.ndarray, width: int, roi: dict | None) -> dict:
    ref = _crop(_resize(reference, width), roi)
    cand = _crop(_resize(candidate, width), roi)
    if ref.shape[:2] != cand.shape[:2]:
        cand = cv2.resize(cand, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_AREA)
    diff = np.abs(ref.astype(np.float32) - cand.astype(np.float32))
    mae = float(diff.mean() / 255.0)
    ref_gray = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    cand_gray = cv2.cvtColor(cand, cv2.COLOR_BGR2GRAY)
    corr = _corr(ref_gray, cand_gray)
    ref_edge = cv2.Canny(ref_gray, 80, 160)
    cand_edge = cv2.Canny(cand_gray, 80, 160)
    edge_corr = _corr(ref_edge, cand_edge)
    luma_error = float(abs(float(ref_gray.mean()) - float(cand_gray.mean())) / 255.0)
    score = (
        0.35 * max(-1.0, min(1.0, corr))
        + 0.25 * max(-1.0, min(1.0, edge_corr))
        + 0.25 * (1.0 - min(1.0, mae))
        + 0.15 * (1.0 - min(1.0, luma_error))
    )
    return {
        "score": float(score),
        "mae": mae,
        "corr": corr,
        "edge_corr": edge_corr,
        "luma_error": luma_error,
    }


def _read_frames(paths: list[str]) -> list[np.ndarray]:
    frames = []
    for item in paths:
        image = cv2.imread(str(Path(item)))
        if image is None:
            raise FileNotFoundError(f"Could not read frame: {item}")
        frames.append(image)
    return frames


def _reference_frames(manifest: dict) -> list[np.ndarray]:
    paths = manifest.get("reference_frames")
    if paths:
        return _read_frames(paths)
    video_path = manifest.get("reference_video")
    times = manifest.get("times_seconds")
    if not video_path or not times:
        raise ValueError("Provide reference_frames or reference_video + times_seconds.")
    cap = cv2.VideoCapture(str(video_path))
    frames = []
    try:
        for value in times:
            cap.set(cv2.CAP_PROP_POS_MSEC, float(value) * 1000.0)
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError(f"Could not decode reference at {value}s")
            frames.append(frame)
    finally:
        cap.release()
    return frames


def _candidate_frames(candidate: dict) -> list[np.ndarray]:
    paths = candidate.get("frames")
    if not paths:
        directory = Path(candidate["dir"])
        paths = [str(path) for path in sorted(directory.glob(candidate.get("glob", "*.png")))]
    return _read_frames(paths)


def _score_candidate(reference: list[np.ndarray], candidate: list[np.ndarray], width: int, rois: list[dict]) -> dict:
    if len(reference) != len(candidate):
        raise ValueError("Candidate/reference frame counts differ.")
    regions: list[dict | None] = [None, *rois]
    weighted_scores = []
    detail = {}
    for region in regions:
        key = "full" if region is None else str(region.get("id", "roi"))
        weight = 1.0 if region is None else float(region.get("weight", 1.0))
        per_frame = [_pair_score(ref, cand, width, region) for ref, cand in zip(reference, candidate)]
        averaged = {name: float(np.mean([item[name] for item in per_frame])) for name in per_frame[0]}
        detail[key] = averaged
        weighted_scores.append((averaged["score"], weight))
    total_weight = sum(weight for _, weight in weighted_scores)
    score = sum(value * weight for value, weight in weighted_scores) / max(total_weight, 1e-9)
    return {"score": float(score), "regions": detail}


def _review_sheet(reference: list[np.ndarray], ranked: list[dict], candidate_frames: dict[str, list[np.ndarray]], output: Path) -> None:
    tile_width = 260
    rows = []
    for index, ref in enumerate(reference):
        images = [ref] + [candidate_frames[item["candidate_id"]][index] for item in ranked]
        tiles = []
        for image in images:
            tile = _resize(image, tile_width)
            if tile.shape[1] != tile_width:
                tile = cv2.resize(tile, (tile_width, tile.shape[0]))
            tiles.append(tile)
        target_h = min(tile.shape[0] for tile in tiles)
        tiles = [cv2.resize(tile, (tile_width, target_h)) for tile in tiles]
        row = np.hstack(tiles)
        labels = ["REFERENCE", *[item["candidate_id"] for item in ranked]]
        for col, label in enumerate(labels):
            cv2.putText(row, label, (col * tile_width + 8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
        rows.append(row)
    cv2.imwrite(str(output), np.vstack(rows), [int(cv2.IMWRITE_JPEG_QUALITY), 94])


def run(manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output_dir = Path(manifest.get("output_dir") or manifest_path.parent / "candidate-ranking")
    output_dir.mkdir(parents=True, exist_ok=True)
    reference = _reference_frames(manifest)
    rois = list(manifest.get("rois") or [])
    candidates = {item["id"]: item for item in manifest["candidates"]}
    if len(candidates) != len(manifest["candidates"]) or not candidates:
        raise ValueError("Candidates must have unique IDs and cannot be empty.")
    survivors = list(candidates)
    stages = []
    for stage_id, width, limit in FUNNEL:
        scored = []
        for candidate_id in survivors:
            frames = _candidate_frames(candidates[candidate_id])
            metrics = _score_candidate(reference, frames, width, rois)
            scored.append({"candidate_id": candidate_id, **metrics})
        scored.sort(key=lambda item: item["score"], reverse=True)
        survivors = [item["candidate_id"] for item in scored[: min(limit, len(scored))]]
        stages.append({"stage": stage_id, "width": width, "results": scored, "survivors": survivors})
    full_results = stages[-1]["results"]
    top_k = max(1, int(manifest.get("top_k", 3)))
    top = full_results[: min(top_k, len(full_results))]
    review_frames = {item["candidate_id"]: _candidate_frames(candidates[item["candidate_id"]]) for item in top}
    _review_sheet(reference, top, review_frames, output_dir / "review.jpg")
    result = {
        "schema": "editflow.practice-candidate-ranking.v1",
        "authority": "NON_AUTHORITATIVE_SEARCH_ONLY",
        "manifest": str(manifest_path.resolve()),
        "stages": stages,
        "top_candidates": top,
        "review_sheet": str((output_dir / "review.jpg").resolve()),
    }
    (output_dir / "ranking.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Rank temporary Practice candidates through a progressive-fidelity search funnel.")
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    result = run(args.manifest)
    print(json.dumps({
        "authority": result["authority"],
        "top_candidates": [item["candidate_id"] for item in result["top_candidates"]],
        "review_sheet": result["review_sheet"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
