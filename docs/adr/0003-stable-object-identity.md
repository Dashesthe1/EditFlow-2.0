# ADR 0003 — Stable Object Identity

- Status: Accepted
- Date: 2026-09-05

## Decision
EditFlow IDs are opaque UUID-based identities and never rely on AE layer indices or names alone. Identity mappings combine EditFlow metadata, available host IDs, parent identity, object kind, and structural evidence.

Mappings are revalidated at transaction boundaries and ambiguity is surfaced rather than guessed.

## Proof impact
Stable-ID proofs must cover rename, reorder, duplicate, precompose, save/reopen, and reconnect scenarios before the AE baseline milestone exits.
