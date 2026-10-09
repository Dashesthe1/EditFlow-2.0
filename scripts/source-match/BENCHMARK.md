# Source Match Service evaluation — 9 October 2026

The service is live at v1.4.0 and integrated into Practice discovery/resume. Original-project frame-map import, boundary evidence, reference-scale checks and resumable verified-cut extraction are implemented. A real twenty-shot known-frame service handoff reached the native AE Practice checkpoint **56.253 seconds after official timestamps were saved**, including an intentional extraction cancellation/resume and the isolated-lab setup. This is a 320×240 fixture, not a two-hour 4K benchmark. The real Ultron report still has unconfirmed endpoints, so its exact-range assembly gate remains closed. Historical measurements follow, then the current continuation results.

## Input and device

- NVIDIA RTX A4500; isolated Python 3.12, PyTorch 2.6/CUDA 12.4 and the pinned official SSCD model.
- Finished reference: 35.234972 seconds, 1080×1920, h264.
- Supplied raw source: 1518.975792 seconds (00:25:18.976), 3840×1600, hevc. This is **25 minutes, not a two-hour movie**.
- Twenty explicit, rounded reference intervals were used. They are partition inputs, not independently annotated ground truth. Some include a neighbouring cut or a fade; default cut detection is advisory.
- GPU/PyAV PTS cross-check at source 900 s returned the same original PTS 21600579, time base 1/24000, time 900.024125 s.

## Measurements

| Run | Analysis seconds | Locations found | Measured endpoint rows | Interior-only rows | Unresolved locations |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fresh descriptor cache | 480.375 | 13/20 | 3 | 10 | 7 |
| Cached descriptors, revised interior checks | 300.312 | 16/20 | 3 | 13 | 4 |

Both jobs returned PARTIAL at their requested budgets, with process exit code 0. Process/model startup added about four seconds to each job receipt. The verification implementation changed between runs, so this is **not a controlled cache-speedup comparison**. Installation/download time is excluded.

The historical verification code for those two rows is commit f3e1cdb; engine SHA-256: `7f72e7ad96a5fc8fbf8a7f3a523cefc26775ad755e358e8fe4b90a79bb5dad2e`.
No independent endpoint-error or false-positive-rate evaluation has been performed on these real files. The displayed middle-frame contact-sheet pairs were visually inspected for location consistency; this is not a beginning/middle/end editing PASS.

## Retained results

Cold job: `source-match-fa68df84-3f71-4135-8ac3-a7a0a82d6019`.
Cached job: `source-match-02c39049-4b3d-4a8e-860d-9b5520890073`.

Use `get_source_match(job_id)` to retrieve the durable report, original integer PTS/time bases, all anchor pairs, two evidence contact sheets and CSV on the Shadow PC. The cold job also retains a confirmed interior location for segment 008, which the shorter cached run did not revisit before expiry.

The server advertises `start_source_match`, `get_source_match`, and `cancel_source_match`. This chat's cached connector tool list has not refreshed to include the new names; refresh the existing Current Shadow connection to expose them. The authenticated product API has been tested directly. No new assignment/controller is needed.

### Historical cached report

Source time spans below are **not interchangeable**: VERIFIED rows have measured endpoint correspondences; LOCATED rows show only the span of confirmed interior frames and have no asserted full-shot in/out. All require GPT review before BROWSE/SELECT.

| Segment | Reference seconds | Machine status | Source evidence span |
| --- | --- | --- | --- |
| shot-001 | 0.000–0.670 | LOCATED | 00:16:52.553–00:16:53.054 (interior frames only) |
| shot-002 | 0.670–4.540 | VERIFIED | 00:16:53.054–00:16:56.849 (measured endpoints) |
| shot-003 | 4.540–7.170 | LOCATED | 00:16:56.891–00:16:58.851 (interior frames only) |
| shot-004 | 7.170–10.880 | VERIFIED | 00:16:59.519–00:17:03.231 (measured endpoints) |
| shot-005 | 10.880–12.580 | VERIFIED | 00:17:03.272–00:17:04.941 (measured endpoints) |
| shot-006 | 12.580–16.550 | LOCATED | 00:17:04.982–00:17:07.944 (interior frames only) |
| shot-007 | 16.550–24.890 | LOCATED | 00:17:08.945–00:17:15.201 (interior frames only) |
| shot-008 | 24.890–25.630 | UNRESOLVED | — |
| shot-009 | 25.630–26.360 | LOCATED | 00:21:01.302–00:21:01.594 (interior frames only) |
| shot-010 | 26.360–27.090 | LOCATED | 00:19:15.821–00:19:16.113 (interior frames only) |
| shot-011 | 27.090–27.830 | UNRESOLVED | — |
| shot-012 | 27.830–29.330 | UNRESOLVED | — |
| shot-013 | 29.330–30.100 | LOCATED | 00:12:32.543–00:12:32.752 (interior frames only) |
| shot-014 | 30.100–30.830 | LOCATED | 00:15:02.652–00:15:02.902 (interior frames only) |
| shot-015 | 30.830–31.560 | UNRESOLVED | — |
| shot-016 | 31.560–32.330 | LOCATED | 00:19:11.067–00:19:11.359 (interior frames only) |
| shot-017 | 32.330–33.070 | LOCATED | 00:21:09.727–00:21:10.019 (interior frames only) |
| shot-018 | 33.070–33.800 | LOCATED | 00:23:57.603–00:23:57.895 (interior frames only) |
| shot-019 | 33.800–34.570 | LOCATED | 00:24:03.400–00:24:04.193 (interior frames only) |
| shot-020 | 34.570–35.235 | LOCATED | 00:24:24.380–00:24:24.755 (interior frames only) |

