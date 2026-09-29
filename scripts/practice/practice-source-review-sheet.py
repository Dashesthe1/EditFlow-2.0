from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np


def _frame(video: str, time_ms: float, width: int) -> np.ndarray:
    cap = cv2.VideoCapture(str(Path(video).expanduser().resolve()))
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open video: {video}")
    try:
        cap.set(cv2.CAP_PROP_POS_MSEC, float(time_ms))
        ok, frame = cap.read()
        if not ok or frame is None:
            raise RuntimeError(f"Unable to decode {video} at {time_ms} ms")
    finally:
        cap.release()
    h, w = frame.shape[:2]
    scale = min(1.0, width / max(1, w))
    return cv2.resize(
        frame,
        (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
        interpolation=cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR,
    )


def _card(video: str, time_ms: float, label: str, width: int) -> np.ndarray:
    image = _frame(video, time_ms, width)
    label_h = 44
    card = np.zeros((image.shape[0] + label_h, width, 3), dtype=np.uint8)
    x = max(0, (width - image.shape[1]) // 2)
    card[label_h:, x:x + image.shape[1]] = image
    cv2.putText(card, label[:48], (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(card, f"{time_ms / 1000.0:.3f}s", (6, 37), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (220, 220, 220), 1, cv2.LINE_AA)
    return card


def _sample_times(item: dict, samples: int) -> list[float]:
    if "time_ms" in item:
        return [float(item["time_ms"])]
    start = float(item["start_ms"])
    end = float(item["end_ms"])
    if samples <= 1 or end <= start:
        return [(start + end) / 2.0]
    return np.linspace(start, end, samples).tolist()


def main() -> int:
    parser = argparse.ArgumentParser(description="Build direct-pixel multi-phase Finish/source review sheets.")
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    output_dir = Path(manifest["output_dir"]).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    cell_width = int(manifest.get("cell_width", 240))
    samples = max(1, min(3, int(manifest.get("samples_per_range", 2))))
    phases_per_sheet = max(1, min(8, int(manifest.get("phases_per_sheet", 4))))
    phases = list(manifest["phases"])
    outputs: list[str] = []

    for page_index in range(math.ceil(len(phases) / phases_per_sheet)):
        page_phases = phases[page_index * phases_per_sheet:(page_index + 1) * phases_per_sheet]
        rows = []
        for phase in page_phases:
            items = [("FINISH", phase["finish"])]
            items += [(str(candidate["source_id"]), candidate) for candidate in phase.get("candidates", [])]
            cards = []
            for label, item in items:
                for time_ms in _sample_times(item, samples):
                    cards.append(_card(item["video"], time_ms, label, cell_width))
            target_h = max(card.shape[0] for card in cards)
            normalized = []
            for card in cards:
                if card.shape[0] < target_h:
                    pad = np.zeros((target_h - card.shape[0], cell_width, 3), dtype=np.uint8)
                    card = np.vstack([card, pad])
                normalized.append(card)
            row = np.hstack(normalized)
            cv2.putText(
                row,
                str(phase["phase_id"])[:40],
                (8, target_h - 8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )
            rows.append(row)

        max_w = max(row.shape[1] for row in rows)
        padded_rows = []
        for row in rows:
            if row.shape[1] < max_w:
                row = np.hstack([row, np.zeros((row.shape[0], max_w - row.shape[1], 3), dtype=np.uint8)])
            padded_rows.append(row)
        sheet = np.vstack(padded_rows)
        output = output_dir / f"source-review-{page_index + 1:02d}.jpg"
        if not cv2.imwrite(str(output), sheet, [int(cv2.IMWRITE_JPEG_QUALITY), 93]):
            raise RuntimeError(f"Unable to write {output}")
        outputs.append(str(output))

    print(json.dumps({
        "schema": "editflow.practice-source-review-sheet.v1",
        "pixelEvidenceOnly": True,
        "classificationPerformed": False,
        "phaseCount": len(phases),
        "outputs": outputs,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
