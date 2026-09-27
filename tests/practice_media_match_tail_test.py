import importlib.util
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "practice" / "practice-media-match.py"
SPEC = importlib.util.spec_from_file_location("practice_media_match_tail", SCRIPT)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


def rich_frame():
    frame = np.zeros((90, 160, 3), dtype=np.uint8)
    frame[:, :, 2] = 255
    frame[::4, :, 1] = 180
    return frame


class FakeReader:
    def __init__(self, low_after_ms=None):
        self.low_after_ms = low_after_ms

    def read_ms(self, time_ms):
        if self.low_after_ms is not None and time_ms >= self.low_after_ms:
            return np.zeros((90, 160, 3), dtype=np.uint8)
        return rich_frame()


class PartialTailTests(unittest.TestCase):
    def shot(self, start=8000.0, end=12000.0):
        return {
            "referenceStartMs": start,
            "referenceEndMs": end,
            "evidenceRefs": ["shot-proof"],
        }

    def previous(self):
        return {
            "_tailMetrics": {
                "meanMotion": 0.04,
                "meanSaturation": 0.4,
                "meanEntropy": 0.7,
            }
        }

    def test_drops_tiny_content_prefix_before_low_information_outro(self):
        result = MOD.classify_partial_static_tail_artifact(
            FakeReader(8200.0), self.shot(), self.previous(), 12000.0, 180.0
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["contentEndMs"], 8000.0)
        self.assertEqual(result["artifact"]["referenceStartMs"], 8000.0)

    def test_trims_suffix_when_meaningful_prefix_remains(self):
        result = MOD.classify_partial_static_tail_artifact(
            FakeReader(9200.0), self.shot(), self.previous(), 12000.0, 180.0
        )
        self.assertIsNotNone(result)
        self.assertGreater(result["contentEndMs"], 8000.0)
        self.assertLess(result["contentEndMs"], 9200.0)

    def test_does_not_trim_rich_content(self):
        result = MOD.classify_partial_static_tail_artifact(
            FakeReader(None), self.shot(), self.previous(), 12000.0, 180.0
        )
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
