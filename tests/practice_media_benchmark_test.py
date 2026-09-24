import importlib.util
import tempfile
import unittest
from pathlib import Path


def load_benchmark():
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "practice"
        / "practice-media-benchmark.py"
    )
    spec = importlib.util.spec_from_file_location("practice_media_benchmark", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


benchmark = load_benchmark()


def reference():
    return {
        "referenceId": "ref:1",
        "shots": [
            {"shotId": "shot:1"},
            {"shotId": "shot:2"},
        ],
    }
def geometric():
    return {
        "anchorCount": 3,
        "strongAnchorCount": 3,
        "strongAnchorFraction": 1.0,
        "meanSupport": 0.91,
        "minimumSupport": 0.83,
        "maximumInlierCount": 18,
        "meanInlierRatio": 0.72,
        "meanCoverage": 0.16,
    }


def match(shot_id, start, end, source_id="video:movie", direction="FORWARD"):
    return {
        "shotId": shot_id,
        "sourceId": source_id,
        "sourceStartMs": start,
        "sourceEndMs": end,
        "direction": direction,
        "confidence": 0.99,
        "geometricProof": geometric(),
    }


def truth():
    return {
        "schema": benchmark.TRUTH_SCHEMA,
        "referenceId": "ref:1",
        "shots": [
            {
                "shotId": "shot:1",
                "sourceId": "video:movie",
                "sourceStartMs": 1000,
                "sourceEndMs": 2000,
                "direction": "FORWARD",
                "toleranceMs": 150,
            },
            {
                "shotId": "shot:2",
                "sourceId": "video:movie",
                "sourceStartMs": 5000,
                "sourceEndMs": 6200,
                "direction": "REVERSE",
                "toleranceMs": 200,
            },
        ],
    }


def case():
    return {
        "benchmarkId": "case:1",
        "referenceId": "ref:1",
    }


class PracticeMediaBenchmarkTest(unittest.TestCase):
    def test_manifest_loader_accepts_utf8_bom(self):
        with tempfile.TemporaryDirectory() as root:
            manifest = Path(root) / "manifest.json"
            manifest.write_bytes(b"\xef\xbb\xbf{\"schema\":\"fixture\"}")
            self.assertEqual(benchmark.load_json(manifest)["schema"], "fixture")

    def test_full_truth_correct_match_passes(self):
        matches = {
            "matches": [
                match("shot:1", 1040, 1960),
                match("shot:2", 5070, 6140, direction="REVERSE"),
            ],
        }
        result = benchmark.evaluate_case(case(), reference(), matches, truth())
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["metrics"]["falseHighConfidenceCount"], 0)
        self.assertEqual(result["metrics"]["sourceIdentityAccuracy"], 1.0)
        self.assertEqual(result["metrics"]["geometricProofRate"], 1.0)

    def test_missing_truth_is_measure_only(self):
        matches = {
            "matches": [
                match("shot:1", 1000, 2000),
                match("shot:2", 5000, 6200, direction="REVERSE"),
            ],
        }
        result = benchmark.evaluate_case(case(), reference(), matches, None)
        self.assertEqual(result["status"], "MEASURE_ONLY")
        self.assertFalse(result["metrics"]["truthCoverageRate"])
        self.assertTrue(any("truth" in item.lower() for item in result["reasons"]))

    def test_false_high_confidence_source_claim_fails(self):
        matches = {
            "matches": [
                match("shot:1", 1000, 2000, source_id="video:wrong"),
                match("shot:2", 5000, 6200, direction="REVERSE"),
            ],
        }
        result = benchmark.evaluate_case(case(), reference(), matches, truth())
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["metrics"]["falseHighConfidenceCount"], 1)
        self.assertLess(result["metrics"]["sourceIdentityAccuracy"], 1.0)

    def test_wrong_timing_fails_even_with_high_visual_confidence(self):
        matches = {
            "matches": [
                match("shot:1", 4200, 5200),
                match("shot:2", 5000, 6200, direction="REVERSE"),
            ],
        }
        result = benchmark.evaluate_case(case(), reference(), matches, truth())
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["metrics"]["falseHighConfidenceCount"], 1)
        self.assertLess(result["metrics"]["timingAccuracy"], 1.0)

    def test_weak_geometry_cannot_certify_scene_truth(self):
        weak = match("shot:1", 1000, 2000)
        weak["geometricProof"] = {**geometric(), "strongAnchorCount": 1}
        matches = {
            "matches": [
                weak,
                match("shot:2", 5000, 6200, direction="REVERSE"),
            ],
        }
        result = benchmark.evaluate_case(case(), reference(), matches, truth())
        self.assertEqual(result["status"], "FAIL")
        self.assertLess(result["metrics"]["geometricProofRate"], 1.0)
        row = next(item for item in result["perShot"] if item["shotId"] == "shot:1")
        self.assertFalse(row["certified"])


if __name__ == "__main__":
    unittest.main()