## Validation and retained state

- Nine encoded-video tests cover cropped/graded copies, reversal, retiming, faded endpoints, unrelated/duplicate rejection, cache identity and budget persistence.
- Sixteen service/selection/panel tests, 21 gateway tests and 47 schema fixtures pass; TypeScript checking and runtime build pass.
- Live resubmission returned the same job ID. Cancellation retained partial results. Public requests cannot choose an executable, backend or device.
- Existing assignment and generation 134 remain explicitly PAUSED; the same six production receipts remain unchanged. AE remains open and the CEP panel is connected. Existing unfinished UI changes were preserved.
- ChatGPT remains the editorial authority. The matcher neither selects/imports footage nor writes to AE.

At that historical stage, remaining acceptance work included four unlocated segments, independent endpoint-error measurement and a real two-hour 4K input. New results follow below. Fades, duplicated/frozen frames and ambiguous copies may require explicitly unresolved boundaries instead of exact claims.

## Initial v1.1 follow-up — hardware was offline

The interrupted work was recovered from commit `4b507ac`. The follow-up changes
add progressive bounded verification, round-robin candidate attempts, resumption
of committed partial descriptor indexes, sparse candidate decoding followed by
narrow consecutive-frame windows, and joint monotone alignment for speed ramps.
Timestamp sampling precedes GPU readback; filter time bases are explicitly mapped
to original integer PTS. Repeated endpoint ambiguity stays LOCATED, and exclusive
ends require observed durations. Existing compatible descriptor caches survive.

Local validation passed 17 Python matcher tests, 14 Node service/selection/integration
tests, 22 Python gateway tests (plus six subtests), all 47 schema fixtures,
TypeScript checking and the runtime build. Matcher tests use the explicit
diagnostic backend on CPU; the FFmpeg PTS transport test replaces CUDA decode/scale
only. These checks do not validate actual CUDA filter execution or SSCD inference.

Desktop Commander confirmed the Shadow device offline during this follow-up.
The live EditFlow read still reported the previous build, generation 134 PAUSED,
and no held mutation lease. No deployment or new Ultron benchmark is claimed.
The measurements above describe that earlier implementation. The deployment and
new measurements below supersede the offline status. The five/eight-minute
two-hour target remains unproved, and real endpoint ground truth is still required.

## Resumed deployment and new measurements

Shadow reconnected. The runtime was upgraded to v1.1.2, implementation commit
`2f858f3f876ad336a5f47d5fe99542ebbcedfca0`, engine SHA-256
`a6251610a2f4cedd1a90bbc407c3e49562eb1ca7857b94a39abea0c80541a9bc`.
The four existing UI edits were hashed before/after each fast-forward and preserved.
Only the idle control daemon was reloaded; the same AfterFX process, assignment,
generation 134 and six production receipts were retained. Practice stayed PAUSED.

The same original twenty rounded shot intervals, source file, pinned SSCD model,
candidateLimit 3 and 480-second budget were used for these three fresh descriptor
cache runs. Previous cache directories and jobs were retained. Each row is one
observation, with changes between versions; no repeated-run confidence interval
or cold filesystem-cache comparison is claimed.

