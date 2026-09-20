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

    assert PROBE.PROBE_ALGORITHM_ID == "editflow.m6.dense-video-probe.v17"
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


def test_temporal_echo_baseline_rejects_transforming_source_texture():
    base = np.zeros((180, 240, 3), dtype=np.uint8)
    for x in range(12, 230, 23):
        cv2.line(base, (x, 8), (x, 172), (255, 255, 255), 3)
    for y in range(15, 170, 31):
        cv2.line(base, (8, y), (232, y), (80, 220, 80), 2)
    cv2.putText(
        base, "EF", (55, 112), cv2.FONT_HERSHEY_SIMPLEX,
        2.0, (220, 60, 220), 5, cv2.LINE_AA,
    )
    frames = []
    for index in range(24):
        scale = 1.0 + 0.012 * index
        matrix = cv2.getRotationMatrix2D((120, 90), 0.12 * index, scale)
        frame = cv2.warpAffine(
            base, matrix, (240, 180), borderMode=cv2.BORDER_REFLECT101,
        )
        frames.append((index, frame))

    analyzed = PROBE.analyze_frames(frames, 30.0)
    assert max(item["semantic"]["temporalStateCount"] for item in analyzed) == 1
    assert max(item["semantic"]["overlapDensity"] for item in analyzed) == 0.0
    assert max(item["semantic"]["stateSeparation"] for item in analyzed) == 0.0


def test_echo_baseline_guard_preserves_transient_fragmentation():
    first = np.zeros((180, 240, 3), dtype=np.uint8)
    cv2.rectangle(first, (20, 30), (95, 145), (255, 255, 255), -1)
    cv2.circle(first, (175, 85), 28, (30, 220, 80), -1)

    second = np.zeros((180, 240, 3), dtype=np.uint8)
    cv2.putText(
        second, "EF", (32, 120), cv2.FONT_HERSHEY_SIMPLEX,
        2.8, (255, 255, 255), 8, cv2.LINE_AA,
    )
    cv2.rectangle(second, (155, 28), (210, 152), (40, 200, 240), 5)
    shifted = cv2.warpAffine(
        second,
        np.float32([[1, 0, 42], [0, 1, 0]]),
        (240, 180),
    )
    fragmented = np.maximum(second, shifted)
    frames = [
        *[(index, first.copy()) for index in range(10)],
        (10, second.copy()),
        (11, second.copy()),
        (12, fragmented.copy()),
        (13, fragmented.copy()),
        *[(index, second.copy()) for index in range(14, 25)],
    ]

    analyzed = PROBE.analyze_frames(frames, 30.0)
    transition = analyzed[12:14]
    stable_destination = analyzed[14:]

    assert analyzed[10]["diagnostics"]["temporalEchoBaselineStartOffset"] == 14.0
    assert analyzed[10]["diagnostics"]["temporalEchoBaselineGuardFrames"] == 4.0
    assert min(item["semantic"]["temporalStateCount"] for item in transition) >= 2
    assert min(item["semantic"]["overlapDensity"] for item in transition) > 0.0
    assert max(item["semantic"]["temporalStateCount"] for item in stable_destination) == 1
    assert max(item["semantic"]["overlapDensity"] for item in stable_destination) == 0.0


def test_echo_metrics_fail_closed_when_only_subfloor_valid_pairs_remain():
    values = np.zeros((100, 100), dtype=np.float32)
    # The global residual peak is close to the autocorrelation center and is
    # therefore not a valid duplicate-state pair. A weaker valid off-center
    # residual survives the raw candidate threshold but remains below the
    # reliability floor. This must be identity evidence, not a crash or state.
    values[52, 50] = 0.04
    values[60, 50] = 0.03
    surface = {
        "values": values,
        "search": np.ones((100, 100), dtype=bool),
        "cy": 50,
        "cx": 50,
        "height": 100,
        "width": 100,
        "minPairRadius": 8.0,
    }

    states, strength, overlap, separation = PROBE.edge_echo_metrics(
        surface, np.zeros_like(values)
    )

    assert states == 1
    assert strength == 0.0
    assert overlap == 0.0
    assert separation == 0.0


def test_echo_metrics_are_resolution_normalized():
    def layered_frame(width, height, shift):
        base = np.zeros((height, width, 3), dtype=np.uint8)
        cv2.rectangle(
            base,
            (round(width * 0.08), round(height * 0.15)),
            (round(width * 0.34), round(height * 0.82)),
            (255, 255, 255),
            -1,
        )
        cv2.circle(
            base,
            (round(width * 0.72), round(height * 0.42)),
            round(min(width, height) * 0.12),
            (30, 220, 80),
            -1,
        )
        shifted = cv2.warpAffine(
            base,
            np.float32([[1, 0, shift], [0, 1, 0]]),
            (width, height),
        )
        return base, np.maximum(base, shifted)

    measurements = []
    for width, height, shift in ((360, 270, 42), (720, 540, 84)):
        base, fragmented = layered_frame(width, height, shift)
        baseline = PROBE.edge_echo_surface(PROBE.gray_u8(base))
        surface = PROBE.edge_echo_surface(PROBE.gray_u8(fragmented))
        assert baseline is not None and surface is not None
        measurements.append(PROBE.edge_echo_metrics(surface, baseline["values"]))

    low, high = measurements
    assert low[0] == high[0] == 2
    assert abs(low[1] - high[1]) < 0.01
    assert abs(low[2] - high[2]) < 0.01
    assert abs(low[3] - high[3]) < 1e-9


