# ADR 0006 — Visual Proof Artifacts

- Status: Accepted
- Date: 2026-09-05

## Decision
Every material pixel-changing capability/recipe can declare bounded visual checkpoints. Proof runs store a machine-readable manifest tied to git commit, build, AE/environment fingerprint, fixture IDs, plan hash, structural assertions, visual artifacts/findings, rollback result, and verdict.

## Consequence
Rendered output is evidence, not an informal screenshot. Capability status cannot advance to FULL without the proof maturity required by `docs/05_PROOF_AND_ACCEPTANCE.md`.