| Engine | Analysis seconds | Receipt seconds including startup | Locations | Measured endpoint rows | Interior-only rows | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v1.1.0 | 480.391 | 484.193 | 17/20 | 3 | 14 | 3 |
| v1.1.1 | 480.328 | 484.315 | 18/20 | 3 | 15 | 2 |
| v1.1.2 | 480.344 | 484.263 | 19/20 | 3 | 16 | 1 |

All returned PARTIAL with exit code 0. Fresh caches had zero reused descriptors.
The latest run finished all keyframe, 0.5-second and 0.125-second descriptor
passes, but the budget expired during verification. `alternativeReviewComplete`
is false: the bounded final competing-location review had not finished. The
19 located rows must not be reported as 95% exact-boundary accuracy. Segment 012
remained unlocated, and sixteen other rows retained unconfirmed endpoints.

v1.1.1 defers weak proposals during incomplete source scans and rejects the middle
anchor before opening endpoint decoders. v1.1.2 gives missing locations denser
passes before checking extra alternatives for known locations. Competing evidence
persists, and a COMPLETE report requires the final bounded alternative review.
Acceptance checks were not weakened to improve the counts.

| Diagnostic metric | v1.1.0 | v1.1.1 | v1.1.2 |
| --- | ---: | ---: | ---: |
| Encoded images, including verification | 20,060 | 22,943 | 40,892 |
| SSCD inference seconds | 71.704 | 82.622 | 152.824 |
| Geometric comparisons | 5,022 | 5,290 | 4,030 |
| Geometric matching seconds | 72.390 | 81.588 | 58.158 |
| Dense verification frames | 5,095 | 2,626 | 1,961 |
| Dense verification source-window seconds | 208.799 | 107.448 | 80.158 |

These metrics measure different stages and overlapping work, not additive elapsed
components. More encoded images in v1.1.2 reflect time available for the denser
source pass rather than a throughput regression claim.

Retained resumed jobs:

- v1.1.0: `source-match-0bf139e2-668c-4466-bca4-ace5428bf3b2`
- v1.1.1: `source-match-754c8088-7497-4028-b219-d4ecdbbd3329`
- v1.1.2: `source-match-1106e98f-85fc-414b-8dc8-4d90f2e6bf15`

Reports, CSV, original PTS/time bases, input identities, stage logs and frame
evidence remain under `%LOCALAPPDATA%\EditFlow2\source-match-jobs\<jobId>`.
The middle-frame pairs for the recovered v1.1.0 locations were visually inspected;
all five anchor pairs for its three endpoint rows were also inspected for pose and
scene consistency. v1.1.1 segment 008's reference/source pair was inspected too.
This supports location consistency, not an independent endpoint-error evaluation
or editing acceptance. No real-file false-positive rate has been measured.

## Actual CUDA validation

GPU-decoded original integer timestamps were cross-checked against PyAV at source
900 seconds: five sampled PTS matched exactly, first PTS 21600579, time base
1/24000. SSCD ran on the RTX A4500 rather than a diagnostic substitute.

Five small encoded 12fps fixture cases were run with SSCD/CUDA on v1.1.2:

| Known-frame case | Result | Engine seconds | Endpoint error |
| --- | --- | ---: | --- |
| Crop and grade | VERIFIED | 6.093 | 0 frames at both endpoints |
| Reverse | VERIFIED | 4.656 | 0 frames at both endpoints |
| Nonlinear retime with repeated frames | VERIFIED | 4.703 | 0 frames at both endpoints |
| Black/faded endpoints | LOCATED | 4.391 | No full-shot endpoints asserted |
| Unrelated constant footage | UNRESOLVED | 4.578 | No source timestamps asserted |

These are small synthetic known-frame checks, not 4K movie performance or
real-file accuracy evidence. The retained results are in
`%LOCALAPPDATA%\EditFlow2\source-match-benchmarks\v111-gpu-quality\results.json`
(the directory name predates the final v1.1.2 engine). `gpu_check.py` provides the
same reusable cases with explicit model/output arguments and actual GPU metadata.

Local v1.1.2 validation passed 22 matcher tests, 14 Node service/selection/integration
tests, 22 gateway tests plus six subtests, 47 schema fixtures, TypeScript checking
and the runtime build. The matcher suite additionally checks deferred alternatives
and rejects competing copies within one source file.

## Observed reference cuts and competing-location correction

Four contact sheets showed actual reference frames around the rounded cut list.
GPT recorded incoming partition start-frame indices
`0,20,136,214,326,377,495,745,767,789,811,833,878,900,923,945,967,990,1012,1034`.
The corresponding original decoded PTS replaced the rounded times. Black
transition frames were assigned to the incoming partition; their source identity
remains unverified. This is a visually inspected cut partition, not independent
source endpoint ground truth. The annotation and request remain under
`%LOCALAPPDATA%\EditFlow2\source-match-benchmarks\v11-reference-cuts`.