def test_transition_anchor_rejects_early_source_echo_but_keeps_near_cut_fragment():
    first = np.zeros((180, 240, 3), dtype=np.uint8)
    cv2.rectangle(first, (20, 30), (95, 145), (255, 255, 255), -1)
    cv2.circle(first, (175, 85), 28, (30, 220, 80), -1)
    first_shift = cv2.warpAffine(
        first, np.float32([[1, 0, 45], [0, 1, 0]]), (240, 180)
    )
    first_fragmented = np.maximum(first, first_shift)

    second = np.zeros((180, 240, 3), dtype=np.uint8)
    cv2.putText(
        second, "EF", (32, 120), cv2.FONT_HERSHEY_SIMPLEX,
        2.8, (255, 255, 255), 8, cv2.LINE_AA,
    )
    cv2.rectangle(second, (155, 28), (210, 152), (40, 200, 240), 5)
    second_shift = cv2.warpAffine(
        second, np.float32([[1, 0, 42], [0, 1, 0]]), (240, 180)
    )
    second_fragmented = np.maximum(second, second_shift)

    frames = [
        (0, first.copy()), (1, first.copy()),
        (2, first_fragmented.copy()), (3, first_fragmented.copy()),
        *[(index, first.copy()) for index in range(4, 10)],
        (10, second.copy()), (11, second.copy()),
        (12, second_fragmented.copy()), (13, second_fragmented.copy()),
        *[(index, second.copy()) for index in range(14, 25)],
    ]
    analyzed = PROBE.analyze_frames(frames, 30.0)

    assert analyzed[2]["diagnostics"]["temporalEchoRawStateCount"] >= 2
    assert analyzed[2]["diagnostics"]["temporalEchoMotionCorroborated"] == 1.0
    assert analyzed[2]["diagnostics"]["temporalEchoWithinTransitionAnchor"] == 0.0
    assert analyzed[2]["semantic"]["temporalStateCount"] == 1
    assert analyzed[12]["diagnostics"]["temporalEchoTransitionAnchorOffset"] == 10.0
    assert analyzed[12]["diagnostics"]["temporalEchoWithinTransitionAnchor"] == 1.0
    assert analyzed[12]["diagnostics"]["temporalEchoPromoted"] == 1.0
    assert analyzed[12]["semantic"]["temporalStateCount"] >= 2


def test_echo_separation_uses_nearest_strong_pair_not_distant_harmonic():
    values = np.zeros((100, 100), dtype=np.float32)
    values[60, 50] = 0.75
    values[80, 50] = 1.0
    surface = {
        "values": values,
        "search": np.ones((100, 100), dtype=bool),
        "cy": 50,
        "cx": 50,
        "height": 100,
        "width": 100,
        "minPairRadius": 8.0,
    }
    baseline = np.zeros_like(values)

    states, _strength, _overlap, separation = PROBE.edge_echo_metrics(
        surface, baseline
    )

    assert states == 3
    expected = 10.0 / np.hypot(100.0, 100.0)
    assert abs(separation - expected) < 1e-6


def test_echo_separation_keeps_near_reliable_copy_below_relative_peak_gate():
    values = np.zeros((100, 100), dtype=np.float32)
    values[60, 50] = 0.041
    values[75, 50] = 0.075
    surface = {
        "values": values,
        "search": np.ones((100, 100), dtype=bool),
        "cy": 50,
        "cx": 50,
        "height": 100,
        "width": 100,
        "minPairRadius": 8.0,
    }

    states, _strength, _overlap, separation = PROBE.edge_echo_metrics(
        surface, np.zeros_like(values)
    )

    assert states == 2
    expected = 10.0 / np.hypot(100.0, 100.0)
    assert abs(separation - expected) < 1e-6


if __name__ == "__main__":
    test_persistent_scene_change_is_a_shot_boundary()
    test_transient_warp_is_not_a_shot_boundary()
    test_analyzer_suppresses_cross_shot_motion_and_distortion()
    test_echo_baseline_is_segmented_at_persistent_shot_boundary()
    test_temporal_echo_baseline_rejects_transforming_source_texture()
    test_echo_baseline_guard_preserves_transient_fragmentation()
    test_echo_metrics_fail_closed_when_only_subfloor_valid_pairs_remain()
    test_echo_metrics_are_resolution_normalized()
    test_transition_anchor_rejects_early_source_echo_but_keeps_near_cut_fragment()
    test_echo_separation_uses_nearest_strong_pair_not_distant_harmonic()
    test_echo_separation_keeps_near_reliable_copy_below_relative_peak_gate()
    print("m6_dense_video_probe_test: PASS")
