import importlib.util
import math
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "practice_media_match",
    ROOT / "scripts" / "practice" / "practice-media-match.py",
)
matcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(matcher)


class PracticeMediaMatchGeometryTests(unittest.TestCase):
    def test_identity_cache_rejects_stale_entry_for_different_frame(self):
        target = np.zeros((8, 8, 3), dtype=np.uint8)
        other = np.ones((8, 8, 3), dtype=np.uint8)
        cache = {
            id(target): (matcher.weakref.ref(other), "poisoned"),
        }
        self.assertIsNone(matcher.identity_cache_get(cache, target))
        self.assertNotIn(id(target), cache)

    def test_incomplete_knn_neighbors_do_not_crash(self):
        descriptor = {
            "dct": [1.0],
            "edgeDct": [1.0],
            "hsv": [1.0],
            "dhash": "0000000000000000",
        }
        sift = np.ones((4, 128), dtype=np.float32)
        original_cached = matcher.cached_features
        original_bf = matcher.cv2.BFMatcher

        class FakeMatcher:
            def knnMatch(self, _left, _right, k=2):
                self.assert_k = k
                return [[object()], [object()], [object()], [object()]]

        try:
            matcher.cached_features = lambda _frame: (descriptor, [], sift)
            matcher.cv2.BFMatcher = lambda _norm: FakeMatcher()
            evidence = matcher.feature_match_evidence(
                np.zeros((8, 8, 3), dtype=np.uint8),
                np.zeros((8, 8, 3), dtype=np.uint8),
            )
        finally:
            matcher.cached_features = original_cached
            matcher.cv2.BFMatcher = original_bf

        self.assertEqual(evidence["goodMatchCount"], 0)
        self.assertEqual(evidence["inlierCount"], 0)
        self.assertEqual(evidence["geometrySupport"], 0.0)
        self.assertGreater(evidence["score"], 0.0)

    def test_candidate_rank_requires_repeated_geometry(self):
        weak = {
            "score": 0.60,
            "geometricProof": {
                "strongAnchorCount": 1,
                "strongAnchorFraction": 1.0,
                "meanSupport": 1.0,
            },
        }
        strong = {
            "score": 0.60,
            "geometricProof": {
                "strongAnchorCount": 2,
                "strongAnchorFraction": 1.0,
                "meanSupport": 1.0,
            },
        }
        self.assertEqual(matcher.candidate_rank_score(weak), 0.60)
        self.assertGreater(matcher.candidate_rank_score(strong), 0.60)

    def test_confidence_only_reaches_exact_scene_range_with_repeated_geometry(self):
        base_mapping = {
            "appearance": 0.62,
            "score": 0.65,
            "consistency": 0.90,
            "geometricProof": {
                "strongAnchorCount": 0,
                "strongAnchorFraction": 0.0,
                "meanSupport": 0.0,
            },
        }
        weak = matcher.confidence_from_result({"mapping": base_mapping}, 0.40)
        strong_mapping = {
            **base_mapping,
            "geometricProof": {
                "strongAnchorCount": 3,
                "strongAnchorFraction": 1.0,
                "meanSupport": 0.98,
            },
        }
        strong = matcher.confidence_from_result({"mapping": strong_mapping}, 0.40)
        self.assertLess(weak, 0.95)
        self.assertGreater(strong, weak)
        self.assertGreaterEqual(strong, 0.95)

    def test_high_appearance_without_repeated_geometry_stays_below_exact_gate(self):
        mapping = {
            "appearance": 0.99,
            "score": 0.99,
            "consistency": 0.99,
            "geometricProof": {
                "strongAnchorCount": 1,
                "strongAnchorFraction": 0.25,
                "meanSupport": 0.95,
            },
        }
        confidence = matcher.confidence_from_result({"mapping": mapping}, 0.10)
        self.assertLess(confidence, 0.95)

    def test_near_tied_source_hypotheses_stay_below_exact_scene_confidence(self):
        mapping = {
            "appearance": 0.99,
            "score": 0.99,
            "consistency": 0.99,
            "geometricProof": {
                "strongAnchorCount": 3,
                "strongAnchorFraction": 1.0,
                "meanSupport": 0.98,
            },
        }
        winner_score = matcher.candidate_rank_score(mapping)
        ambiguous = matcher.confidence_from_result(
            {"mapping": mapping},
            winner_score - 0.01,
        )
        distinct = matcher.confidence_from_result(
            {"mapping": mapping},
            winner_score - 0.04,
        )
        self.assertLess(ambiguous, 0.95)
        self.assertGreaterEqual(distinct, 0.95)

    def test_full_geometry_reranks_a_provisional_winner_that_drops_below_runner_up(self):
        def item(source_id, sample_ms, center_ms, score, support):
            return {
                "index": {
                    "sourceId": source_id,
                    "analysis": {"sampleStepMs": 250.0},
                },
                "sample": {"timeMs": float(sample_ms)},
                "mapping": {
                    "score": float(score),
                    "centerSourceMs": float(center_ms),
                    "geometricProof": {
                        "strongAnchorCount": 3,
                        "strongAnchorFraction": 1.0,
                        "meanSupport": float(support),
                    },
                },
            }

        provisional = item("source-a", 100.0, 100.0, 0.72, 1.0)
        runner_up = item("source-b", 200.0, 200.0, 0.75, 0.75)
        original = matcher.mapping_geometric_proof

        def full_proof(
            _shot,
            mapping,
            _reference_reader,
            _source_reader,
            max_anchors=None,
            normalize_for_effects=False,
        ):
            self.assertIsNone(max_anchors)
            self.assertFalse(normalize_for_effects)
            if float(mapping["centerSourceMs"]) == 100.0:
                return {
                    "anchorCount": 6,
                    "strongAnchorCount": 0,
                    "strongAnchorFraction": 0.0,
                    "meanSupport": 0.10,
                }
            return {
                "anchorCount": 6,
                "strongAnchorCount": 6,
                "strongAnchorFraction": 1.0,
                "meanSupport": 0.95,
            }

        try:
            matcher.mapping_geometric_proof = full_proof
            ordered = matcher.finalize_candidate_geometry(
                {"shotId": "shot:test"},
                [provisional, runner_up],
                object(),
                {"source-a": object(), "source-b": object()},
            )
        finally:
            matcher.mapping_geometric_proof = original

        self.assertEqual(ordered[0]["index"]["sourceId"], "source-b")
        best = ordered[0]
        second = matcher.distinct_second_result(ordered, best)
        self.assertIsNotNone(second)
        self.assertGreaterEqual(
            matcher.candidate_rank_score(best["mapping"]),
            matcher.candidate_rank_score(second["mapping"]),
        )

    def test_rescue_finalist_receives_full_effect_normalized_geometry(self):
        rescue = {
            "index": {
                "sourceId": "source-a",
                "analysis": {"sampleStepMs": 250.0},
            },
            "sample": {"timeMs": 100.0},
            "mapping": {
                "score": 0.86,
                "appearance": 0.78,
                "consistency": 0.92,
                "slope": 1.0,
                "centerSourceMs": 100.0,
                "rescueScore": 0.86,
                "geometricProof": {
                    "anchorCount": 3,
                    "strongAnchorCount": 2,
                    "strongAnchorFraction": 2.0 / 3.0,
                    "meanSupport": 0.82,
                },
            },
        }
        original = matcher.mapping_geometric_proof
        calls = []

        def full_proof(
            _shot,
            _mapping,
            _reference_reader,
            _source_reader,
            max_anchors=None,
            normalize_for_effects=False,
        ):
            self.assertIsNone(max_anchors)
            calls.append(normalize_for_effects)
            return {
                "anchorCount": 6,
                "strongAnchorCount": 4,
                "strongAnchorFraction": 4.0 / 6.0,
                "meanSupport": 0.84,
            }

        try:
            matcher.mapping_geometric_proof = full_proof
            ordered = matcher.finalize_candidate_geometry(
                {"shotId": "shot:rescue"},
                [rescue],
                object(),
                {"source-a": object()},
            )
        finally:
            matcher.mapping_geometric_proof = original

        self.assertEqual(calls, [True])
        proof = ordered[0]["mapping"]["geometricProof"]
        self.assertEqual(proof["anchorCount"], 6)
        self.assertEqual(proof["strongAnchorCount"], 4)

    def test_continuity_prior_requires_verified_previous_scene_identity(self):
        weak_geometry = {
            "confidence": 0.99,
            "geometricProof": {
                "strongAnchorCount": 0,
                "strongAnchorFraction": 0.0,
                "meanSupport": 0.0,
                "maximumInlierCount": 0,
            },
        }
        low_confidence = {
            "confidence": 0.79,
            "geometricProof": {
                "strongAnchorCount": 3,
                "strongAnchorFraction": 0.75,
                "meanSupport": 0.80,
                "maximumInlierCount": 12,
            },
        }
        verified = {
            "confidence": 0.90,
            "geometricProof": {
                "strongAnchorCount": 2,
                "strongAnchorFraction": 0.50,
                "meanSupport": 0.60,
                "maximumInlierCount": 8,
            },
        }
        self.assertFalse(matcher.scene_identity_verified(weak_geometry))
        self.assertFalse(matcher.scene_identity_verified(low_confidence))
        self.assertTrue(matcher.scene_identity_verified(verified))