The v1.1.2 observed-cut run reused 31,418 descriptors and completed its bounded
alternative review in 418.360 analysis seconds (422.379 receipt seconds including
startup), with 9 VERIFIED, 9 LOCATED and 2 UNRESOLVED rows. It returned PARTIAL
without exhausting the 480-second budget. The code and cut list differ from the
fresh-cache rows, so this is not an isolated measurement of cache speedup.
Job: `source-match-fbf6c4a9-7d68-486b-9292-ffb0d3d4605f`.

The middle evidence for all eighteen locations and all five anchor pairs for
each of the nine endpoint rows were directly inspected for scene/pose consistency.
This does not establish independent real-file endpoint error or editing PASS.

Reviewing shot 019 exposed a selection defect: completeness was prioritized over
visual evidence strength. A weak complete-looking hypothesis at a different
source time displaced much stronger interior evidence, triggering an ambiguity
rejection. v1.1.3 compares mean geometric strength per anchor before completeness
and compares competing locations using the same normalized measure. Stronger
interior evidence can remain LOCATED instead of being displaced by weak endpoint
claims. Existing geometric, temporal and ambiguity thresholds remain in force.
Regression coverage passed 23 matcher tests, including the weak-complete versus
strong-interior case; the 14 Node tests, TypeScript checking and build also passed.

The live v1.1.3 implementation is commit
`283ec17258fa6e3b373290488657ebfcda1fdab8`, engine SHA-256
`cef4d645493d26541df07537da3afc6e80ebec7338a41715b34ae5456bac4c5b`.
The reusable `gpu_check.py` passed all five cases on that engine and reported the
actual device as NVIDIA RTX A4500. Crop/grade, reverse and nonlinear retime again
returned zero known-frame endpoint error; faded boundaries remained LOCATED and
unrelated footage remained UNRESOLVED. Its retained results are in
`%LOCALAPPDATA%\EditFlow2\source-match-benchmarks\v113-gpu-check\results.json`.

The latest warm observed-cut rerun uses job
`source-match-1cc5ae43-13f1-4945-bf4e-bce9e10669fc` and the identical input request,
candidateLimit, model, GPU, descriptor caches and budget as the v1.1.2 warm run.
The code correction is the only requested analysis change. This is one observation
per version; operating-system/cache/warmth variability is not controlled.


## Historical completed v1.1.3 report

The corrected warm run finished in 419.125 analysis seconds
(422.822 receipt seconds including startup), with **19/20 source
locations: 9 VERIFIED, 10 LOCATED and 1 UNRESOLVED**. It returned PARTIAL with
exit code 0, `alternativeReviewComplete:true`, and 31,418 reused descriptors.
The budget was not exhausted. The latest warm runtime is about seven minutes;
**complete exact recovery and a two-hour 4K target remain unproved**.

Shot 019 now retains the stronger interior correspondence at source
00:24:03.442–00:24:04.193, with no full-shot endpoints asserted. Its retained
anchor pairs were directly inspected for pose/scene consistency. The other nine
endpoint rows retain the same source measurements as the preceding observed-cut
run. Shot 012 remains unlocated after all three source sampling passes and bounded
candidate checks; this does not prove it is absent from the supplied source.

The table rounds display times only. Use the report's actual seconds, integer PTS,
time bases and anchor mappings for implementation. VERIFIED spans have measured
endpoint correspondences; LOCATED spans cover confirmed interior frames only.
Neither machine status is GPT editing acceptance or a universal one-frame guarantee.

