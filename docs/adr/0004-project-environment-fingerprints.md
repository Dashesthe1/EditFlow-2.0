# ADR 0004 — Project and Environment Fingerprints

- Status: Accepted
- Date: 2026-09-05

## Decision
Use hierarchical fingerprints: project, composition/affected-object, and environment. An execution plan binds to the observed project revision and the relevant fingerprints.

Unrelated project changes should not force unnecessary invalidation, but any relevant drift causes re-observation before writes.

## Consequence
The executor must distinguish stale relevant state from harmless unrelated change and never force writes through an ambiguous fingerprint mismatch.
