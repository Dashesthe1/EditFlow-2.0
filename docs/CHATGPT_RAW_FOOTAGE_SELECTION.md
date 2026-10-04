# ChatGPT raw footage selection

Production authority is `CHATGPT_DIRECT`. The old visual/raw-shot matcher and candidate
ranker, historical matcher tests and lab overrides have been physically removed.
Practice chat sessions have exactly one available selection method: `CHATGPT_DIRECT`.
Assignment creation and preflight writes reject legacy/machine choices, even when
their source confidence or geometric scores are high. Retained assignment reads
hide legacy choices, including from completed assignments. A missing checkpoint,
incomplete reference-shot coverage or missing direct comparisons locks production.
Clip research and resumed plans must bind to the current direct GPT selection;
matching a historical machine choice's time range does not restore its authority.
Media helpers only read metadata, decode timestamps requested by GPT, label/cache
pixels, retain GPT decisions, and extract GPT-selected working ranges. Uniform media
identity hashes bind inspections and decisions to unchanged input files; they never select shots.

For footage discovery, primarily use internet research: film/episode identity,
distinctive dialogue, scripts, transcripts, chapters, scene descriptions and sequence
context. Adapt to footage lacking those clues with chronological overview sheets,
interval narrowing, nearby scenes, action/pose continuity, dense trim comparisons and
exact frames. Search results are hypotheses. Actual provided raw pixels establish
every shot. No internet footage becomes output media. Effects and transitions retain
the separate Tutorial Drive → Adobe → external-source research policy.

Resume the same assignment and current worker credential. Read:

`GET /v1/product/gpt/assignments/{id}/footage-selection`

It returns the contract, reference shot boundaries, raw metadata/durations, inspection
receipts, coverage notes and retained GPT choices. It never returns ranked raw shots.
Use the HTTP worker header or exact `claimedBy` required by production supervision.

```json
{
  "action": "BROWSE",
  "claimedBy": "<current worker credential>",
  "mediaId": "<provided raw or reference mediaId>",
  "timesMs": [60000, 120000, 180000],
  "width": 640
}
```

POST to the same endpoint. Open `inspection.contactSheetPath` and individual frame
paths to see actual pixels. Request up to 48 timestamps per batch and widths from
160 to 1920. Choose overview intervals yourself, then narrow promising intervals and
increase temporal detail. Reuse receipts rather than redecoding the same timestamps.

`NOTE` retains `mediaId` and `note` with `rangeMs`, `status` (`REVIEWED_NO_MATCH`,
`NEEDS_DENSE_REVIEW`, `MATCH_LOCATED`), `strategy`, and `observation`. These are coverage
notes, never shot admission or proof. Read them across handoffs to avoid repeated work.

`SELECT` takes `selections` and `search`. Each selection contains `shotId`, `sourceId`,
`sourceStartMs`, `sourceEndMs`, `direction`, `confidence`, `rationale`, and at least
three `anchors` covering half or more of the reference shot. Each anchor records
`referenceTimeMs`, `sourceTimeMs`, `referenceEvidenceId`, `sourceEvidenceId`, and an
observed subject/action/framing comparison. Inspect boundaries and intervening motion,
not just one matching still. Use `temporalBehavior: FORWARD_THEN_REWIND` or `COMPLEX`
with a sufficiently dense anchor trajectory for nonlinear time behavior.

`search` records `internetStatus: CONSULTED`, `sources: [{url, query, finding}]` and
`strategies`; actual internet access failure can use `UNAVAILABLE` with `reason`.
Research provenance and search notes survive subsequent selection updates.

Admission checks supplied raw identity, file version, time bounds, actual issued
frame receipts and pixel hashes. A GPT decision is recorded as direct visual review,
never mislabeled as machine geometric proof. Only selected raw ranges are materialized
with handles. Preflight remains `AWAITING_CHATGPT_SHOTS` until all reference shots have
valid direct selections and existing connection/novelty/working-media gates pass.
Baseline assembly reads those retained decisions, ignoring old machine-match paths.
All AE actions still run through production-jobs; After Effects stays open.

Active legacy candidate choices lose authority on upgrade. Assignment/session IDs,
production receipts, edit checkpoints and correct AE work stay retained. GPT selects
and verifies source ranges before further construction. Pro Creation uses the same
direct browser and records designed raw ranges in its clip-research plan without a
Finish answer key.

Mechanical seeking reference: https://ffmpeg.org/ffmpeg.html (input `-ss` and accurate
seeking). Seeking/caching is footage access, not editorial selection.
