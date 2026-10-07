# Durable visual continuity and focused resume

## Context

The retained Practice edit had whole-edit coverage but repeated local corrections,
large historical startup responses and multiple worker handoffs. Adjacent workers
changed the same source traversal in opposite directions. Duplicate whole-edit
renders used the same source revision. Supervisor logs showed 10–15 second prompt
delivery and an installed deployment missing its production repair script.

## Decision

Extend the existing production coordinator with immutable explicit ChatGPT visual
reviews and current per-shot/per-dimension decisions. Record acceptance, unresolved
hypotheses, exact settings and rejected alternatives with issued pixel inspections.
Validate render file/composition time origins and multi-time temporal provenance.
Invalidate only affected current decisions on writes, conservatively for unknown
commands; retain history. Compact default assignment, notebook, workflow and job
responses. Require a reason for forced rerenders. Keep the current sole queue,
worker fencing and full-resolution direct final review. Add observed continuity
metrics and deployment file verification.

## Alternatives considered

More mandatory per-shot approval/strategy gates would consume turns and impede
whole-edit work. Automatic editorial ranking or acceptance would contradict direct
ChatGPT authority. Deleting historical learning would sacrifice useful evidence.
A competing controller or new assignment would lose continuity. None is adopted.

## Consequences

New workers have concise current observations rather than an old task backlog.
Reviews are optional advisory memory and add no construction gate. Recording is
possible with the next edit request. Historical records stay available explicitly.
Unsupported/ambiguous writes remain reconciliation cases. Existing recordings are
not retroactively marked PASS. Activity metrics cannot attribute thinking inside
an observed processing response and do not promise a measured speedup.

## Human-parity impact

No capability registry promotion. Creative settings, defect interpretation,
source selection and acceptance remain ChatGPT decisions from actual evidence.

## Safety and rollback impact

Preserve assignment IDs, pause, active generation and AE. Reload services only when
idle. New coordinator fields are optional for old snapshots. Source rollback can
read the same snapshots; durable job receipts and review history remain on disk.
Supervisor installation backs up state and verifies required deployed scripts.

## Proof impact

Tests cover disk continuity, targeted invalidation, stale/immutable reviews,
rejected alternatives, synchronized temporal evidence, grouped current context,
cached render identity, preview forcing and observed/unobserved timing. Existing
queue, fencing, liveness, gateway and API suites remain required regressions.
