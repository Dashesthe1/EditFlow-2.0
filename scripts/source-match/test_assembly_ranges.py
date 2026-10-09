"""Known-frame extraction checks; run directly without extra test dependencies."""
from fractions import Fraction
from pathlib import Path
import tempfile
import unittest

import av
import imageio_ffmpeg

from assemble_ranges import fingerprint, frames, materialize
from test_engine import encode, fixture


class RangeExtractionTests(unittest.TestCase):
    def test_exact_cut_original_pts_and_no_neighbor_frames(self):
        for vfr, origin in [(False, 0), (True, 0), (False, 240)]:
            with self.subTest(vfr=vfr, origin=origin), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / 'source.mp4'
                images = fixture()[:36]
                pts = [origin + i*10 + (i//4 if vfr else 0) for i in range(len(images))]
                encode(source, images, pts=pts, time_base=Fraction(1, 120))
                timestamps, _, _, _ = frames(source)
                start, end = timestamps[8]['time'], timestamps[24]['time']
                with av.open(str(source)) as c:
                    s = c.streams.video[0]
                    duration = float(s.duration * s.time_base)
                shot = dict(shotId='ordered-shot',sourcePath=str(source),sourceStart=start,sourceEndExclusive=end)
                info = dict(path=str(source),fingerprint=fingerprint(source),duration=duration)
                out = materialize(shot,info,root,imageio_ffmpeg.get_ffmpeg_exe(),'CPU')
                self.assertEqual(out['frameCount'],16)
                self.assertEqual([f['pts'] for f in out['sourceFrames']], [f['pts'] for f in timestamps[8:24]])
                self.assertLess(out['frameTimingErrorSeconds'],.0001)
                self.assertLess(out['endpointPixelMeanError'],10)
                self.assertEqual(fingerprint(source),info['fingerprint'])

    def test_stale_original_and_non_frame_start_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mp4'
            encode(source,fixture()[:36])
            times, _, _, _ = frames(source)
            shot = dict(shotId='test',sourcePath=str(source),sourceStart=times[8]['time'],sourceEndExclusive=times[24]['time'])
            info = dict(path=str(source),fingerprint='changed',duration=3)
            with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):
                materialize(shot,info,root,imageio_ffmpeg.get_ffmpeg_exe(),'CPU')
            info['fingerprint'] = fingerprint(source)
            shot['sourceStart'] += .02
            with self.assertRaisesRegex(ValueError,'CUT_START'):
                materialize(shot,info,root,imageio_ffmpeg.get_ffmpeg_exe(),'CPU')


if __name__ == '__main__':
    unittest.main(verbosity=2)