class PracticeGeometricRescuePathTests(unittest.TestCase):
    @staticmethod
    def _ev(support, feature=0.75, inliers=8):
        return {
            "geometrySupport": float(support),
            "score": float(feature),
            "inlierCount": int(inliers),
            "inlierRatio": 0.75,
            "referenceCoverage": 0.08,
            "sourceCoverage": 0.08,
        }

    def test_coherent_path_beats_scrambled_peak_hits(self):
        anchors = [
            {"timeMs": 0.0},
            {"timeMs": 500.0},
            {"timeMs": 1000.0},
        ]
        times = [0.0, 250.0, 500.0, 750.0, 1000.0]
        low = self._ev(0.10, feature=0.40, inliers=2)
        matrix = [[dict(low) for _ in times] for _ in anchors]
        matrix[0][0] = self._ev(0.86)
        matrix[1][2] = self._ev(0.88)
        matrix[2][4] = self._ev(0.90)
        matrix[0][4] = self._ev(0.99)
        matrix[1][0] = self._ev(0.99)
        matrix[2][1] = self._ev(0.99)

        result = matcher.solve_geometric_rescue_path(
            anchors,
            times,
            matrix,
            1.0,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["pathTimes"], [0.0, 500.0, 1000.0])
        self.assertEqual(result["strongAnchorCount"], 3)
        self.assertLess(result["residualMs"], 1.0)
        self.assertAlmostEqual(result["slope"], 1.0, places=3)

    def test_reverse_path_is_supported(self):
        anchors = [
            {"timeMs": 0.0},
            {"timeMs": 500.0},
            {"timeMs": 1000.0},
        ]
        times = [0.0, 500.0, 1000.0]
        low = self._ev(0.05, feature=0.30, inliers=1)
        matrix = [[dict(low) for _ in times] for _ in anchors]
        matrix[0][2] = self._ev(0.92)
        matrix[1][1] = self._ev(0.91)
        matrix[2][0] = self._ev(0.90)
        result = matcher.solve_geometric_rescue_path(
            anchors,
            times,
            matrix,
            -1.0,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["pathTimes"], [1000.0, 500.0, 0.0])
        self.assertLess(result["slope"], 0.0)
        self.assertEqual(result["strongAnchorCount"], 3)


