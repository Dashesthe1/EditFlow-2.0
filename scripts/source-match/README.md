# EditFlow Source Match Service

Read-only, requested source-copy retrieval for Practice footage discovery. It does
not import Finished into AE, select creative footage, resume production, modify
presets, or replace the GPT-directed editing workflow.

## Install and use

On the Shadow PC, run `scripts/source-match/install.ps1` with Python 3.12 and a
CUDA-compatible NVIDIA driver. Installation uses a dedicated environment,
PyTorch 2.6/CUDA 12.4, PyAV, OpenCV and imageio's FFmpeg. `-CpuOnly` is explicit;
GPU failure does not silently reroute a production job to a slower backend.
The official SSCD TorchScript model is checked against its pinned SHA-256 and
tested on the selected device before installation is marked complete.

MCP tools: `start_source_match`, `get_source_match`, `cancel_source_match`.
The existing authenticated product API also exposes `/v1/product/source-match`.
GET with no jobId reports installation and the contract. POST accepts:

```json
{
  "action": "SUBMIT",
  "requestId": "ultron-source-search-001",
  "referencePath": "C:\\path\\finished.mp4",
  "sourcePaths": ["C:\\path\\movie.mp4"],
  "budgetSeconds": 480
}
```

Supply `shots:[{"start":0,"end":1.5}, ...]` in **seconds** to replace automatic,
advisory cut detection. End times are exclusive and must be within the actual
reference stream duration. Rounded cut lists can cross a cut by a frame and
cause honest verification rejection; use observed reference frame timestamps.
Keep the same requestId when polling/retrying an uncertain submission. A changed
payload or changed input file conflicts instead of silently reusing stale results.
Use a new requestId for a deliberately new analysis. Only one GPU job runs at a
time. Interrupted jobs retain receipts and caches rather than replay automatically.

`get_source_match(jobId)` returns progress, the report, frame-pair evidence paths
and `timestamps.csv`. Poll the job already submitted. The service is independent
of production ownership, so a paused Practice assignment remains paused.

## Processing and accuracy

- Decode the short reference once, retain its actual frame times and form several
  appearance queries spanning each shot. No prose descriptions replace pixels.
- Decode source keyframes while GPU SSCD batches search the incoming descriptors.
  Cache them atomically with source size/mtime, bounded content fingerprint,
  model identity, preprocessing and sampling mode. Full/centre crop descriptors
  support landscape sources used in portrait edits. RGB and grayscale SSCD
  views allow retrieval through strong colour grades; both enter the cache key.
- Search committed partial descriptor chunks on the next job and resume decoding
  after their last original timestamp. Compatible v1.0 caches are preserved.
  During fresh scans, periodically verify a bounded round of candidates before
  the complete movie pass finishes. Every shot receives an attempt before extra
  alternatives are checked for an earlier shot.
- Defer weak candidates during an incomplete scan until the complete pass. This
  scheduling threshold does not discard candidates or change acceptance. Decode
  and verify the middle anchor before opening endpoint decoders; reuse overlapping
  dense windows after the middle passes.
- Prioritize missing locations through denser source passes, then perform the
  bounded competing-location review. `alternativeReviewComplete:false` identifies
  reports stopped by budget/cancellation before that final review finished. A
  COMPLETE report requires the review and all measured endpoints.
- Use GPU decoding and downscaling for candidate windows. Original integer PTS
  and time base survive the FFmpeg pipeline. Cross-check original PTS with PyAV.
- Retrieve a sparse 8fps candidate window, then decode consecutive frames only
  near proposed anchor positions. Timestamp sampling occurs before GPU readback.
  Parse the filter's actual time base and require an exact conversion to original
  integer PTS. Exclusive ends use observed source-frame durations.
- Compare SIFT/RANSAC geometry and registered luminance at multiple anchors;
  check a jointly consistent forward/reverse temporal path, including bounded
  piecewise retiming with explicit per-segment rates. Cache feature points
  within candidate verification. Reject candidates cheaply at the middle anchor
  before doing the more expensive endpoint work. Verify distinct source windows
  once per run, rather than re-decoding neighbouring proposals on every pass.
- Fit forward/reverse monotone paths without forcing speed ramps onto an affine
  prediction. Quantized slow-motion plateaus are allowed within moving sequences;
  wholly static sequences and ambiguous repeated endpoint frames cannot establish
  exact traversal/boundaries. Competing valid locations survive subsequent rounds.
- If keyframes miss a shot, search denser source passes. A budget/cancel check
  terminates decoding and preserves truthful partial results.

Search uses exact batched vector products for these compact movie indexes.
Faiss is not required on Windows. No additional general-purpose local language
model replaces ChatGPT. SSCD proposes locations; ChatGPT still reviews actual
evidence and records BROWSE/SELECT through the existing selection interface.

**VERIFIED is a machine geometric/temporal check, not editorial PASS or a
universal ±1-frame guarantee.** Returned endpoints are real matched frame times,
not frame-number/rounded-fps estimates. **LOCATED** means at least three interior
frames establish a consistent source location, while one or both endpoints
remain unconfirmed. Its `sourceLocationWindow` spans only those confirmed frames;
it has no asserted full-shot source in/out. Static poses, fades, optical flow,
heavy blur/overlays, duplicate footage, missed cuts or very brief source shots can
remain unresolved. Similar-looking frames alone are not enough. Candidate checks
are available for GPT review and further inspection. A report with LOCATED or
UNRESOLVED rows remains PARTIAL, even if all source locations are found.

The default 480-second budget bounds analysis effort, **not successful recovery
of every possible shot**. Install/download time and process/model startup are
separate. Five/eight-minute first-run goals remain unproved for a two-hour 4K
movie until a measured, ground-truth evaluation on that input is complete.

## Validation

`python -m pytest scripts/source-match/test_engine.py -q` runs encoded-video
fixtures with known source frames, cropped/graded copies, reverse playback,
cache reuse/invalidation, unrelated-footage rejection and budget persistence.
The v1.1 fixtures also exercise joint nonlinear paths, slow-motion plateaus,
resumption of partial indexes, round-robin verification under an expiring budget,
repeated endpoint ambiguity, variable-frame-rate exclusive ends and FFmpeg PTS
transport. On a CPU host the latter replaces CUDA decode/scale only; it does not
constitute a test of GPU filter execution or SSCD accuracy/performance.
The v1.1.1 checks also cover deferred weak candidates, rejection before endpoint
decoding, and reuse of overlapping dense intervals.

Reports retain bounded stage events and `metrics` for descriptor inference time,
geometric matching time, encoded images, sparse/dense verification frames,
dense-window duration and reused cache descriptors. Overlapping pipeline work and
small diagnostic fixtures must not be presented as a two-hour GPU speed benchmark.

`node --test tests/source-match-service.test.mjs` tests idempotent submission,
bounded work, durable results, cancellation, invalid requests and interrupted
receipts. Gateway tests verify that matching does not invoke assignment lifecycle
or AE writes. Existing footage-selection and panel tests preserve GPT authority.

Run `npm run typecheck`, `npm run validate:schemas` and `npm run build:test-runtime`
before deployment. Retain real cold-run/warm-run logs, report JSON, source metadata
and frame evidence. Count unresolved/false matches and endpoint error separately
from throughput; a fast partial report is not a full accurate match benchmark.
