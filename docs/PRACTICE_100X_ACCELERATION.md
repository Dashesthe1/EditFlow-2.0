# Practice 100x Acceleration Contract

Status: implemented architecture with native scratch rendering; production speedup still requires a real-media benchmark.

Implemented in this branch: parallel independent media-analysis and matching stages; a durable
production coordinator independent of ChatGPT conversation lifetime; automatic source-lock certificates;
whole-edit coverage as a first-class milestone; transactional batched trace persistence; append-only GPT
learning-event journaling; persistent phase-proof reuse bound to reference, baseline, exact source matches,
and audio; dependency-aware invalidation; residual-priority scheduling; stage wall-clock budgets with
strategy-escalation directives; production/AE heartbeats; production-aware Watchdog liveness; cross-clip
compiled-tutorial reuse; targeted-mutation enforcement after whole-edit coverage; a reusable progressive
scratch-candidate search rig; and shared whole-edit confirmation of provisional phase proofs so one render
can supply the second unchanged pass for many phases. The unified Shadow daemon exposes this as the
sole Practice and Pro Creation production workflow, and resumed nonterminal assignments receive the current scheduling rules
while retaining their checkpoints. Production telemetry is retained by category/stage so time spent in
media analysis, research, AE mutation, render/comparison, proof I/O, infrastructure, and idle work can be
measured rather than reconstructed manually.

Reference/source/match analysis uses a shared user-level cache keyed by media path, size, modification
time, analyzer code, and settings. Repeated sessions on unchanged media avoid another full indexing and
scene search; changed media metadata or analyzer code invalidates the cache. The production coordinator
also persists AE checkpoint identity separately from any ChatGPT chat, and long-running production
operations refresh their own liveness heartbeat.

Remaining validation: run a real-media A/B benchmark on the same assignment inputs and quality gates.
The native scratch backend renders isolated root-comp copies at 1/8, 1/4 and full resolution,
verifies actual output dimensions, and cleans the temporary comp after each render. Search scores
remain non-authoritative and return finalists to GPT for direct pixel inspection. Native numeric
search currently supports root-layer AE properties/effects; nested precomp structure, expressions,
third-party effects and new topology require a new GPT hypothesis/capability route.

## Continuous production API

- `GET/POST /v1/product/gpt/assignments/{id}/production-jobs`: enqueue authorized
  `AE_TRANSACTION`, `AE_CORRECTION`, `AE_GOAL`, `AE_BATCH`, `BUILD_BASELINE`,
  `PROOF_SCRIPT`, `SCRATCH_SEARCH`, `LOCAL_RENDER`, `SAVE_CHECKPOINT`, and
  `REFERENCE_ANALYSIS` work. Include the current `researchContext` in each payload.
- `GET .../production-jobs?jobId={jobId}` resumes a submitted receipt. No direct
  mutation endpoints or compatibility aliases remain; retired requests return `410`.
- Pro Creation uses the same worker with source phases from its raw-clip research ledger.
  Reference analysis, reference-scored scratch search and Finish-based baseline assembly
  are Practice-only. Opaque native scripts pause for explicit readback review.
- The local worker starts with the service, reads the durable append journal, executes one
  AE writer alongside up to three read-only preparations, respects dependencies and cancellation,
  and retains results independently of ChatGPT. It never invents missing creative decisions.
- Search/render finalists pause for `REVIEW_REQUIRED`. A crashed in-flight mutation becomes
  `RECONCILE_REQUIRED`, never an automatic replay. Failed jobs also hold later writes until reconciled. `RESOLVE` requires the current controller
  and retained visual/reconciliation evidence. These queue receipts do not certify an edit.
- Acceptance helper scripts use `scripts/production-job-client.mjs` and the current
  `EDITFLOW_RESEARCH_CONTEXT_JSON`; a pending/review receipt stops the helper until GPT
  inspects and resolves it. They cannot call a separate mutation service. Native tracking/roto
  subprocesses receive an ephemeral worker scope for their proof commands; the scope expires
  with that job and shares its writer, research admission and cancellation checks.
- Production state updates require the live controller. Local/whole proof receipts require a
  unique render evidence reference and candidate identity. A repeated receipt cannot count twice;
  failures, reconstruction and changes to a candidate reset the affected proof sequence.
- Stage budgets accumulate across stage changes. Warm/cold session strategy envelopes are
  4/6 hours. An overrun pauses queued work at a strategy review. `STRATEGY_CHANGE` records a
  new concrete strategy before execution resumes; it preserves the original elapsed telemetry.
