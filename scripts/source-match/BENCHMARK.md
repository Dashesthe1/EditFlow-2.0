# Source Match Service evaluation — 9 October 2026

The service is live at v1.1.3. The latest cached Ultron run finished in 419.125 analysis seconds (422.822 seconds including startup): 19/20 source locations, 9 measured endpoint rows, 10 interior-only rows and 1 unlocated shot. **The goal of complete, exact recovery within five/eight minutes is not met.** These are measured partial results, not a claim of full accuracy.

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


## Latest completed v1.1.3 report

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
