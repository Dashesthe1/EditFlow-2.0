# M3 temporal-ease decoded-pixel evidence screening

## Scope and maturity boundary

This adds offline verification support to the protocol-1.8 P3/P4 draft. It does
not add an Adobe mutation route, alter the host adapter, register a production
capability, change a proof manifest, or promote capability maturity.

The real-AE P3/P4 harness must not run before its retained protocol-1.8 P1/P2
prerequisite has been independently accepted. The verifier's synthetic tests can
run separately on a GitHub-hosted Linux runner; they never use the AE workstation.
A passing synthetic test is evidence about the verifier, not about After Effects.

Even successful screening returns `PIXEL_CHECKS_PASSED_REVIEW_REQUIRED`, with
`P3_visual_proof: false`, `P5_save_reopen_reconnect_transfer: false`, and
`independentReviewRequired: true`. There is no acceptance override.

## Why decoded pixels

The existing draft emits baseline, changed-ease, restored-baseline, and
post-rollback AVI files. File existence is not visual proof. Conversely, encoded
file hashes can differ because of container metadata while the decoded pixels
remain identical. This verifier records encoded hashes for provenance and compares
all decoded frames for behavior and exact restoration.

The supported fixture is deliberately narrow: the existing opaque 320 x 320,
24 fps, one-second composition, with foreground Opacity keys `(0, 0)`,
`(0.5, 100)`, and `(1, 0)`. Only the middle key's temporal ease changes.

Real-AE run `34176484232` exposed an important baseline edge: after the accepted
protocol-1.7 manual-BEZIER setup, After Effects 25.6.6 can read back a native
`KeyframeEase` influence of `0`, while protocol-1.8 writes correctly retain
Adobe's documented `0.1..100` influence range. The harness therefore retains that
native readback as provenance/cardinality evidence, then establishes a legal,
deterministic writable protocol-1.8 baseline at influence `20` before rendering.
The contrast state uses influence `80`; restoration writes the exact baseline
state through the public protocol, and P4 rollback must return to that same
writable baseline. No validation range is weakened for the proof.

A 24-frame render covers frame times `0/24` through `23/24`. The key at one second
is not rendered. The report explicitly includes `unrenderedKeyframeTimesSeconds:
[1]`; it never substitutes the last frame for that endpoint. A future terminal-key
visual proof must explicitly extend or redesign the fixture rather than silently
pad or resample this evidence.

## Validation and comparison

Before invoking any decoder, require the finished structural harness result,
exact proof identity, successful cleanup, consistent proof levels, and the exact
SHA-256 of the retained P1/P2 bytes. This detects mismatched dependencies but does
not authenticate an artifact's origin: independent review must bind the records
to the real GitHub run, source commit, host, and retained artifact archive.

Resolve only the four fixed render basenames under the explicitly selected local
artifact directory. Recorded Windows paths are never followed. Symlinked,
non-regular, empty, oversized, or path-escaping media fails. Subprocesses are
invoked without a shell, with local-file/AVI input restrictions, output bounds,
and a 15-second timeout per invocation. Decoder errors fail rather than skip.
Input hashes are checked before and after inspection; this is not a security
sandbox for hostile media or a guarantee against adversarial concurrent writers.

FFprobe must report exactly one video stream, the original dimensions and frame
rate, and all 24 ordered presentation timestamps. FFmpeg decodes to RGB24 without
scaling, autorotation, or frame-rate conversion. No frame is sampled away.

Numerical checks require:

- a non-static baseline and byte-identical baseline/eased images at rendered key
  frames 0 and 12;
- at least two visibly changed frames on each side of the middle key;
- every restored-baseline and post-rollback decoded pixel to equal the baseline.

For this high-contrast deterministic fixture, a visibly changed frame means mean
absolute RGB-channel delta of at least 3, with at least 25% of pixels having a
maximum channel delta of at least 8 (8-bit channel values). These are explicit
regression thresholds, not a universal perception model. One changed pixel or
small codec noise does not satisfy the visible-change test. The exact-restoration
check, by contrast, rejects even a one-channel, one-pixel discrepancy.

The screen does not prove the intended curve shape or attribute a visual change
to a particular Adobe call. Independent structural and visual review remains
necessary. RGB24 equivalence covers this opaque fixture only; it cannot establish
alpha-channel fidelity or arbitrary high-bit-depth color fidelity.

## Running the offline screen

Requirements: Node.js 22 or later, FFmpeg, and ffprobe. Use local copies of the
actual retained records, not hand-written replacement success claims.

```sh
node scripts/proofs/verify-temporal-ease-visual.mjs \
  --proof /local/p3-p4/result.json \
  --accepted-p1-p2 /local/p1-p2/result.json \
  --artifact-dir /local/p3-p4 \
  > /local/p3-p4/pixel-screen.json
```

Use a new report path: shell redirection must never overwrite an input record.
Optional `--ffmpeg` and `--ffprobe` arguments select explicit executable paths.
Unknown, incomplete, or repeated arguments reject. Exit code zero means the
numerical screen passed, not that P3 is accepted. Failures emit structured JSON
and a nonzero exit code. The verifier itself writes no input files and touches no
After Effects state.

## Executable regression tests

```sh
node --test tests/m3-temporal-ease-visual.test.mjs
node --test proofs/tests/temporal-ease-visual-integration.mjs
```

The unit suite exercises pixel comparisons, metadata validation, and prerequisite
binding. The integration suite uses actual FFmpeg/ffprobe against explicitly
labelled synthetic AVI media and tests the CLI, container-only changes, truncated
media, wrong frame rates, no-op easing, one-pixel rollback corruption, symlinks,
missing tools, and dependency mismatches. Missing media tools fail this explicit
suite; they are not silently skipped.

The new GitHub-hosted workflow retains test logs and Node/FFmpeg/ffprobe versions.
It has no AE runner labels or host-launch steps. The normal repository test glob
also runs the new unit suite without needing FFmpeg. Neither test suite publishes
an accepted AE proof manifest.

## Source-informed decisions

Consulted September 7, 2026:

- After Effects Scripting Guide, KeyframeEase:
  https://ae-scripting.docsforadobe.dev/other/keyframeease/
  Numeric speed and influence are distinct keyframe controls. This screen targets
  the visual effect of the existing protocol-1.8 operation, not a substitute
  interpolation or spatial-tangent operation.
- After Effects Scripting Guide, Property:
  https://ae-scripting.docsforadobe.dev/property/property/
  Structural verification of ease handles belongs to the host readback contract;
  pixels supplement it rather than replacing it.
- FFprobe documentation, `-show_frames`, `-show_entries`, and JSON output:
  https://ffmpeg.org/ffprobe.html
  Used to inspect actual decoded frame records and presentation times rather than
  relying only on the container's advertised duration.
- FFmpeg documentation, stream mapping and `-fps_mode passthrough`:
  https://ffmpeg.org/ffmpeg.html
  Used for explicit video selection and preserving frame delivery without a
  frame-rate-conversion filter.

These sources guide the implementation. They are not evidence that the new
protocol or this verifier has already passed real-After-Effects acceptance.