| Segment | Reference seconds | Machine status | Source evidence span |
| --- | --- | --- | --- |
| shot-001 | 0.000000–0.667913 | LOCATED | 00:16:52.553–00:16:53.012 (interior only) |
| shot-002 | 0.667913–4.541711 | VERIFIED | 00:16:53.012–00:16:56.849 |
| shot-003 | 4.541711–7.146540 | LOCATED | 00:16:57.433–00:16:58.851 (interior only) |
| shot-004 | 7.146540–10.886755 | LOCATED | 00:17:00.436–00:17:03.231 (interior only) |
| shot-005 | 10.886755–12.589901 | VERIFIED | 00:17:03.272–00:17:04.941 |
| shot-006 | 12.589901–16.530490 | VERIFIED | 00:17:04.982–00:17:08.611 |
| shot-007 | 16.530490–24.879208 | LOCATED | 00:17:10.988–00:17:17.245 (interior only) |
| shot-008 | 24.879208–25.613913 | VERIFIED | 00:20:55.921–00:20:56.297 |
| shot-009 | 25.613913–26.348584 | VERIFIED | 00:21:01.260–00:21:01.677 |
| shot-010 | 26.348584–27.083289 | LOCATED | 00:19:15.905–00:19:16.197 (interior only) |
| shot-011 | 27.083289–27.817960 | VERIFIED | 00:19:22.536–00:19:22.745 |
| shot-012 | 27.817960–29.320732 | UNRESOLVED | — |
| shot-013 | 29.320732–30.055437 | VERIFIED | 00:12:32.585–00:12:33.002 |
| shot-014 | 30.055437–30.823504 | LOCATED | 00:15:02.735–00:15:03.027 (interior only) |
| shot-015 | 30.823504–31.558209 | LOCATED | 00:15:05.822–00:15:07.073 (interior only) |
| shot-016 | 31.558209–32.292880 | VERIFIED | 00:19:11.067–00:19:11.442 |
| shot-017 | 32.292880–33.060980 | LOCATED | 00:21:09.768–00:21:10.060 (interior only) |
| shot-018 | 33.060980–33.795652 | VERIFIED | 00:23:57.603–00:23:57.978 |
| shot-019 | 33.795652–34.530357 | LOCATED | 00:24:03.442–00:24:04.193 (interior only) |
| shot-020 | 34.530357–35.234972 | LOCATED | 00:24:24.254–00:24:24.421 (interior only) |

This run encoded 14,715 images, spent 51.763 seconds in SSCD inference and
102.926 seconds in 6,345 geometric comparisons, and decoded 2,697 dense
verification frames over 110.313 source-window seconds. These stage metrics are
not additive elapsed components.

The practical limits remain one unlocated shot, ten unconfirmed full-shot
boundaries, unmeasured independent real-file endpoint/false-positive error, and
unmeasured performance on a genuine two-hour 4K movie. The service preserves these
limits in the returned evidence rather than inventing timestamps.

## Post-timestamp source assembly

The added handoff saves a complete official timestamp receipt and direct GPT review
before extracting any bounded source clips. It generates exact AE_TRANSACTION
batches in Finished reference order, using the existing durable queue and AEP
checkpoints. It does not resume paused assignments. Raw ranges play contiguously
at original speed; reference retiming and effects remain subsequent explicit edits.

On the same RTX A4500 PC, twenty 4K ranges totalling 28.111417 source seconds and
674 original frames were extracted from the supplied movie. They repeat the nine
endpoint-verified rows from the latest partial report: this measures materialization,
not twenty independent matching successes or permission to assemble the real edit.

| Working format | Extraction seconds | Maximum frame-timing error | Maximum endpoint mean pixel error (0–255) |
| --- | ---: | ---: | ---: |
| Initial NVENC HEVC, rejected after AE importer crash | 66.922 | 2.20e-13 s | 0.08236 |
| CPU ProRes 422 HQ, 10-bit | 138.657 | 2.20e-13 s | 0.07872 |

HEVC working output was removed after the actual AE 25.6.6 importer crashed on the
test clip. CPU now produces 10-bit ProRes 422 HQ; NVENC produces explicitly 8-bit
H.264 QP 10. Originals are unchanged. These are high-quality transcodes rather
than bit-identical copies. Choose CPU for 10-bit original precision.

Known-frame extraction tests pass for CFR, VFR and nonzero source origins, and
reject changed inputs and non-frame boundaries. Eight assembly service tests cover
all-shot/GPT gates, complete reference coverage, idempotency, reversed source
chronology, multi-batch ordering, and altered reports, plans, sources or clips.
The real AE PRACTICE queue assembled those twenty ProRes clips in **7.543 seconds**
with 61 exact operations, the correct chronological layer IDs, unchanged whole-frame
spans, and a saved AEP checkpoint. Maximum native timing readback difference was
20.812 microseconds (less than 0.001 source frame), within AE's rational-clock
precision. Native readbacks and receipts are retained under
`proofs/artifacts/source-assembly-prores-final` on Shadow.

Extraction and assembly were measured separately; their sum is 146.200 seconds,
within the 300-second target for this fixture. This is not an end-to-end official
report handoff, a universal timing guarantee, or acceptance of the real twenty-shot
edit. The real report remains partial, so its all-shot assembly gate stays closed.
The isolated test restored the original empty project and did not resume generation
134. The host crash required a restart; normal startup was restored by supplying
standard Windows folder environment variables missing from the remote subprocess.
Original AE preferences were restored after diagnostic cache/pref rebuild attempts.

