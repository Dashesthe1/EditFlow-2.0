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
declared source set. Retention also verifies that the current hashes still equal the hashes captured
when the draft was scaffolded; changed Start media requires a new scaffold and independent
re-annotation. The benchmark recomputes those hashes from the current Start files and rejects stale,
DRAFT, incomplete, source-set-mismatched, or source-byte-mismatched truth before source indexing or
scene matching.

The default certification gates are intentionally strict:

- 100% Finish-shot match coverage;
- 100% source-identity accuracy;
- at least 95% source-range timing accuracy;
- 100% annotated direction accuracy;
- 100% repeated-geometric-proof coverage;
- 100% of truth-labeled shots at or above the 0.95 retained-confidence gate;
- zero high-confidence false scene claims.

Passing one case is not enough to certify Practice generalization. Suite-level certification also
requires at least 20 truth-retained cases, at least 20 distinct Finish reference IDs, at least 20
distinct Finish media SHA-256 identities, unique benchmark IDs, and PASS status for every case. A
20-30 case retained suite is the normal maturity target; more than 30 cases are allowed and remain
certifiable. Renaming or duplicating the same Finish bytes under different IDs cannot satisfy the
breadth gate, and any `MEASURE_ONLY` or failed case keeps `summary.certified` false. The report
records the observed breadth and exact blocking reasons under
`summary.generalizationGate`.

Per-shot timing uses interval overlap plus an explicit boundary-error tolerance. A truth row can
override `toleranceMs` and `minimumIou` when a speed-ramped or transformed shot requires a
different retained tolerance.

### Independent annotation review packs

`practice-media-truth.py review-pack` turns a pristine scaffold into a matcher-blind review folder.
It re-hashes the exact Finish and Start files, creates early/middle/late Finish stills for every
reference shot, and writes a blank `annotations.csv` for source identity, source interval, playback
direction, optional tolerance, and reviewer notes. It refuses any scaffold that already contains a
source annotation, so EditFlow matcher predictions cannot be smuggled into the independent truth
workflow.

After an independent reviewer fills the worksheet, `practice-media-truth.py import-review` verifies
shot coverage/order and annotation structure and writes an annotated DRAFT. The normal `retain`
command is still required afterward with the real annotation origin; importing a worksheet never
self-promotes it to retained truth. On Windows, use the same CV-capable runtime as Practice
(`py -3.12`); the product's local-media adapters already pin that interpreter instead of relying on
the workstation's default `python` command.

## Long-form cache behavior

Long movie indexes are retained only while the production matcher accepts their algorithm ID
and analyzer fingerprint **and** the cached source ID/path, media SHA-256, sample step, and analysis
FPS match the benchmark request. Reference caches must also match reference ID/path, Finish media
SHA-256, cut threshold, and minimum shot duration. If those values, the media bytes, matcher code,
OpenCV, or NumPy evidence change, the runner rebuilds the stale artifact before measuring the case.

This prevents a sparse exploratory index from being silently reused as a denser proof run and lets
EditFlow iterate on retrieval evidence without comparing a new matcher against incompatible
analysis artifacts.

## Retained truth corpus assembly

`scripts/practice/practice-retained-corpus.py` combines independently retained per-case truth-suite
manifests into the 20-30 case corpus used for certification runs. It re-hashes every Finish and
Start file before assembly, resolves media paths against the source manifest, and rejects stale
media bytes before any certification claim can be emitted.

`inventory` reports case count, distinct Finish identities, independent/full-length truth counts,
real matcher-observation readiness, and coverage across the retained hard-case categories. It is a
recruitment/preflight report only; `readyForCertificationRun` means the corpus is eligible to run the
canonical evaluator, not that Practice has passed or been certified. Practice maturity is also
fail-closed: a held-out benchmark cannot promote an Edit Type to `ROBUST` unless the Edit Type
registry retains a certified real-media truth-suite report satisfying these corpus gates.

`assemble --mode CERTIFICATION` is fail-closed. It requires 20-30 cases, unique case IDs, unique
Finish reference IDs, unique Finish SHA-256 identities, at least four hard-case categories, at least
98% retained shot-truth coverage per case, independent truth evidence, and non-placeholder matcher
observation evidence. An incomplete corpus may still be assembled in `MEASURE_ONLY` mode so failures
remain visible without being mistaken for certification authority.

Example:

```powershell
python scripts/practice/practice-retained-corpus.py inventory `
  --manifest proofs/practice/case-01-retained-suite.json `
  --manifest proofs/practice/case-02-retained-suite.json

python scripts/practice/practice-retained-corpus.py assemble `
  --mode CERTIFICATION `
  --manifest proofs/practice/case-01-retained-suite.json `
  --manifest proofs/practice/case-02-retained-suite.json `
  --output proofs/practice/retained-truth-corpus.json `
  --inventory-output proofs/practice/retained-truth-corpus-inventory.json
```

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
