import importlib.util
import unittest
from pathlib import Path

import numpy as np


def load_matcher():
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "practice"
        / "practice-media-match.py"
    )
    spec = importlib.util.spec_from_file_location("practice_media_match", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


matcher = load_matcher()


class PracticeAudioArrangementTests(unittest.TestCase):
    def source_record(self, features):
        return {
            "sourceId": "song:test",
            "sourcePath": "song.wav",
            "sourceSha256": "sha256:test",
            "features": features,
        }

    def test_contiguous_audio_stays_on_single_segment_fast_path(self):
        rng = np.random.default_rng(7)
        source = matcher.zscore(
            rng.normal(size=(260, 3)).astype(np.float32)
        )
        reference = matcher.zscore(source[40:120].copy())
        piecewise = matcher.piecewise_audio_candidate(
            reference,
            self.source_record(source),
            11025,
            512,
            None,
        )
        self.assertIsNone(piecewise)

    def test_piecewise_audio_detects_internal_song_jump(self):
        rng = np.random.default_rng(11)
        source = matcher.zscore(
            rng.normal(size=(280, 3)).astype(np.float32)
        )
        reference = matcher.zscore(
            np.vstack((source[20:64], source[150:194])).astype(np.float32)
        )
        piecewise = matcher.piecewise_audio_candidate(
            reference,
            self.source_record(source),
            11025,
            512,
            None,
        )

        self.assertIsNotNone(piecewise)
        self.assertGreaterEqual(len(piecewise["segments"]), 2)
        first = piecewise["segments"][0]
        last = piecewise["segments"][-1]
        self.assertLess(first["sourceStartFrame"], 80)
        self.assertGreater(last["sourceStartFrame"], 100)
        self.assertGreater(piecewise["overallConfidence"], 0.85)

    def test_beat_grid_recovers_periodic_onsets(self):
        features = np.zeros((132, 3), dtype=np.float32)
        for frame in range(4, features.shape[0], 11):
            features[frame, :] = np.asarray([4.0, 3.0, 2.0], dtype=np.float32)
        grid = matcher.estimate_audio_beat_grid(features, 11025, 512)
        self.assertIsNotNone(grid)
        self.assertGreaterEqual(len(grid["beatFrames"]), 6)
        self.assertGreater(grid["confidence"], 0.40)
        self.assertGreater(grid["estimatedBpm"], 90.0)
        self.assertLess(grid["estimatedBpm"], 150.0)


if __name__ == "__main__":
    unittest.main()
