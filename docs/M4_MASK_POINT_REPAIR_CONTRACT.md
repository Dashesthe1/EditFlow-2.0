# M4 Mask-Point Repair Contract

Status: **PARTIAL / VISUAL / R0_READ_ONLY**
Capability ID: `tracking.mask_point_repair.plan`
Route ID: `m4.tracking.mask-point-repair-plan.v1`

## Purpose

Plan an exact repair of one existing After Effects mask vertex and/or its incoming/outgoing Bezier tangents without inventing mask identity, interpolation-time geometry, or a second host mutation surface.

The planner reuses the already accepted protocol 1.2 `mask.set_path` / `ae.mask.path.set` contract. The public M4 capability remains read-only; the eventual host mutation therefore inherits protocol 1.2 revision checks, structural readback, and AE Undo rollback requirements.

## Exact identity and evidence

A repair plan requires exact non-empty stable references for the composition, layer, and mask, plus retained evidence IDs. The planner never chooses a mask by name, index, screen position, or visual proximity.

The caller must also provide the exact current mask path state obtained from trusted readback. Malformed point topology, tangent-count mismatch, non-finite coordinates, or inconsistent variable-feather arrays fail closed.

## Static path repair

For an unanimated mask path, `targetTime` is forbidden. The planner clones the entire shape and changes only the requested point component(s):

- vertex;
- incoming tangent;
- outgoing tangent.

Every untouched vertex, tangent, closed/open state, and variable-feather value is preserved exactly. The source readback object is not mutated.

## Animated path repair

For an animated mask path, the caller must supply an exact existing keyframe time. Repair at an interpolated time is deliberately refused because protocol 1.2 writes complete Shape values and EditFlow must not fabricate the host's interpolation result.

A valid animated plan clones the complete ordered keyframe set, modifies only the requested point at the exact target key, and preserves every other keyframe and path component exactly. Duplicate, decreasing, or malformed key times fail closed.

## Retained real-AE acceptance

The bounded warm-AE proof now binds an exact existing mask, introduces a known bad static-path vertex, applies the planner output through protocol 1.2, verifies the complete post-write path, issues a deliberate failed request, uses typed transaction Undo to restore the exact bad shape, reapplies the repair, and validates the viewer-visible correction by retained before/after pixels. The proof-owned composition and media are then removed and the original project baseline is restored without saving, closing, or restarting After Effects.

This acceptance promotes the planner to `VISUAL` and permits default runtime registration. The public planner remains `R0_READ_ONLY`; the actual path write remains the accepted `R1_REVERSIBLE` protocol 1.2 host operation.

## Remaining boundary

Retained real-AE evidence currently covers **static-path vertex repair** only. The following remain unclaimed at live-proof maturity:

- tangent-only or combined vertex/tangent host repair;
- animated exact-key mask repair;
- automatic selection of which mask vertex should be repaired;
- semantic correction-to-mask mapping for arbitrary footage;
- materially different footage transfer/save-reopen proof for this M4 repair workflow.

Animated repair continues to refuse interpolation-time guesses and remains structurally tested only.