## Current v1.3.0 continuation and Practice integration

Direct inspection split the previous merged segment at reference 28.586061 s,
producing 21 ordered partitions. The corrected reference cut list is retained in
the jobs below, with original frame times rather than the display-rounded value.
The corrected full cached search ran before this continuation; the following jobs
reuse its measurements, caches and/or known locations. Their elapsed times must
not be presented as one cold full-movie run or a five-minute complete solution.

| Job and scope | Analysis seconds | Full verified ranges | Interior-only locations | Unlocated shots |
| --- | ---: | ---: | ---: | ---: |
| Corrected 21-shot cached search, c0346b0a | 415.672 | 9 | 11 | 1 |
| v1.2.0 missing-shot multi-query refinement, 8e05f442 | 117.703 | 9 | 11 | 1 |
| v1.2.1 all twelve unfinished ranges, ea1a448a | 142.453 | 9 | 11 | 1 |
| v1.3.0 explicit geometric church window, 1f300d1b | 41.781 | 9 | 12 | 0 |
| v1.3.0 explicit five-shot boundary windows, 4c3065c7 | 121.329 | 11 | 10 | 0 |

The exact retained IDs are:

- `source-match-c0346b0a-5148-4698-91c5-c8b144958d65`
- `source-match-8e05f442-2718-43f8-9d9d-b295c6dafd67`
- `source-match-ea1a448a-e85b-413a-947c-60d5cd95833f`
- `source-match-1f300d1b-6e41-4b3a-bf4d-a4a148d1bea9`
- `source-match-4c3065c7-feab-43b1-b402-709ce0dbc01d`

v1.2.0's single-shot refinement left every non-target shot object and the media
metadata semantically unchanged. v1.2.1 revisited retained locations at 1280px,
without scanning the movie or reusing descriptor rows; no full-range count improved.
Diagnostics identified seven low-information reference endpoints and four other
unconfirmed endpoint correspondences, plus the then-unlocated church shot.

v1.3.0 geometrically screened the explicit source 260–290 s window when SSCD
retrieval missed the heavily graded portrait crop. Four measured interior anchors
located shot-013 at source **274.274–274.607667 s**. The displayed beginning and
ending interior reference/source pairs were directly inspected for Ultron's pose,
chapel background and source identity. These are interior evidence, not official
full-shot in/out or an editing PASS. The reference shot begins at 28.586061 s;
that endpoint remains unconfirmed. `alternativeReviewComplete:true` does not
upgrade the report beyond PARTIAL.

The church-window run encoded 555 images, spent 3.126 seconds in SSCD inference
and 7.047 seconds in 1,389 geometric comparisons, and decoded 62 dense frames over
2.555 source-window seconds. Pipeline metrics overlap and are not additive elapsed
components. Short-window proposal scores are explicitly null with retained/window
provenance; their seed priority is never represented as SSCD similarity.

The final pass explicitly screened five short windows, extending each retained
interior span by two seconds on either side. Shot-016 recovered measured source
905.613041667–906.030125 s, and shot-020 recovered 1443.275166667–1443.692250 s.
All five reference/source pairs for both shots were directly inspected for pose,
background and source consistency, including the actual endpoint frames. The
portrait crop and strong reference grade explain the different overall appearance.
Sixteen non-target shot objects remained exactly unchanged. The pass encoded 603
images, used 3.500 inference seconds and 39.842 seconds for 2,271 geometric checks,
and decoded 312 dense frames over 12.802 source-window seconds. No descriptor
rows were read and no full-movie scan was repeated. It completed the bounded
alternative review and returned PARTIAL, with exit code 0.

Ten ranges remain interior-only: seven low-information endpoints and three other
unconfirmed correspondences (shots 003, 007 and 013). Direct inspection of those
three actual reference endpoint frames showed a dark but visible Wanda/Ultron
image (003), text over black with no source picture (007), and a flashed Ultron
image (013). The latter two visible-picture cases still lack confirmed exact
source-frame correspondence; the black/text-only case cannot reveal its hidden
trim. A live PREPARE_ASSEMBLY
request for the partial report returned HTTP 400 ALL_SHOT_ENDPOINTS_REQUIRED,
with zero official receipts before and after the request. No guessed ranges were
cut or imported into the actual Practice assignment.

