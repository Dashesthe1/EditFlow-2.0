import importlib.util
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PROBE_PATH = ROOT / "scripts" / "proofs" / "m6-dense-video-probe.py"
SPEC = importlib.util.spec_from_file_location("m6_dense_video_probe", PROBE_PATH)
PROBE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(PROBE)


def scene_a():
    image = np.full((180, 240, 3), (18, 32, 48), dtype=np.uint8)
    for index in range(8):
        x = 12 + index * 27
        cv2.rectangle(image, (x, 18), (x + 13, 160), (210, 220 - index * 8, 80), 2)
    cv2.circle(image, (80, 92), 30, (40, 220, 220), -1)
    cv2.line(image, (0, 170), (239, 20), (245, 245, 245), 3)
    return image


def scene_b():
    image = np.full((180, 240, 3), (150, 38, 24), dtype=np.uint8)
    for index in range(7):
        y = 12 + index * 24
        cv2.line(image, (8, y), (232, y + 12), (30, 190, 90), 5)
    cv2.rectangle(image, (130, 38), (215, 145), (230, 220, 35), -1)
    cv2.circle(image, (52, 56), 24, (220, 40, 180), 4)
    return image


def test_persistent_scene_change_is_a_shot_boundary():
    previous = scene_a()
    current = scene_b()
    following = current.copy()

    metrics = PROBE.persistent_shot_boundary_metrics(previous, current, following)

    assert metrics["candidate"] is True
    assert metrics["entryFrameMae"] >= 0.075
    assert metrics["holdFrameMae"] <= 0.0125
    assert metrics["bridgeFrameMae"] >= metrics["entryFrameMae"] * 0.70
    assert metrics["entryHistogramDistance"] >= 0.10


def test_transient_warp_is_not_a_shot_boundary():
    previous = scene_a()
    matrix = cv2.getRotationMatrix2D((120, 90), 0.0, 1.0)
    matrix[0, 2] += 34
    current = cv2.warpAffine(
        previous, matrix, (240, 180), borderMode=cv2.BORDER_REFLECT101
    )
    following = previous.copy()

    metrics = PROBE.persistent_shot_boundary_metrics(previous, current, following)

    assert metrics["candidate"] is False
    assert metrics["bridgeFrameMae"] == 0.0


def test_analyzer_suppresses_cross_shot_motion_and_distortion():
    first = scene_a()
    second = scene_b()
    frames = [
        (0, first.copy()),
        (1, first.copy()),
        (2, second.copy()),
        (3, second.copy()),
        (4, second.copy()),
    ]

    analyzed = PROBE.analyze_frames(frames, 30.0)
    boundary = analyzed[2]

    assert PROBE.PROBE_ALGORITHM_ID == "editflow.m6.dense-video-probe.v12"
    assert boundary["semantic"]["shotBoundaryDiscontinuity"] is True
    assert boundary["diagnostics"]["shotBoundaryDiscontinuity"] == 1.0
    assert boundary["semantic"]["distortionStrength"] == 0.0
    assert boundary["semantic"]["displacement"] == {"x": 0.0, "y": 0.0}
    assert boundary["semantic"]["cameraMotion"] == {"x": 0.0, "y": 0.0}
    assert boundary["semantic"]["scale"] == analyzed[1]["semantic"]["scale"]
    assert boundary["semantic"]["rotationDegrees"] == analyzed[1]["semantic"]["rotationDegrees"]


def test_echo_baseline_is_segmented_at_persistent_shot_boundary():
    first = scene_a()
    second = scene_b()
    frames = [
        *[(index, first.copy()) for index in range(10)],
        *[(index + 10, second.copy()) for index in range(10)],
    ]

    analyzed = PROBE.analyze_frames(frames, 30.0)
    boundary = analyzed[10]
    destination = analyzed[10:]

    assert boundary["semantic"]["shotBoundaryDiscontinuity"] is True
    assert max(item["semantic"]["temporalStateCount"] for item in destination) == 1
    assert max(item["semantic"]["overlapDensity"] for item in destination) == 0.0
    assert max(item["semantic"]["stateSeparation"] for item in destination) == 0.0


if __name__ == "__main__":
    test_persistent_scene_change_is_a_shot_boundary()
    test_transient_warp_is_not_a_shot_boundary()
    test_analyzer_suppresses_cross_shot_motion_and_distortion()
    test_echo_baseline_is_segmented_at_persistent_shot_boundary()
    print("m6_dense_video_probe_test: PASS")
