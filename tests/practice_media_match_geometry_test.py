import importlib.util
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


if __name__ == "__main__":
    unittest.main()


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
