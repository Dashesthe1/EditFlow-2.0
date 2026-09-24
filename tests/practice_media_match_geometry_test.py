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


if __name__ == "__main__":
    unittest.main()
