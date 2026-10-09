# Source Match Service evaluation — 9 October 2026

The service is installed and usable for read-only source discovery. **The goal of complete, exact recovery within five/eight minutes is not met.** These are measured partial results, not a claim of full accuracy.

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

The final verification code is commit f3e1cdb; engine SHA-256: `7f72e7ad96a5fc8fbf8a7f3a523cefc26775ad755e358e8fe4b90a79bb5dad2e`.
No independent endpoint-error or false-positive-rate evaluation has been performed on these real files. The displayed middle-frame contact-sheet pairs were visually inspected for location consistency; this is not a beginning/middle/end editing PASS.

## Retained results

Cold job: `source-match-fa68df84-3f71-4135-8ac3-a7a0a82d6019`.
Cached job: `source-match-02c39049-4b3d-4a8e-860d-9b5520890073`.

Use `get_source_match(job_id)` to retrieve the durable report, original integer PTS/time bases, all anchor pairs, two evidence contact sheets and CSV on the Shadow PC. The cold job also retains a confirmed interior location for segment 008, which the shorter cached run did not revisit before expiry.

The server advertises `start_source_match`, `get_source_match`, and `cancel_source_match`. This chat's cached connector tool list has not refreshed to include the new names; refresh the existing Current Shadow connection to expose them. The authenticated product API has been tested directly. No new assignment/controller is needed.

### Final cached report

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

Remaining acceptance work: resolve the four unlocated segments, measure endpoint error against independently observed reference/source frame correspondences, and evaluate a real two-hour 4K input. Fades, duplicated/frozen frames and ambiguous copies may require explicitly unresolved boundaries instead of exact claims.
