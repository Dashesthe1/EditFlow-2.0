# EditFlow Source Match Service

This is the standard requested source-discovery measurement path in Practice.
Include `assignmentId` in SUBMIT to retain the matching job in the existing
one-call resume response. The worker receives matching/refinement/assembly
instructions together with retained selections and the normal AE queue.
Starting Practice delegates these steps to ChatGPT; it does not let the server
manufacture visual PASS, select editing settings or resume a paused assignment.
Older retained assignments receive the current discovery and assembly instructions
when resumed. SELECT accepts `search.internetStatus:"NOT_REQUIRED"` with a reason
and `strategies:["SOURCE_MATCH_SERVICE","DIRECT_PIXEL_INSPECTION"]` when the supplied
source is found locally. Issued reference/raw comparison evidence is still required;
this avoids a redundant web search without replacing direct pixel review.

## Targeted continuation

Use `refine_source_match` / POST `REFINE` with `{requestId,jobId,shotIds?,windows?,budgetSeconds}`.
Each window is `{shotId,sourceIndex,start,end}` in seconds, at most 120 seconds.
Omit shotIds to target every non-VERIFIED row. The service snapshots the parent
report into a new durable job, binds its hash, revalidates media and exact cuts,
and preserves other shots and their original evidence. It rechecks known source
locations at 1280px and reuses global descriptor caches only for unlocated targets.
The old report is never overwritten. A changed refinement needs a new requestId.
Explicit short windows also screen sparse pixels geometrically before dense
frame recovery, so poor embedding retrieval need not hide a visually matching
frame inside the chosen window. This costs additional bounded verification work;
the same measured-PTS, geometry, temporal and ambiguity checks still apply.

Candidate discovery uses several reference moments, so a weak/text-heavy middle
does not hide a location proposed by another visible anchor. Verification avoids
rechecking an already covered candidate interval. Joint temporal paths and the
existing geometry/ambiguity gates still apply. `boundaryDiagnostics` distinguishes
low-information reference endpoints from unconfirmed/ambiguous correspondences.
A black or occluded boundary cannot reveal an exact underlying movie frame.
Refinement preserves that uncertainty rather than extrapolating timestamps.
Requested difficult-shot refinement can inspect other moments after a weak or
occluded middle. At least three measured moments must still form a valid path;
missing endpoints never become an asserted full-shot range.

The latest v1.3.0 Ultron continuation has located all 21 visually partitioned shots,
with eleven verified full ranges and ten interior-only locations. Its report is
PARTIAL and cannot start the exact-range assembly. Black/text-only, flashed and
otherwise unconfirmed endpoints remain open; a rendered black frame does not
identify the underlying original trim. See [BENCHMARK.md](BENCHMARK.md) for the
retained jobs, measured timings and limits of the validation.

Practice resume includes `sourceMatch.retained`, `sourceAssembly.retained` and
the appropriate next operation. Prepared media remains READY; ASSEMBLED requires
successful queue receipts for every batch. Requesting a previously submitted
ASSEMBLY_PLAN returns its retained job receipt, preventing accidental replay.

## Post-verification AE assembly

Engine v1.4.0 retains actual first/last reference pixels in `boundaryEvidence`,
uses full refinement resolution for reference queries, and normalizes visible
dark/flashed detail before geometric checks. Flat black/white images remain
insufficient. High-resolution verification also retains the 640px reference
comparison, because strong grading can change which feature points survive at
different scales. Each scale passes the same geometric acceptance checks.
A complete path may finish an interior location only when every
retained anchor has exactly the same source PTS; stronger competing copies still
prevent certification. Refinement also tests a path constrained to those exact
retained interior frames. Every fixed frame must pass a fresh pixel check, and
endpoint ambiguity is still evaluated against all unrestricted endpoint options.

`import_source_timeline` / POST `IMPORT_TIMELINE` accepts
`{requestId,jobId,timelinePath,budgetSeconds}` for a canonical JSON export from the
actual original edit project. This is an explicit evidence importer, not a native
`.aep`, FCPXML or EDL parser. The export uses schema
`editflow.original-timeline-frame-map.v1`, the retained `referenceFingerprint` and
ordered `sourceFingerprints`, and `provenance:{kind:"ORIGINAL_EDIT_PROJECT_EXPORT",
projectPath,projectSha256,exporter}`. Each shot provides `shotId,sourceIndex,
referenceStart,referenceEnd,referenceTimeBase,sourceInPts,sourceOutPtsExclusive,
sourceTimeBase,direction` and `frames:[{referencePts,sourcePts}]` for every actual
reference frame. PTS fields are integers; direction is FORWARD or REVERSE. Exact
input identities, project/export hashes, decoded frame existence, exclusive end,
traversal and every retained pixel anchor are checked. At least three anchors
must recheck geometrically. Metadata-derived endpoints retain the explicit
`ORIGINAL_TIMELINE_FRAME_MAP` status and provenance. Never infer such an export
from rendered black/occluded pixels or label a guessed trim as original metadata.

