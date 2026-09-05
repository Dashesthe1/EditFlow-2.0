# ADR 0005 — Local Persistence and Provenance

- Status: Accepted
- Date: 2026-09-05

## Decision
Use SQLite for structured local state/provenance and filesystem/object storage for larger proof artifacts. Source media is referenced rather than duplicated by default.

Persist sessions, stable-ID mappings, capability snapshots, recipe versions, Scene Graph references, transaction ledgers, proof manifests, and memory indexes.

## Consequence
All persisted decisions/evidence carry version/provenance. Database state cannot be treated as more authoritative than current AE readback for live project truth.
