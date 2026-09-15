import argparse
import json
import math
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    args = parser.parse_args()
    try:
        import cv2

        capture = cv2.VideoCapture(args.source)
        if not capture.isOpened():
            raise RuntimeError("SOURCE_OPEN_FAILED")
        try:
            frame_rate = float(capture.get(cv2.CAP_PROP_FPS))
            frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        finally:
            capture.release()
        if not math.isfinite(frame_rate) or frame_rate <= 0:
            raise RuntimeError("SOURCE_FRAME_RATE_INVALID")
        if frame_count <= 0 or width <= 0 or height <= 0:
            raise RuntimeError("SOURCE_MEDIA_METADATA_INVALID")
        print(json.dumps({
            "status": "COMPLETED",
            "frameRate": frame_rate,
            "frameCount": frame_count,
            "width": width,
            "height": height,
        }, separators=(",", ":")))
        return 0
    except Exception as error:
        print(json.dumps({"status": "REFUSED", "detail": str(error)}, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    sys.exit(main())
