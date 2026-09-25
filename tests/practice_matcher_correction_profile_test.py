import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "practice_media_match_correction_profile",
    ROOT / "scripts" / "practice" / "practice-media-match.py",
)
matcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(matcher)


def valid_profile():
    return {
        "schema": "editflow.practice-scene-matcher-correction-profile.v1",
        "editTypeId": "edit-type:test",
        "subsystem": "SOURCE_IDENTITY_RETRIEVAL",
        "correctionAction": "RERANK_SOURCE_IDENTITY",
        "retrievalMode": "SOURCE_STRATIFIED_IDENTITY_REPLAY_V1",
        "detailedPerSourceLimit": 3,
        "detailedGlobalLimit": 6,
        "continuityMaximumBonus": 0.012,
        "targetShotKeys": ["case-1::shot-1"],
        "evidenceRefs": ["truth:test"],
        "replayGate": "RETAINED_TRUTH_REPLAY_REQUIRED",
        "preserveExactSceneGeometryGate": True,
        "allowGlobalThresholdRelaxation": False,
    }


class PracticeMatcherCorrectionProfileTests(unittest.TestCase):
    def load(self, payload):
        with tempfile.TemporaryDirectory() as directory:
            profile_path = Path(directory) / "profile.json"
            profile_path.write_text(json.dumps(payload), encoding="utf-8")
            return matcher.load_matcher_correction_profile(profile_path)

    def test_bounded_identity_replay_profile_is_accepted(self):
        profile = self.load(valid_profile())
        self.assertEqual(profile["detailedPerSourceLimit"], 3)
        self.assertEqual(profile["detailedGlobalLimit"], 6)
        self.assertEqual(profile["continuityMaximumBonus"], 0.012)
        self.assertTrue(matcher.matcher_correction_applies(profile, "case-1", "shot-1"))
        self.assertFalse(matcher.matcher_correction_applies(profile, "case-1", "shot-2"))
        self.assertFalse(matcher.matcher_correction_applies(profile, "case-2", "shot-1"))

    def test_correction_replay_requires_explicit_case_binding(self):
        profile = self.load(valid_profile())
        with self.assertRaisesRegex(ValueError, "correction-case-id"):
            matcher.matcher_correction_applies(profile, None, "shot-1")

    def test_global_threshold_relaxation_is_rejected(self):
        payload = valid_profile()
        payload["allowGlobalThresholdRelaxation"] = True
        with self.assertRaisesRegex(ValueError, "fail-closed guardrails"):
            self.load(payload)

    def test_excessive_continuity_bonus_is_rejected(self):
        payload = valid_profile()
        payload["continuityMaximumBonus"] = 0.03
        with self.assertRaisesRegex(ValueError, "continuity bonus exceeds replay bounds"):
            self.load(payload)


if __name__ == "__main__":
    unittest.main()
