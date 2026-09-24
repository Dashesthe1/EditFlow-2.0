import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


def load_tool():
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "practice"
        / "practice-source-binding.py"
    )
    spec = importlib.util.spec_from_file_location("practice_source_binding", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tool = load_tool()
SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64


def reference():
    return {
        "referenceId": "reference:fixture",
        "video": {"durationMs": 1000.0},
        "shots": [{
            "shotId": "shot:a",
            "referenceStartMs": 0.0,
            "referenceEndMs": 500.0,
        }, {
            "shotId": "shot:b",
            "referenceStartMs": 500.0,
            "referenceEndMs": 1000.0,
        }],
    }


def match(
    shot_id,
    source_id,
    source_sha,
    *,
    confidence=0.98,
    margin=0.20,
    strong_anchors=3,
    start_ms=1000.0,
):
    return {
        "shotId": shot_id,
        "sourceId": source_id,
        "sourceStartMs": start_ms,
        "sourceEndMs": start_ms + 500.0,
        "confidence": confidence,
        "candidateMargin": margin,
        "geometricProof": {"strongAnchorCount": strong_anchors},
        "evidenceRefs": [
            "source-video:sha256:" + source_sha,
            "practice-candidate-margin:" + str(margin),
        ],
    }


class PracticeSourceBindingTest(unittest.TestCase):
    def test_full_exact_scene_coverage_certifies_source_binding(self):
        observation = {"matches": [
            match("shot:a", "video:a", SHA_A),
            match("shot:b", "video:b", SHA_B, start_ms=2000.0),
        ]}
        result = tool.evaluate_binding(reference(), observation)

        self.assertEqual(result["status"], "BOUND")
        self.assertEqual(result["qualifiedShotCount"], 2)
        self.assertEqual(result["qualifiedTimelineCoverage"], 1.0)
        self.assertEqual(result["rejectedShots"], [])
        self.assertEqual(result["sourceBindings"], [
            {"sourceId": "video:a", "sourceSha256": SHA_A},
            {"sourceId": "video:b", "sourceSha256": SHA_B},
        ])

    def test_low_confidence_or_weak_geometry_cannot_bind_full_finish(self):
        observation = {"matches": [
            match("shot:a", "video:a", SHA_A),
            match(
                "shot:b",
                "video:b",
                SHA_B,
                confidence=0.949,
                strong_anchors=1,
                start_ms=2000.0,
            ),
        ]}
        result = tool.evaluate_binding(reference(), observation)

        self.assertEqual(result["status"], "NO_VALID_BINDING")
        self.assertEqual(result["qualifiedTimelineCoverage"], 0.5)
        self.assertEqual(result["qualifiedShotCount"], 1)
        reasons = result["rejectedShots"][0]["reasons"]
        self.assertTrue(any("confidence below" in reason for reason in reasons))
        self.assertTrue(any("geometric proof" in reason for reason in reasons))
        self.assertTrue(any("coverage" in reason for reason in result["reasons"]))

    def test_ambiguous_runner_up_margin_blocks_binding(self):
        observation = {"matches": [
            match("shot:a", "video:a", SHA_A),
            match(
                "shot:b",
                "video:b",
                SHA_B,
                margin=0.019,
                start_ms=2000.0,
            ),
        ]}
        result = tool.evaluate_binding(reference(), observation)

        self.assertEqual(result["status"], "NO_VALID_BINDING")
        self.assertEqual(result["qualifiedTimelineCoverage"], 0.5)
        self.assertTrue(any(
            "candidate margin is ambiguous" in reason
            for reason in result["rejectedShots"][0]["reasons"]
        ))

    def test_source_id_cannot_change_content_identity_across_shots(self):
        observation = {"matches": [
            match("shot:a", "video:a", SHA_A),
            match("shot:b", "video:a", SHA_C, start_ms=2000.0),
        ]}
        result = tool.evaluate_binding(reference(), observation)

        self.assertEqual(result["qualifiedTimelineCoverage"], 1.0)
        self.assertEqual(result["status"], "NO_VALID_BINDING")
        self.assertTrue(any(
            "multiple retained SHA-256 identities" in reason
            for reason in result["reasons"]
        ))

    def test_bind_sources_can_certify_existing_match_observation(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference_path = root / "reference.json"
            matches_path = root / "matches.json"
            output_path = root / "binding.json"
            reference_path.write_text(json.dumps(reference()), encoding="utf-8")
            matches_path.write_text(json.dumps({"matches": [
                match("shot:a", "video:a", SHA_A),
                match("shot:b", "video:b", SHA_B, start_ms=2000.0),
            ]}), encoding="utf-8")

            result = tool.bind_sources(
                reference_path,
                output_path,
                matches_path=matches_path,
            )
            retained = json.loads(output_path.read_text(encoding="utf-8"))

            self.assertEqual(result["status"], "BOUND")
            self.assertEqual(retained["status"], "BOUND")
            self.assertEqual(
                retained["matchesPath"],
                str(matches_path.resolve()),
            )


if __name__ == "__main__":
    unittest.main()
