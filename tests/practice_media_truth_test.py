import importlib.util
import unittest
from pathlib import Path


def load_truth_tool():
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "practice"
        / "practice-media-truth.py"
    )
    spec = importlib.util.spec_from_file_location("practice_media_truth", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


truth_tool = load_truth_tool()
SOURCE_SHA256 = "a" * 64
CHANGED_SOURCE_SHA256 = "b" * 64
SOURCE_HASHES = {"video:movie": SOURCE_SHA256}


def reference():
    return {
        "schema": truth_tool.REFERENCE_SCHEMA,
        "referenceId": "reference:fixture",
        "styleFingerprint": "fixture-style",
        "sourceSha256": "finish-sha256",
        "analysis": {"analyzerFingerprint": "analyzer-sha256"},
        "shots": [
            {
                "shotId": "shot:0001",
                "referenceStartMs": 0.0,
                "referenceEndMs": 800.0,
            },
            {
                "shotId": "shot:0002",
                "referenceStartMs": 800.0,
                "referenceEndMs": 1500.0,
            },
        ],
    }


class PracticeMediaTruthTest(unittest.TestCase):
    def test_scaffold_never_prefills_matcher_answers(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        self.assertEqual(draft["status"], "DRAFT")
        self.assertIsNone(draft["annotationOrigin"])
        self.assertEqual(draft["referenceFingerprint"], "fixture-style")
        self.assertEqual(draft["referenceSourceSha256"], "finish-sha256")
        self.assertEqual(draft["referenceAnalyzerFingerprint"], "analyzer-sha256")
        self.assertEqual(draft["allowedSourceSha256"], SOURCE_HASHES)
        self.assertFalse(draft["policy"]["matcherSuggestionsAllowed"])
        self.assertFalse(draft["policy"]["matcherOutputMayBecomeTruth"])
        self.assertEqual(len(draft["shots"]), 2)
        for row in draft["shots"]:
            self.assertIsNone(row["sourceId"])
            self.assertIsNone(row["sourceStartMs"])
            self.assertIsNone(row["sourceEndMs"])
            self.assertIsNone(row["direction"])

    def test_scaffold_requires_exact_source_sha_bindings(self):
        with self.assertRaisesRegex(ValueError, "exact source-ID set"):
            truth_tool.scaffold(reference(), ["video:movie"], {})
        with self.assertRaisesRegex(ValueError, "64-character"):
            truth_tool.scaffold(
                reference(),
                ["video:movie"],
                {"video:movie": "not-a-sha256"},
            )

    def test_retain_rejects_start_bytes_changed_since_scaffold(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        with self.assertRaisesRegex(ValueError, "changed since"):
            truth_tool.retain(
                draft,
                reference(),
                ["video:movie"],
                {"video:movie": CHANGED_SOURCE_SHA256},
                "INDEPENDENT_HUMAN",
            )

    def test_source_sha_cli_bindings_reject_malformed_hashes(self):
        self.assertEqual(
            truth_tool.parse_source_sha256_args([
                "video:movie=" + SOURCE_SHA256,
            ]),
            SOURCE_HASHES,
        )
        with self.assertRaisesRegex(ValueError, "64-character"):
            truth_tool.parse_source_sha256_args([
                "video:movie=not-a-sha256",
            ])

    def test_incomplete_draft_cannot_be_retained(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        with self.assertRaisesRegex(ValueError, "Truth cannot be retained"):
            truth_tool.retain(
                draft,
                reference(),
                ["video:movie"],
                SOURCE_HASHES,
                "INDEPENDENT_HUMAN",
            )

    def test_complete_independent_truth_can_be_retained(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        draft["shots"][0].update({
            "sourceId": "video:movie",
            "sourceStartMs": 1200.0,
            "sourceEndMs": 2000.0,
            "direction": "FORWARD",
            "toleranceMs": 180.0,
        })
        draft["shots"][1].update({
            "sourceId": "video:movie",
            "sourceStartMs": 6300.0,
            "sourceEndMs": 7000.0,
            "direction": "REVERSE",
            "toleranceMs": 200.0,
        })
        retained = truth_tool.retain(
            draft,
            reference(),
            ["video:movie"],
            SOURCE_HASHES,
            "INDEPENDENT_HUMAN",
        )
        self.assertEqual(retained["status"], "RETAINED")
        self.assertEqual(retained["annotationOrigin"], "INDEPENDENT_HUMAN")
        self.assertEqual(retained["allowedSourceSha256"], SOURCE_HASHES)
        self.assertTrue(retained["retainedAt"])
        self.assertEqual(
            truth_tool.validate_truth(
                retained,
                reference(),
                ["video:movie"],
                allowed_source_sha256_by_id=SOURCE_HASHES,
                require_retained=True,
            ),
            [],
        )

    def test_matcher_origin_is_not_an_allowed_retention_origin(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for row in draft["shots"]:
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1000.0,
                "sourceEndMs": 1600.0,
                "direction": "FORWARD",
            })
        draft["status"] = "RETAINED"
        draft["annotationOrigin"] = "EDITFLOW_MATCHER"
        errors = truth_tool.validate_truth(
            draft,
            reference(),
            ["video:movie"],
            require_retained=True,
        )
        self.assertTrue(any("independent" in item.lower() for item in errors))

    def test_wrong_source_id_is_rejected(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for row in draft["shots"]:
            row.update({
                "sourceId": "video:wrong",
                "sourceStartMs": 1000.0,
                "sourceEndMs": 1600.0,
                "direction": "FORWARD",
            })
        draft["status"] = "RETAINED"
        draft["annotationOrigin"] = "INDEPENDENT_EXTERNAL_TOOL"
        errors = truth_tool.validate_truth(
            draft,
            reference(),
            ["video:movie"],
            require_retained=True,
        )
        self.assertTrue(any("sourceId" in item for item in errors))

    def test_retained_truth_is_bound_to_exact_finish_analysis(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for index, row in enumerate(draft["shots"]):
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1000.0 + (index * 1000.0),
                "sourceEndMs": 1600.0 + (index * 1000.0),
                "direction": "FORWARD",
            })
        retained = truth_tool.retain(
            draft,
            reference(),
            ["video:movie"],
            SOURCE_HASHES,
            "INDEPENDENT_HUMAN",
        )
        changed = reference()
        changed["styleFingerprint"] = "changed-style"
        changed["sourceSha256"] = "changed-finish-sha256"
        errors = truth_tool.validate_truth(
            retained,
            changed,
            ["video:movie"],
            require_retained=True,
        )
        self.assertTrue(any("referenceFingerprint" in item for item in errors))
        self.assertTrue(any("referenceSourceSha256" in item for item in errors))

    def test_retained_truth_is_bound_to_exact_start_media_bytes(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for index, row in enumerate(draft["shots"]):
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1000.0 + (index * 1000.0),
                "sourceEndMs": 1600.0 + (index * 1000.0),
                "direction": "FORWARD",
            })
        retained = truth_tool.retain(
            draft,
            reference(),
            ["video:movie"],
            SOURCE_HASHES,
            "INDEPENDENT_HUMAN",
        )
        errors = truth_tool.validate_truth(
            retained,
            reference(),
            ["video:movie"],
            allowed_source_sha256_by_id={
                "video:movie": CHANGED_SOURCE_SHA256,
            },
            require_retained=True,
        )
        self.assertTrue(
            any("exact benchmark Start media bytes" in item for item in errors)
        )

    def test_manifest_source_set_must_match_retained_truth(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for index, row in enumerate(draft["shots"]):
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1000.0 + (index * 1000.0),
                "sourceEndMs": 1600.0 + (index * 1000.0),
                "direction": "FORWARD",
            })
        retained = truth_tool.retain(
            draft,
            reference(),
            ["video:movie"],
            SOURCE_HASHES,
            "INDEPENDENT_HUMAN",
        )
        errors = truth_tool.validate_truth(
            retained,
            reference(),
            ["video:movie", "video:other"],
            require_retained=True,
        )
        self.assertTrue(any("allowedSourceIds" in item for item in errors))

    def test_source_interval_must_be_ascending_even_when_direction_is_reverse(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for row in draft["shots"]:
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1600.0,
                "sourceEndMs": 1000.0,
                "direction": "REVERSE",
            })
        with self.assertRaisesRegex(ValueError, "sourceEndMs"):
            truth_tool.retain(
                draft,
                reference(),
                ["video:movie"],
                SOURCE_HASHES,
                "INDEPENDENT_HUMAN",
            )


if __name__ == "__main__":
    unittest.main()
