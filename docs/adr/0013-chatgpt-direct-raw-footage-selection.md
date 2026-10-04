# ADR 0013 — ChatGPT selects raw footage directly

- Status: Accepted
- Date: 2026-10-03

The user rejected machine-generated and ranked raw-shot candidates. Production now
uses `CHATGPT_DIRECT`: GPT chooses where to browse and selects exact ranges from the
provided raw footage after inspecting timestamped pixels. The old matcher is physically deleted along with its historical acceptance launchers.

The assignment's `footage-selection` contract exposes metadata, chronological frame
access, coverage notes and retained choices. GPT primarily researches internet scene,
dialogue, script, transcript and chapter clues, then narrows raw intervals and compares
several exact Finish/raw moments. Mechanical helpers seek, decode, label, cache and
extract requested moments; they make no editorial choices. Bounded parallel decoding
and retained receipts avoid full-film proxies and repeated searches. Internet results
are search hypotheses, and cannot become output footage or replace pixel review.

Direct comparisons bind supplied raw identity, current media versions, actual issued
inspection receipts, pixel hashes, temporal direction and ranges. GPT's declared visual
confidence is distinct from geometric measurement. Existing render/reference fidelity,
working-media, connection and novelty gates remain required. Only GPT-selected ranges
are materialized for AE. Baseline assembly reads current retained choices rather than
a caller-supplied legacy match file. Pro Creation uses the same browser and preserves
its GPT-designed source ranges in the existing clip-research plan.

Active legacy choices lose source authority on migration while assignment IDs, session
IDs, AE work, checkpoints and production-job receipts stay retained. Missing selections
produce `AWAITING_CHATGPT_SHOTS`; the worker must inspect footage rather than poll a
retired algorithm. Selected-clip preparation resumes asynchronously from durable
decisions. Worker fencing and the single production AE writer remain mandatory.
Effects and transitions retain their separate Tutorial Drive → Adobe → web policy.

Retaining machine shortlists as hints was rejected because it leaves source discovery
under the discarded algorithm. A separate API model worker was rejected because the
running ChatGPT session remains the editorial operator. This decision changes source
selection authority; it adds no native editing capability or human-parity promotion.

Validation covers no production matcher invocation, direct browser output on real
video, timestamp and pixel integrity, raw-only selection, invalid research, temporal
direction, cache reuse, retained corrections, audio-independent visual binding, HTTP
admission/working-range preparation, and migration without restarting an assignment.

Recovery resumes issued inspection receipts and decisions in the same assignment.
Invalid or changed evidence blocks admission and requires fresh GPT inspection. There
is no automatic legacy fallback, assignment restart, supervisor change or AE shutdown.