Engine v1.3.0 SHA-256 is
`30bcbba6848a367572e523f44b12c947c18e73868fe523943251c251aaa6833d`.
Five true SSCD/CUDA known-frame fixtures passed on the RTX A4500:

| Case | Result | Analysis seconds | Known endpoint error |
| --- | --- | ---: | --- |
| Crop and grade | VERIFIED | 5.781 | 0 frames at both endpoints |
| Reverse | VERIFIED | 4.610 | 0 frames at both endpoints |
| Nonlinear retime | VERIFIED | 4.531 | 0 frames at both endpoints |
| Faded endpoints | LOCATED | 4.062 | No full endpoints asserted |
| Unrelated footage | UNRESOLVED | 2.578 | No source timestamps asserted |

Results are retained in
`%LOCALAPPDATA%\EditFlow2\source-match-benchmarks\v130-gpu-quality\results.json`.
These small 12fps fixtures establish their known-frame behavior, not independent
real-movie endpoint error, false-positive rate or worst-case two-hour speed.

The integrated resume now retains matching lineage, remaining boundary diagnostics,
prepared assemblies and actual AE queue receipts. It refines unfinished shots
instead of repeating discovery, advances directly to Source Assembly after complete
endpoints and GPT review, and reports ASSEMBLED only after all batches succeed.
Duplicate plans reuse existing receipts. Cancellation stops preparation descendants
while preserving official timestamps and accepted AE work. A Windows status race
that could overwrite READY with INTERRUPTED was reproduced and fixed; 400 concurrent
polls are covered. Direct local pixel discovery no longer requires a redundant
internet search, and older stored assignments receive the current worker policy.

Local validation passed 27 encoded matcher tests, 49 Node service/selection/resume
and production integration tests, two extraction tests, 24 gateway tests, all 47
schema fixtures, TypeScript checking and the runtime build. The live Windows
49-test Windows integration suite and true GPU fixtures also passed. Generation 134
remains explicitly PAUSED; maintenance retains AE and unrelated unfinished UI edits.

The real exact-boundary task remains incomplete: eleven full ranges are measured,
ten are interior-only. No real 21-shot extraction/AE assembly is claimed.
Where the underlying source frame is hidden by black pixels or overlays, original
timeline/project trim metadata may be needed to prove exact endpoints. Other
unconfirmed endpoints still need stronger direct evidence. The system preserves
those limits rather than inventing an official timestamp.

## v1.4.0 service completion and native handoff

The completed capability paths include an original-project evidence importer and
durable extraction recovery. The importer accepts the documented canonical JSON
frame map, not arbitrary native .aep/FCPXML/EDL files. It binds the actual original
project and export hashes, exact reference/source identities and every decoded
reference frame's integer source PTS. Every retained pixel anchor must agree and
at least three must pass a fresh geometry check. Hidden endpoints receive an
explicit ORIGINAL_TIMELINE_FRAME_MAP status rather than a false pixel-match claim.
Missing original project evidence is not replaced by inferred metadata.

Each extracted cut now retains an atomic recipe/media/frame receipt. Explicit
RESUME_ASSEMBLY preserves the original assemblyId and official timestamps,
validates all retained identities, and reuses intact completed cuts. An OS lock
rejects concurrent extraction workers. Changed project/export bytes, source files,
clips, recipes, reports and AE operation sequences fail integrity checks. An
intermittent Windows EPERM on atomic receipt replacement was reproduced under
concurrent polling and fixed with bounded retries; no target receipt is unlinked.

The service fixture is a genuine original test project: twenty 2-second shots
alternating raw frames 24–47 and 12–35, with black overlays on the final shot's
first and last reference frames. The original definition existed before rendering
and matching. The actual SSCD/CUDA service returned 19 VERIFIED and 1 LOCATED in
163.703 analysis seconds. Importing its original frame map then produced COMPLETE
with twenty exactly correct known ranges. The parent report stayed unchanged.
Preparation was deliberately cancelled after two completed cut receipts, then
resumed under the same manifest; both cuts were reused. Official timestamps to
all prepared media took 4.847 seconds; matching through prepared media took
173.889 receipt seconds. Native AE was tested through the actual saved assembly
service plan and existing durable queue, rather than a re-created timestamp table.

| Native mode | Ordered shots | Exact operations | Assembly/readback seconds | Official save to committed checkpoint | Timing error |
| --- | ---: | ---: | ---: | ---: | ---: |
| Practice | 20 | 61 | 9.488 | 56.253 s | 0 s |
| Pro Creation | 20 | 61 | 8.383 | 85.825 s | 0 s |

