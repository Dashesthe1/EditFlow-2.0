# Practice 100x Acceleration Contract

Status: staged implementation; 100x remains an unproven benchmark target.

Implemented in this branch: parallel independent media-analysis and matching stages; GPT
coverage-first guidance; transactional batched trace persistence; persistent phase-proof reuse bound to
reference, baseline, exact source matches, and audio; a non-authoritative progressive
candidate ranker; source review sheets; residual and anti-stagnation policy helpers.

Still required for the end-to-end target: a reusable AE scratch candidate rig, automatic
whole-edit coverage before per-phase certification in the native Practice runtime,
and a real-media A/B benchmark. The policy
constants and tests alone do not establish a measured speedup.

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
13. Shared analysis cache: reuse unchanged reference/source/index/match/proxy/audio work
    across sessions while preserving a session-local evidence copy.
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
