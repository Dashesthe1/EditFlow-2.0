# ADR 0010 — Incremental Proof Engine Is the Permanent M# Test Path

## Status

Accepted and mandatory for M5–M11 development.

## Decision

All milestone testing MUST enter through `scripts/windows/invoke-editflow-ae-proof.ps1`.
Individual `run-m*.ps1` files are proof implementations, not supported top-level test entry points.
The default proof strategy is `INCREMENTAL_FIRST`; callers must explicitly request `FULL_ACCEPTANCE` when fresh end-to-end acceptance evidence is required.

The engine treats proof evidence as a content-addressed DAG. A passing node may be reused only when its declared dependency digests, environment fingerprint, checkpoint key, and proof identity still match. Missing dependency declarations fail closed to execution rather than reuse.

`FULL_ACCEPTANCE` always bypasses reusable evidence and runs the complete required proof chain. Cached development evidence can never substitute for a milestone exit-gate acceptance run.

## Permanent development loop

The default loop is:

`change -> dependency hash -> reuse unaffected proof nodes -> run affected delta -> deterministic verification -> local known-failure diagnosis -> one failure capsule if escalation is required`

Expensive semantic reasoning is used to establish or recover state. Cheap deterministic evidence is used to preserve that state until an explicit invariant invalidates it.

## Visual state leases

A semantic visual observation may issue a bounded `VisualStateLeaseV1` containing AE process identity, project revision, target binding, window geometry, and region-of-interest hashes. While those invariants remain exact and the lease has not expired, routine proof steps MUST use deterministic lease checks instead of repeating full-scene semantic inference.

Any changed invariant, expired lease, ambiguous target, unexpected modal, or stale host state invalidates the lease and escalates to a fresh observation. Leases reduce redundant reasoning; they never authorize guessing.

## Failure capsules

Known failure classes should execute bounded local diagnostics without returning to ChatGPT between probes. Novel or unresolved failures must be summarized into one `FailureCapsuleV1` containing the failure class, exact detail, last accepted node, relevant state/diff fingerprints, retained evidence IDs, and diagnostic results.

The purpose is one high-information reasoning pass rather than repeated `inspect -> think -> probe -> think` cycles.

## Checkpoints

Development proofs may reuse fingerprinted milestone checkpoints such as fixture-loaded, seeded, propagated, or refined states when the checkpoint's dependencies remain valid. Acceptance proofs MUST reconstruct the required baseline rather than relying on development checkpoints.

## Validation policy

Focused/incremental compilation and affected tests are the default inner-loop checks. Full schema validation, full typecheck, full test suite, and the complete real-AE proof remain mandatory at tranche or milestone acceptance.

Warm AE, warm CEP/EditFlow, Eyes, Hands, model runtimes, compiled runtime, state leases, and valid proof tokens should be preserved between compatible operations. Restarting or rediscovering a healthy component is an invalid optimization regression unless the test explicitly targets lifecycle behavior.
