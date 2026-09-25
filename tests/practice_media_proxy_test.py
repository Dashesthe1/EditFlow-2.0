import importlib.util
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "practice_media_match_proxy",
    ROOT / "scripts" / "practice" / "practice-media-match.py",
)
matcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(matcher)


class PracticeMediaProxyTest(unittest.TestCase):
    def test_analysis_proxy_tries_cuda_then_falls_back_to_software(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "input.mp4"
            proxy = root / "proxy.avi"
            video.write_bytes(b"source")
            commands = []

            def fake_run(command, **_kwargs):
                commands.append(list(command))
                if "-hwaccel" in command:
                    return subprocess.CompletedProcess(command, 1, stderr=b"cuda unavailable")
                Path(command[-1]).write_bytes(b"proxy")
                return subprocess.CompletedProcess(command, 0, stderr=b"")

            with patch.object(matcher, "resolve_ffmpeg", return_value="ffmpeg"), patch.object(
                matcher.subprocess, "run", side_effect=fake_run
            ):
                result = matcher.ensure_analysis_proxy(
                    video,
                    proxy,
                    analysis_fps=6.0,
                    max_dimension=360,
                )

            self.assertEqual(result, proxy.resolve())
            self.assertEqual(len(commands), 2)
            self.assertEqual(commands[0][commands[0].index("-hwaccel") + 1], "cuda")
            self.assertNotIn("-hwaccel", commands[1])
            self.assertEqual(proxy.read_bytes(), b"proxy")


if __name__ == "__main__":
    unittest.main()