- Source certificates include file identity and matched ranges. Ordinary numeric effect changes
  preserve sources, research, audio and unrelated phases. Changed files without fresh source validation
  block AE writes. Research and phase fingerprints use
  the affected source windows rather than invalidating every clip for one changed match.
- GPT learning events, clip execution audits, job state and telemetry append to journals.
  Small snapshots support cheap readback; coordinator writes serialize and retry Windows locks.
  Default research responses retain the latest 20 compact audit receipts and their total count;
  `includeAuditHistory=true` retrieves complete retained history.
- Telemetry distinguishes summed work from the union of active intervals, so concurrent jobs
  cannot hide idle time through double-counting. The remaining wall time is explicitly unattributed.

Coverage-first construction and shared whole-edit confirmation change scheduling, not quality.
Authoritative Practice completion still requires the reference-fidelity visual gate inside the primary
production system, exact raw sources, raw audio, the 95% similarity floor, two phase passes, two
whole-edit passes, and the independent mastery rules. The integrated M6 fidelity engine and direct GPT
pixel review supply reference evidence; a coordinator or machine search score cannot grant acceptance.

## Goal

Reduce wall-clock orchestration and search time by roughly 100x relative to the former
serial GPT -> AE -> render -> inspect -> one-parameter retry workflow while preserving or
improving editorial correctness and reference fidelity.

This is a performance target, not a quality exception. A run does not count as accelerated
success if it passes faster by weakening source correctness, direct GPT visual authority,
similarity floors, repeated phase passes, repeated whole-edit passes, or independent
mastery verification.

## Governing schedule

1. Parallel preflight: analyze Finish and index Start media concurrently.
2. Parallel retrieval: scene matching and audio matching run concurrently once their
   shared inputs exist.
3. Batch GPT source review: inspect multiple legible Finish/candidate panels in one review,
   but retain one explicit source/range decision per phase.
4. Coverage first: construct a playable whole edit across every source-locked phase before
   final phase certification.
5. One hypothesis, many local probes: GPT chooses the effect/construction family and
   invariants; bounded numeric search runs locally.
6. M6.7 actuator search first: eliminate dead controls, protect defining behavior, and
   request structural synthesis when parameter search is exhausted.
7. Progressive fidelity funnel: up to 32 coarse critical-frame candidates -> 8
   mid-resolution candidates -> 2 full-resolution candidates.
8. GPT review compression: show at most the strongest 3 useful alternatives plus
   reference/current-best.
9. Transactional write coalescing: one coherent GPT decision becomes one safe AE
   transaction instead of many model roundtrips.
10. Global residual scheduling: correct the highest viewer-impact residuals first and
    re-rank after meaningful commits.
11. Anti-stagnation: two weak micro-correction rounds or <1% relevant gain escalates the
    hypothesis instead of continuing parameter nudges.
12. Dependency-aware proof: localized changes invalidate only connected phase proof.
13. Shared analysis cache: reuse reference/source/index/match/proxy/audio work across
    sessions when the media identity and analyzer settings match. AE working clips remain
    session local.
14. Trace batching: transport up to 64 individually validated events in one request.
15. Parallel evaluation: structural-content analysis and rendered-effect analysis overlap.

## Search authority versus acceptance authority

Coarse/mid-resolution scores, proxy frames, actuator rankings, and residual priorities are
NON_AUTHORITATIVE_SEARCH_ONLY. They exist to reject bad candidates cheaply.

Canonical commits and Practice acceptance still require direct GPT pixel inspection,
real AE evidence, semantic/reference comparison, and the normal fail-closed proof gates.

## Performance measurements

Every real-media benchmark should report at least:

- time to complete source locking;
- time to first playable whole-edit coverage;
- GPT roundtrip count;
- AE transaction count;
- local candidate count versus full-resolution candidate count;
- rendered bytes and render count;
- number of micro-correction rounds per phase;
- time to first >=95% whole-edit candidate;
- time to authoritative Practice completion;
- final similarity and every phase report;
- wrong/unmatched scene count;
- defining-effect coverage;
- whether any prior accepted phase was unnecessarily re-proven.

## Pass condition

Acceleration passes only when the new workflow reaches equal-or-better final proof on the
same material substantially faster than the serial baseline. The 100x target remains
unproven until a real-media A/B benchmark demonstrates it.

A speed regression must identify its dominant bucket (media analysis, source decision,
AE mutation, render, comparison, GPT review, infrastructure/reconnect, or proof I/O) so
the next optimization attacks measured wall time rather than guessing.