Use `service_fixture.py --output <dir> --shots 20` to create a known original
project, including hidden endpoint overlays. After reviewing its pictures,
`node scripts/source-match/service_check.mjs <dir>/fixture.json <runtime-config>`
checks actual service matching, the original export, immutable parent evidence,
official timestamps, extraction, exact known ranges and the AE plan in reference
order. Its small fixture is not a real-movie accuracy or throughput evaluation.

The separate Source Assembly handoff runs only after the complete report has
verified every full-shot endpoint and GPT has directly reviewed every shot.
It saves `official-timestamps.json` before extracting any media. Incomplete
reports, unfinished alternative review, omitted shots and changed sources cannot
produce an assembly plan.

Use `prepare_source_assembly` / POST `PREPARE_ASSEMBLY` with a stable requestId,
the completed matching jobId, explicit encoder `NVENC` or `CPU`, a complete GPT
review and output composition settings. The full request shape is published in
the `sourceAssembly` contract returned by production status. Poll
`get_source_assembly` / GET `?assemblyId=...` until READY. Preparation may run while
Practice is paused and never resumes it or writes AE.

Preparation extracts only the original source ranges, with two bounded workers,
preserving resolution and observed frame timing. CPU uses 10-bit ProRes 422 HQ
and is recommended for 10-bit originals. NVENC uses CUDA decoding and 8-bit H.264
QP 10; choosing it explicitly accepts reduced precision for 10-bit originals.
HEVC working clips are avoided after the real AE importer crashed. These are high-quality
transcodes, not bit-identical copies. The raw movie is unchanged; movie audio and
Finished pixels are excluded from the clips. Each clip is checked against decoded
original frames for frame count, PTS spacing and first/last pixel consistency.
The manifest retains the original PTS for every extracted source frame.

`plan_source_assembly` / POST `ASSEMBLY_PLAN` builds exact AE_TRANSACTION payloads
against the current AE revision. Enqueue unchanged through the existing durable
production queue with this chat's issued researchContext. The plan creates a new
composition, imports bounded clips, places them contiguously in Finished shot
order and trims each layer. Never sort by movie timestamps. Raw ranges initially
play at original speed; reverse playback, reference retiming and effects remain
explicit editing steps. Current compositions and raw song layers are preserved.

Twenty shots fit in one 61-operation transaction; longer sequences use batches
of at most 21 shots/64 operations, with the preceding batch committed first.
The normal queue checkpoints each batch and retains actual readbacks. A changed
manifest, report, raw file, bounded clip or operation sequence rejects execution.
Partial/unknown AE writes retain the existing reconciliation rules.

`cancel_source_assembly` / POST `CANCEL_ASSEMBLY` stops only bounded media
preparation, including decoder descendants. It keeps the official timestamp
manifest and a CANCELLED receipt, and does not cancel accepted AE queue work.

The complete extraction/import/checkpoint target is **300 seconds**, not a
guaranteed worst-case bound. Run `test_assembly_ranges.py` for known-frame CFR,
VFR and nonzero-origin checks. `assembly_check.py` measures extraction alone
using repeated endpoint-verified ranges; it does not certify a complete edit.

`resume_source_assembly` / POST `RESUME_ASSEMBLY` takes `{assemblyId}`. Failed or
interrupted extraction resumes under the same official manifest after validating
all identities and provenance. Completed cuts carry atomic receipts binding the
encoder recipe and current clip fingerprint; intact cuts are reused, while changed
clips are rejected. An OS worker lock excludes overlapping extraction processes.
Cancelled preparation resumes only by an explicit decision. No resume changes
Practice lifecycle or replays accepted AE batches.

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
- Compare candidate locations by mean geometric evidence per anchor. Stronger
  interior evidence takes priority over weak complete-looking endpoint matches;
  equally strong competing locations remain unresolved.
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
The v1.1.2 checks verify that location priority retains deferred alternatives and
rejects competing copies in the same source file.
The v1.1.3 check prevents weak complete hypotheses displacing stronger interior
locations and compares competing evidence independently of anchor count.

On the installed CUDA runtime, run `python scripts/source-match/gpu_check.py
--model <installed-sscd-model> --output <evidence-directory>` to check cropped/graded,
reversed and retimed known-frame copies, faded boundaries and unrelated footage.
The output retains the actual GPU name, engine hash and endpoint errors for these
small encoded fixtures. It is not a real-movie accuracy or speed evaluation.

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
