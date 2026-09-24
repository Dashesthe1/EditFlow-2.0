import hashlib
import importlib.util
import json
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
    def test_source_cache_requires_requested_density(self):
        artifact = {
            "sourceId": "video:movie",
            "sourcePath": str(Path("movie.mp4").resolve()),
            "sourceSha256": "movie-sha-a",
            "analysis": {
                "sampleStepMs": 1500.0,
                "analysisProxyFps": 4.0,
            },
        }
        self.assertFalse(benchmark.source_cache_compatible(
            artifact,
            Path("movie.mp4").resolve(),
            "video:movie",
            250.0,
            4.0,
        ))
        self.assertTrue(benchmark.source_cache_compatible(
            artifact,
            Path("movie.mp4").resolve(),
            "video:movie",
            1500.0,
            4.0,
            "movie-sha-a",
        ))
        self.assertFalse(benchmark.source_cache_compatible(
            artifact,
            Path("movie.mp4").resolve(),
            "video:movie",
            1500.0,
            4.0,
            "movie-sha-b",
        ))

    def test_reference_cache_requires_requested_segmentation(self):
        artifact = {
            "referenceId": "ref:1",
            "sourcePath": str(Path("finish.mp4").resolve()),
            "sourceSha256": "finish-sha-a",
            "analysis": {
                "cutThreshold": 0.42,
                "minimumShotMs": 180.0,
            },
        }
        self.assertTrue(benchmark.reference_cache_compatible(
            artifact,
            Path("finish.mp4").resolve(),
            "ref:1",
            0.42,
            180.0,
            "finish-sha-a",
        ))
        self.assertFalse(benchmark.reference_cache_compatible(
            artifact,
            Path("finish.mp4").resolve(),
            "ref:1",
            0.42,
            180.0,
            "finish-sha-b",
        ))
        self.assertFalse(benchmark.reference_cache_compatible(
            artifact,
            Path("finish.mp4").resolve(),
            "ref:1",
            0.55,
            180.0,
        ))

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

    def test_run_case_rejects_truth_bound_to_different_start_bytes_before_indexing(self):
        class FakeMatcher:
            @staticmethod
            def sha256_file(path):
                return hashlib.sha256(Path(path).read_bytes()).hexdigest()

            @staticmethod
            def load_artifact(path, schema):
                payload = json.loads(Path(path).read_text(encoding="utf-8"))
                if payload.get("schema") != schema:
                    raise ValueError("unexpected fixture schema")
                return payload

            def analyze_reference(
                self,
                reference_video,
                reference_id,
                output,
                cut_threshold,
                minimum_shot_ms,
            ):
                payload = {
                    "schema": "editflow.practice-reference-analysis.v1",
                    "referenceId": reference_id,
                    "sourcePath": str(Path(reference_video).resolve()),
                    "sourceSha256": self.sha256_file(reference_video),
                    "styleFingerprint": "fixture-style",
                    "analysis": {
                        "analyzerFingerprint": "fixture-analyzer",
                        "cutThreshold": cut_threshold,
                        "minimumShotMs": minimum_shot_ms,
                    },
                    "shots": [{
                        "shotId": "shot:1",
                        "referenceStartMs": 0.0,
                        "referenceEndMs": 800.0,
                    }],
                }
                benchmark.write_json(output, payload)

            @staticmethod
            def index_source(*_args, **_kwargs):
                raise AssertionError("stale truth must fail before source indexing")

        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            finish = root_path / "finish.mp4"
            source = root_path / "movie.mp4"
            finish.write_bytes(b"finish-fixture")
            source.write_bytes(b"current-start-media")
            finish_sha256 = hashlib.sha256(finish.read_bytes()).hexdigest()
            truth_path = root_path / "truth.json"
            truth_path.write_text(
                json.dumps({
                    "schema": benchmark.TRUTH_SCHEMA,
                    "status": "RETAINED",
                    "referenceId": "ref:fixture",
                    "referenceFingerprint": "fixture-style",
                    "referenceSourceSha256": finish_sha256,
                    "referenceAnalyzerFingerprint": "fixture-analyzer",
                    "allowedSourceIds": ["video:movie"],
                    "allowedSourceSha256": {"video:movie": "0" * 64},
                    "annotationOrigin": "INDEPENDENT_HUMAN",
                    "shots": [{
                        "shotId": "shot:1",
                        "sourceId": "video:movie",
                        "sourceStartMs": 1000.0,
                        "sourceEndMs": 1800.0,
                        "direction": "FORWARD",
                        "minimumIou": 0.5,
                    }],
                }),
                encoding="utf-8",
            )
            benchmark_case = {
                "benchmarkId": "case:source-bytes",
                "referenceId": "ref:fixture",
                "referenceVideo": str(finish),
                "sources": [{
                    "sourceId": "video:movie",
                    "video": str(source),
                }],
                "truthFile": str(truth_path),
            }
            with self.assertRaisesRegex(ValueError, "exact benchmark Start media bytes"):
                benchmark.run_case(
                    FakeMatcher(),
                    benchmark_case,
                    root_path,
                    root_path / "out",
                )


if __name__ == "__main__":
    unittest.main()
