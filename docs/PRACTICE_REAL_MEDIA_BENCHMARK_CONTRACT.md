# Practice real-media benchmark contract

Practice scene matching must be proven against long-form source footage, not only synthetic clips.
The benchmark runner is:

- `scripts/practice/practice-media-benchmark.py`
- `scripts/practice/practice-media-truth.py`
- manifest schema: `editflow.practice-media-benchmark-suite.v1`
- truth schema: `editflow.practice-media-benchmark-truth.v1`
- report schema: `editflow.practice-media-benchmark-report.v1`

The runner uses the production `practice-media-match.py` implementation directly. Reference
analysis, long-source indexes, and scene matches therefore carry the same analyzer fingerprint
and become stale when the matcher changes.

## Truthfulness boundary

A benchmark with no retained shot-level truth is `MEASURE_ONLY`. It can expose runtime,
coverage, confidence, geometry, and retrieval behavior, but it cannot certify correctness.

A case can become `PASS` only when retained truth covers every Finish shot and the match is
checked against independent source identity, source range, and direction annotations.
High matcher confidence is never accepted as ground truth.

`practice-media-truth.py scaffold` creates a DRAFT with Finish shot IDs and reference timing
context only. It deliberately leaves source identity, source timing, and playback direction blank.
`retain` accepts only complete independent annotations with origin
`INDEPENDENT_HUMAN` or `INDEPENDENT_EXTERNAL_TOOL`; EditFlow matcher output is not a valid
truth origin. Retained truth is bound to the exact Finish style fingerprint, Finish media SHA-256,
analyzer fingerprint, benchmark source-ID set, and the SHA-256 of every Start source. Scaffold,
validate, and retain commands therefore require `--source-sha256 SOURCE_ID=SHA256` bindings for the
declared source set. The benchmark recomputes those hashes from the current Start files and rejects
stale, DRAFT, incomplete, source-set-mismatched, or source-byte-mismatched truth before source
indexing or scene matching.

The default certification gates are intentionally strict:

- 100% Finish-shot match coverage;
- 100% source-identity accuracy;
- at least 95% source-range timing accuracy;
- 100% annotated direction accuracy;
- 100% repeated-geometric-proof coverage;
- 100% of truth-labeled shots at or above the 0.95 retained-confidence gate;
- zero high-confidence false scene claims.

Per-shot timing uses interval overlap plus an explicit boundary-error tolerance. A truth row can
override `toleranceMs` and `minimumIou` when a speed-ramped or transformed shot requires a
different retained tolerance.

## Long-form cache behavior

Long movie indexes are retained only while the production matcher accepts their algorithm ID
and analyzer fingerprint **and** the cached source ID/path, media SHA-256, sample step, and analysis
FPS match the benchmark request. Reference caches must also match reference ID/path, Finish media
SHA-256, cut threshold, and minimum shot duration. If those values, the media bytes, matcher code,
OpenCV, or NumPy evidence change, the runner rebuilds the stale artifact before measuring the case.

This prevents a sparse exploratory index from being silently reused as a denser proof run and lets
EditFlow iterate on retrieval evidence without comparing a new matcher against incompatible
analysis artifacts.

## Benchmark manifest

Each case declares a Finish reference and one or more candidate Start videos. Paths may be
absolute or relative to the manifest. Environment variables are expanded.
Example:

```json
{
  "schema": "editflow.practice-media-benchmark-suite.v1",
  "suiteId": "practice-real-media-v1",
  "cases": [
    {
      "benchmarkId": "case-01",
      "referenceId": "reference:case-01",
      "referenceVideo": "references/finish.mp4",
      "sources": [
        {
          "sourceId": "video:full-movie",
          "video": "sources/full-movie.mp4"
        }
      ],
      "truthFile": "truth/case-01.json",
      "sampleStepMs": 500,
      "analysisFps": 6,
      "coarseLimit": 24
    }
  ]
}
```

A missing `truthFile` is valid for exploratory measurement, but the resulting case cannot be
counted as certified.
## Intended development loop

1. Run difficult real references against their full-length source movies.
2. Inspect wrong-source, wrong-time, weak-geometry, and false-high-confidence rows.
3. Change retrieval evidence only when the failure is causally explained.
4. Re-run the same retained truth suite.
5. Keep failures in the suite; do not delete hard cases after a matcher change.
6. Promote scene matching only when the full retained suite passes without truth leakage.

This benchmark is a development/proof gate. It does not replace Practice's render-comparison,
effect reconstruction, subject-isolation, temporal-behavior, or held-out Pro Creation gates.