class PracticeGeometricRescueCertificationTests(unittest.TestCase):
    @staticmethod
    def _mapping(strong=3, rescue_score=0.86):
        return {
            "appearance": 0.90,
            "score": 0.90,
            "consistency": 1.0,
            "geometricProof": {
                "anchorCount": 3,
                "strongAnchorCount": strong,
                "strongAnchorFraction": strong / 3.0,
                "meanSupport": 0.90,
                "minimumSupport": 0.82,
                "maximumInlierCount": 18,
                "meanInlierRatio": 0.80,
                "meanCoverage": 0.12,
            },
            "rescueScore": rescue_score,
        }

    def test_rescue_needs_three_strong_anchors(self):
        confidence = matcher.confidence_from_result(
            {"mapping": self._mapping(strong=2)},
            0.70,
        )
        self.assertLess(confidence, 0.95)

    def test_rescue_needs_minimum_score(self):
        confidence = matcher.confidence_from_result(
            {"mapping": self._mapping(rescue_score=0.81)},
            0.70,
        )
        self.assertLess(confidence, 0.95)

    def test_rescue_needs_source_uniqueness_margin(self):
        mapping = self._mapping()
        runner = matcher.candidate_rank_score(mapping) - 0.04
        confidence = matcher.confidence_from_result(
            {"mapping": mapping},
            runner,
        )
        self.assertLess(confidence, 0.95)

    def test_certified_rescue_can_cross_exact_scene_gate(self):
        mapping = self._mapping()
        runner = matcher.candidate_rank_score(mapping) - 0.12
        confidence = matcher.confidence_from_result(
            {"mapping": mapping},
            runner,
        )
        self.assertGreaterEqual(confidence, 0.95)

    def test_subcertification_rescue_cannot_seed_continuity(self):
        mapping = self._mapping()
        match = {
            "confidence": 0.949,
            "selectionMode": "GEOMETRIC_RESCUE",
            "geometricProof": mapping["geometricProof"],
        }
        self.assertFalse(matcher.scene_identity_verified(match))
        match["confidence"] = 0.96
        self.assertTrue(matcher.scene_identity_verified(match))


