from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def detect(path: Path) -> dict:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"could not read screenshot: {path}")
    height, width = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array([3, 110, 90]), np.array([25, 255, 255]))
    count, _labels, stats, centers = cv2.connectedComponentsWithStats(mask)
    candidates = []
    for index in range(1, count):
        x, y, w, h, area = map(int, stats[index])
        cx, cy = map(float, centers[index])
        if not (0.04 * width <= cx <= 0.27 * width and 0.22 * height <= cy <= 0.55 * height):
            continue
        if not (8 <= w <= 55 and 14 <= h <= 70 and 100 <= area <= 1200):
            continue
        candidates.append({"x": x, "y": y, "w": w, "h": h, "area": area, "cx": cx, "cy": cy})
    if len(candidates) != 1:
        return {"verified": False, "reason": f"expected exactly one bounded Mocha-orange target, found {len(candidates)}", "width": width, "height": height, "candidates": candidates}
    target = candidates[0]
    return {
        "verified": True,
        "reason": "one bounded Mocha-orange launch mark detected inside the verified Effect Controls region",
        "width": width,
        "height": height,
        "target": {"x": int(round(target["cx"])), "y": int(round(target["cy"])), "bbox": [target["x"], target["y"], target["x"] + target["w"], target["y"] + target["h"]], "area": target["area"]},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ground the proof-owned Mocha AE launch button from a fresh AE screenshot")
    parser.add_argument("--image", required=True)
    parser.add_argument("--result", required=True)
    args = parser.parse_args()
    result = detect(Path(args.image))
    result_path = Path(args.result)
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))
    return 0 if result.get("verified") else 2


if __name__ == "__main__":
    raise SystemExit(main())