The checkpoint interval uses the actual official `savedAt` and durable SUCCEEDED
queue timestamp, including the test-harness gap and all intervening work. It is
not a sum of two independent stopwatch runs. Both modes checked ordered layer
identities, contiguous source spans, native whole-frame timing and saved AEP
checkpoints. The exact original empty AE project was restored; AE PID 2348 stayed
open and responsive. Generation 134 remained PAUSED with activitySeq 2576, and
the four pre-existing UI edits were preserved. These fixture timings establish
the handoff for this input, not a universal five-minute bound.

Retained live evidence:

- Parent: `source-match-a55e4253-02fa-4043-889e-e9d9e3400435`
- Complete original-project import: `source-match-499137e2-ed37-4228-b6cc-014f5ab855b3`
- Actual saved assembly: `source-assembly-108a9ad0-211c-4a73-b68d-bb0455d8dca5`
- Native receipts/readbacks: `proofs/artifacts/source-match-v140-handoff/native`
- Full checkpoint timing: `proofs/artifacts/source-match-v140-handoff/official-native-timing.json`

Local validation passed 38 Python tests (including three CFR/VFR/origin subcases),
25 gateway tests, 51 Node integration tests, 47 schema fixtures, TypeScript and
the runtime build. The corrected Windows suite passed all 51 Node tests and all
four extraction tests. A separate local twenty-shot full service handoff also
passed, reusing two cuts after cancellation. The final retained-frame/reference-scale
changes passed all 30 matcher tests; the complete 38-test Python suite was rerun
successfully afterward.

Seven true SSCD/CUDA quality cases passed on the RTX A4500: crop/grade, reverse,
nonlinear retime, dark endpoint and flashed endpoint all returned VERIFIED with
zero known-frame endpoint error; fully faded endpoints remained LOCATED and
unrelated footage remained UNRESOLVED. These small 12fps fixtures are not an
independent real-movie false-positive or endpoint-error evaluation. Results are
retained under `%LOCALAPPDATA%/EditFlow2/source-match-benchmarks/v140-gpu-quality`.

The first v1.4.0 real two-target refinement, job
`source-match-70e5ed0a-c1de-4ead-a69c-b32b2f2f9395`, completed its alternative
review in 89.516 seconds with 11 VERIFIED, 10 LOCATED and 0 UNRESOLVED. Increased
reference resolution changed the strongest geometric path on the flashed shot;
it did not justify replacing the retained stronger interior frames. High-resolution
verification now also checks the 640px reference scale under identical gates.
Direct inspection of shot-003's last reference frame shows a Wanda/Ultron composite;
shot-013's first frame is flashed Ultron. Neither picture is treated as an original
timeline export. No original author project or frame-map file was present in the
supplied Typical Pro Edits directory. The real exact-boundary gate stays closed
until every endpoint has adequate evidence and direct GPT review.

The two-target multiscale pass, job
`source-match-db3a195f-eff8-4731-8a33-4e8e724666a2`, completed in 98.437 seconds
and retained 11 VERIFIED and 10 LOCATED. An additional correction now checks a
fresh full path constrained to the established interior frame PTS, rather than
requiring the unconstrained maximum-score path to rediscover identical interior
frames. Every fixed frame must remain a valid fresh correspondence; endpoint
ambiguity is checked against the original unrestricted options, and duration
proof and competing-copy checks remain mandatory.

This recovered shot-013's full source range **274.190583333–274.607666667 s**, with
original PTS 6580574–6590584 exclusive at time base 1/24000. Job
`source-match-3e1a5f5d-77a5-4397-8863-0a48848f56c8` completed in 48.407 seconds,
returned PARTIAL with **12 VERIFIED, 9 LOCATED, 0 UNRESOLVED**, and completed its
alternative review. All twenty non-target shot objects remained exactly unchanged.
The first, middle and last reference/raw pairs were directly inspected: flashed
Ultron in the church, consistent head/torso poses and the raised-hand endpoint.
This is measured source evidence, not a final creative editing PASS.

Eight remaining shots have black/text-only hidden boundaries; shot-003 ends in
a Wanda/Ultron composite. Their exact primary-source trims still require adequate
original-project evidence. The system can now import and verify such evidence,
but the author project/export was not supplied. It cannot reconstruct uniquely
hidden trims from these rendered pixels. No real 21-shot official extraction or
AE assembly was created, and the partial-report rejection was rechecked live.
The final engine SHA-256 is
`85352f5b4c00c2154c72e9b154ade8db7131d2d1fb7d615ed8cc70e0e394237e`.
