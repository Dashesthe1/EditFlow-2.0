import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "practice_media_match_unicode",
    ROOT / "scripts" / "practice" / "practice-media-match.py",
)
matcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(matcher)


class FakeCapture:
    def __init__(self, opened):
        self.opened = opened
        self.released = False

    def isOpened(self):
        return self.opened

    def release(self):
        self.released = True


class PracticeMediaUnicodePathTests(unittest.TestCase):
    def test_capture_retries_ascii_alias_after_primary_open_failure(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "finish🔥.mp4"
            alias = root / "finish-safe.mp4"
            original.write_bytes(b"fixture")
            alias.write_bytes(b"fixture")
            seen = []
            old_capture = matcher.cv2.VideoCapture
            old_alias = matcher.ensure_opencv_path_alias
            try:
                matcher.cv2.VideoCapture = lambda value: (
                    seen.append(str(value)) or FakeCapture(Path(value) == alias.resolve())
                )
                matcher.ensure_opencv_path_alias = lambda _path: alias.resolve()
                capture = matcher.open_video_capture(original, "reference video")
            finally:
                matcher.cv2.VideoCapture = old_capture
                matcher.ensure_opencv_path_alias = old_alias
            self.assertTrue(capture.isOpened())
            self.assertEqual(seen, [str(original.resolve()), str(alias.resolve())])

    def test_capture_uses_primary_path_without_alias_when_supported(self):
        with TemporaryDirectory() as temporary:
            original = Path(temporary) / "plain.mp4"
            original.write_bytes(b"fixture")
            seen = []
            old_capture = matcher.cv2.VideoCapture
            old_alias = matcher.ensure_opencv_path_alias
            try:
                matcher.cv2.VideoCapture = lambda value: (
                    seen.append(str(value)) or FakeCapture(True)
                )
                matcher.ensure_opencv_path_alias = lambda _path: self.fail("alias should not be requested")
                capture = matcher.open_video_capture(original)
            finally:
                matcher.cv2.VideoCapture = old_capture
                matcher.ensure_opencv_path_alias = old_alias
            self.assertTrue(capture.isOpened())
            self.assertEqual(seen, [str(original.resolve())])


if __name__ == "__main__":
    unittest.main()