class PracticeEffectTolerantEvidenceTests(unittest.TestCase):
    @staticmethod
    def _evidence(support, inliers, ratio, score):
        return {
            "geometrySupport": float(support),
            "inlierCount": int(inliers),
            "inlierRatio": float(ratio),
            "score": float(score),
            "referenceCoverage": 0.08,
            "sourceCoverage": 0.08,
        }

    @staticmethod
    def _synthetic_scene(seed):
        rng = np.random.default_rng(seed)
        frame = np.zeros((360, 640, 3), dtype=np.uint8)
        for _ in range(180):
            x = int(rng.integers(12, 628))
            y = int(rng.integers(12, 348))
            radius = int(rng.integers(2, 10))
            color = tuple(int(value) for value in rng.integers(40, 255, size=3))
            matcher.cv2.circle(frame, (x, y), radius, color, -1)
        for _ in range(35):
            start = (int(rng.integers(0, 640)), int(rng.integers(0, 360)))
            end = (int(rng.integers(0, 640)), int(rng.integers(0, 360)))
            matcher.cv2.line(frame, start, end, (255, 255, 255), 2)
        return frame

    def test_softened_variant_can_strengthen_weak_effect_treated_geometry(self):
        weak = self._evidence(0.52, 5, 0.50, 0.66)
        strong = self._evidence(0.86, 12, 0.72, 0.81)
        originals = (
            matcher.normalized_rescue_frame,
            matcher.softened_rescue_frame,
            matcher.feature_match_evidence,
        )
        try:
            matcher.normalized_rescue_frame = lambda frame: ("base", frame)
            matcher.softened_rescue_frame = lambda frame: ("soft", frame)
            matcher.feature_match_evidence = lambda ref, _src: (
                strong if ref[0] == "soft" else weak
            )
            result = matcher.effect_tolerant_feature_match_evidence("ref", "src")
        finally:
            (
                matcher.normalized_rescue_frame,
                matcher.softened_rescue_frame,
                matcher.feature_match_evidence,
            ) = originals

        self.assertIs(result, strong)

    def test_strong_base_geometry_skips_softened_fallback(self):
        strong = self._evidence(0.84, 10, 0.68, 0.82)
        originals = (
            matcher.normalized_rescue_frame,
            matcher.softened_rescue_frame,
            matcher.feature_match_evidence,
        )
        softened_calls = []
        try:
            matcher.normalized_rescue_frame = lambda frame: ("base", frame)
            matcher.softened_rescue_frame = lambda frame: softened_calls.append(frame)
            matcher.feature_match_evidence = lambda _ref, _src: strong
            result = matcher.effect_tolerant_feature_match_evidence("ref", "src")
        finally:
            (
                matcher.normalized_rescue_frame,
                matcher.softened_rescue_frame,
                matcher.feature_match_evidence,
            ) = originals

        self.assertIs(result, strong)
        self.assertEqual(softened_calls, [])

    def test_low_contrast_fallback_requires_certifiable_geometry(self):
        weak = self._evidence(0.50, 4, 0.40, 0.64)
        rescue = self._evidence(0.79, 9, 0.64, 0.78)
        originals = (
            matcher.normalized_rescue_frame,
            matcher.softened_rescue_frame,
            matcher.feature_match_evidence,
            matcher.low_contrast_feature_match_evidence,
        )
        low_calls = []
        try:
            matcher.normalized_rescue_frame = lambda frame: ("base", frame)
            matcher.softened_rescue_frame = lambda frame: ("soft", frame)
            matcher.feature_match_evidence = lambda _ref, _src: weak
            matcher.low_contrast_feature_match_evidence = lambda ref, src: (
                low_calls.append((ref, src)) or rescue
            )
            result = matcher.effect_tolerant_feature_match_evidence("ref", "src")
        finally:
            (
                matcher.normalized_rescue_frame,
                matcher.softened_rescue_frame,
                matcher.feature_match_evidence,
                matcher.low_contrast_feature_match_evidence,
            ) = originals

        self.assertIs(result, rescue)
        self.assertEqual(len(low_calls), 1)

    def test_strict_orb_runs_only_after_sift_paths_fail_certification(self):
        weak = self._evidence(0.50, 4, 0.40, 0.64)
        orb_rescue = self._evidence(0.88, 18, 0.72, 0.80)
        originals = (
            matcher.normalized_rescue_frame,
            matcher.softened_rescue_frame,
            matcher.feature_match_evidence,
            matcher.low_contrast_feature_match_evidence,
            matcher.orb_feature_match_evidence,
        )
        orb_calls = []
        try:
            matcher.normalized_rescue_frame = lambda frame: ("base", frame)
            matcher.softened_rescue_frame = lambda frame: ("soft", frame)
            matcher.feature_match_evidence = lambda _ref, _src: dict(weak)
            matcher.low_contrast_feature_match_evidence = lambda _ref, _src: dict(weak)
            matcher.orb_feature_match_evidence = lambda ref, src: (
                orb_calls.append((ref, src)) or orb_rescue
            )
            result = matcher.effect_tolerant_feature_match_evidence("ref", "src")
        finally:
            (
                matcher.normalized_rescue_frame,
                matcher.softened_rescue_frame,
                matcher.feature_match_evidence,
                matcher.low_contrast_feature_match_evidence,
                matcher.orb_feature_match_evidence,
            ) = originals

        self.assertIs(result, orb_rescue)
        self.assertEqual(result["effectFeatureMode"], "CLAHE_ORB_V1")
        self.assertEqual(len(orb_calls), 1)
        self.assertTrue(matcher.orb_rescue_certifiable(result))

    def test_certifiable_low_contrast_path_skips_orb(self):
        weak = self._evidence(0.50, 4, 0.40, 0.64)
        low_rescue = self._evidence(0.82, 10, 0.66, 0.79)
        originals = (
            matcher.normalized_rescue_frame,
            matcher.softened_rescue_frame,
            matcher.feature_match_evidence,
            matcher.low_contrast_feature_match_evidence,
            matcher.orb_feature_match_evidence,
        )
        orb_calls = []
        try:
            matcher.normalized_rescue_frame = lambda frame: ("base", frame)
            matcher.softened_rescue_frame = lambda frame: ("soft", frame)
            matcher.feature_match_evidence = lambda _ref, _src: dict(weak)
            matcher.low_contrast_feature_match_evidence = lambda _ref, _src: low_rescue
            matcher.orb_feature_match_evidence = lambda ref, src: orb_calls.append((ref, src))
            result = matcher.effect_tolerant_feature_match_evidence("ref", "src")
        finally:
            (
                matcher.normalized_rescue_frame,
                matcher.softened_rescue_frame,
                matcher.feature_match_evidence,
                matcher.low_contrast_feature_match_evidence,
                matcher.orb_feature_match_evidence,
            ) = originals

        self.assertIs(result, low_rescue)
        self.assertEqual(result["effectFeatureMode"], "CLAHE_LOW_CONTRAST_SIFT_V1")
        self.assertEqual(orb_calls, [])

    def test_orb_extractor_certifies_heavy_trail_blur_identity(self):
        source = self._synthetic_scene(57)
        shifted = []
        for offset in (12, 24, 36):
            matrix = np.float32([[1, 0, offset], [0, 1, 0]])
            shifted.append(matcher.cv2.warpAffine(
                source,
                matrix,
                (640, 360),
                borderMode=matcher.cv2.BORDER_REFLECT,
            ))
        reference = np.clip(
            0.45 * source.astype(np.float32)
            + 0.25 * shifted[0].astype(np.float32)
            + 0.18 * shifted[1].astype(np.float32)
            + 0.12 * shifted[2].astype(np.float32),
            0,
            255,
        ).astype(np.uint8)
        reference = matcher.cv2.GaussianBlur(reference, (0, 0), 4.5)
        reference = np.clip(reference.astype(np.float32) * 0.14 + 92.0, 0, 255).astype(np.uint8)
        evidence = matcher.orb_feature_match_evidence(
            matcher.normalized_rescue_frame(reference),
            matcher.normalized_rescue_frame(source),
        )
        self.assertTrue(matcher.orb_rescue_certifiable(evidence), evidence)

    def test_low_contrast_extractor_recovers_trail_blur_identity(self):
        source = self._synthetic_scene(31)
        attempts = []
        for dx, blur, contrast, bias in (
            (8, 1.8, 0.34, 82.0),
            (12, 2.2, 0.29, 88.0),
            (16, 2.8, 0.24, 94.0),
            (22, 3.5, 0.17, 100.0),
        ):
            shifted = []
            for offset in (dx, dx * 2, dx * 3):
                matrix = np.float32([[1, 0, offset], [0, 1, 0]])
                shifted.append(matcher.cv2.warpAffine(source, matrix, (640, 360), borderMode=matcher.cv2.BORDER_REFLECT))
            reference = np.clip(
                0.42 * source.astype(np.float32)
                + 0.24 * shifted[0].astype(np.float32)
                + 0.19 * shifted[1].astype(np.float32)
                + 0.15 * shifted[2].astype(np.float32), 0, 255,
            ).astype(np.uint8)
            reference = matcher.cv2.GaussianBlur(reference, (0, 0), blur)
            reference = np.clip(reference.astype(np.float32) * contrast + bias, 0, 255).astype(np.uint8)
            normalized_reference = matcher.normalized_rescue_frame(reference)
            normalized_source = matcher.normalized_rescue_frame(source)
            base = matcher.feature_match_evidence(normalized_reference, normalized_source)
            rescued = matcher.low_contrast_feature_match_evidence(normalized_reference, normalized_source)
            attempts.append((base, rescued))
            if base["inlierCount"] < 6 and matcher.rescue_geometry_certifiable(rescued):
                self.assertGreater(rescued["geometrySupport"], base["geometrySupport"])
                return
        self.fail(attempts)

    def test_repeated_geometry_recovers_stable_source_to_finish_framing(self):
        source = self._synthetic_scene(73)
        scale = 1.18
        angle = math.radians(4.5)
        center = np.asarray([320.0, 180.0], dtype=np.float64)
        target = np.asarray([362.0, 158.0], dtype=np.float64)
        linear = np.asarray([
            [scale * math.cos(angle), -scale * math.sin(angle)],
            [scale * math.sin(angle), scale * math.cos(angle)],
        ], dtype=np.float32)
        translation = target - (linear @ center)
        transform = np.column_stack((linear, translation.astype(np.float32)))
        reference = matcher.cv2.warpAffine(
            source,
            transform,
            (640, 360),
            flags=matcher.cv2.INTER_CUBIC,
            borderMode=matcher.cv2.BORDER_REFLECT,
        )

        class FixedReader:
            duration_ms = 10000.0

            def __init__(self, frame):
                self.frame = frame

            def read_ms(self, _time_ms):
                return self.frame

        shot = {
            "anchors": [
                {"timeMs": 100.0},
                {"timeMs": 350.0},
                {"timeMs": 650.0},
                {"timeMs": 900.0},
            ],
        }
        mapping = {
            "centerSourceMs": 5000.0,
            "slope": 1.0,
            "trajectory": [],
        }
        proof = matcher.mapping_geometric_proof(
            shot,
            mapping,
            FixedReader(reference),
            FixedReader(source),
        )
        framing = proof.get("framing")
        self.assertIsNotNone(framing, proof)
        self.assertTrue(framing["stable"], framing)
        self.assertGreaterEqual(framing["stableAnchorCount"], 2)
        self.assertAlmostEqual(framing["positionX"], target[0], delta=10.0)
        self.assertAlmostEqual(framing["positionY"], target[1], delta=10.0)
        self.assertAlmostEqual(framing["scalePercent"], scale * 100.0, delta=5.0)
        self.assertAlmostEqual(framing["rotationDegrees"], math.degrees(angle), delta=2.0)
        self.assertGreaterEqual(framing["confidence"], 0.72)

    def test_repeated_geometry_recovers_dynamic_push_in_framing_trajectory(self):
        source = self._synthetic_scene(91)

        class DynamicReferenceReader:
            duration_ms = 1000.0

            def read_ms(self, time_ms):
                progress = min(1.0, max(0.0, (float(time_ms) - 100.0) / 800.0))
                scale = 1.0 + (0.26 * progress)
                angle = math.radians(3.5 * progress)
                center = np.asarray([320.0, 180.0], dtype=np.float64)
                target = np.asarray([
                    320.0 + (42.0 * progress),
                    180.0 - (24.0 * progress),
                ], dtype=np.float64)
                linear = np.asarray([
                    [scale * math.cos(angle), -scale * math.sin(angle)],
                    [scale * math.sin(angle), scale * math.cos(angle)],
                ], dtype=np.float32)
                translation = target - (linear @ center)
                transform = np.column_stack((linear, translation.astype(np.float32)))
                return matcher.cv2.warpAffine(
                    source,
                    transform,
                    (640, 360),
                    flags=matcher.cv2.INTER_CUBIC,
                    borderMode=matcher.cv2.BORDER_REFLECT,
                )

        class FixedSourceReader:
            duration_ms = 10000.0

            def read_ms(self, _time_ms):
                return source

        shot = {
            "anchors": [
                {"timeMs": 100.0},
                {"timeMs": 350.0},
                {"timeMs": 650.0},
                {"timeMs": 900.0},
            ],
        }
        mapping = {
            "centerSourceMs": 5000.0,
            "slope": 1.0,
            "trajectory": [],
        }
        proof = matcher.mapping_geometric_proof(
            shot,
            mapping,
            DynamicReferenceReader(),
            FixedSourceReader(),
        )
        framing = proof.get("framing")
        self.assertIsNotNone(framing, proof)
        self.assertFalse(framing["stable"], framing)
        self.assertTrue(framing["dynamic"], framing)
        self.assertGreaterEqual(framing["dynamicConfidence"], 0.72)
        self.assertGreaterEqual(len(framing["trajectory"]), 3)
        self.assertGreater(
            framing["trajectory"][-1]["scalePercent"]
            - framing["trajectory"][0]["scalePercent"],
            15.0,
        )
        self.assertGreater(
            framing["trajectory"][-1]["positionX"]
            - framing["trajectory"][0]["positionX"],
            20.0,
        )

    def test_inconsistent_geometry_does_not_certify_static_framing(self):
        evidence = []
        for index, (position_x, scale_percent, rotation) in enumerate((
            (90.0, 100.0, -12.0),
            (260.0, 135.0, 4.0),
            (490.0, 82.0, 17.0),
            (710.0, 170.0, -28.0),
        )):
            item = self._evidence(0.90, 18, 0.82, 0.91)
            item["referenceTimeMs"] = float(index * 300)
            item["framing"] = {
                "positionX": position_x,
                "positionY": 180.0,
                "scalePercent": scale_percent,
                "rotationDegrees": rotation,
                "confidence": 0.94,
                "referenceWidth": 640,
                "referenceHeight": 360,
            }
            evidence.append(item)
        framing = matcher.aggregate_framing_proof(evidence)
        self.assertIsNotNone(framing)
        self.assertFalse(framing["stable"], framing)
        self.assertFalse(framing["dynamic"], framing)
        self.assertEqual(framing["trajectory"], [])
        self.assertEqual(framing["stableAnchorCount"], 0)

    def test_low_contrast_extractor_rejects_unrelated_scene(self):
        left = matcher.normalized_rescue_frame(self._synthetic_scene(31))
        right = matcher.normalized_rescue_frame(self._synthetic_scene(99))
        evidence = matcher.low_contrast_feature_match_evidence(left, right)
        self.assertFalse(matcher.rescue_geometry_certifiable(evidence), evidence)


if __name__ == "__main__":
    unittest.main()
