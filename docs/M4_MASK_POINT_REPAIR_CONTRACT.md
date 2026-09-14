# M4 Mask-Point Repair Contract

Status: **PARTIAL / STRUCTURAL / R0_READ_ONLY**
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

## Safety boundary

This tranche proves deterministic planning only. It does not yet claim:

- real-AE mask-point mutation for the M4 repair workflow;
- post-write protocol 1.2 readback of the repaired point;
- induced-failure Undo recovery for this M4 composition;
- viewer-visible correction of a failed mask track;
- automatic selection of which mask vertex should be repaired;
- semantic correction-to-mask mapping for arbitrary footage.

The actual `mask.set_path` write remains an accepted `R1_REVERSIBLE` protocol 1.2 operation, but M4 runtime registration of this higher-level repair planner is withheld until retained real-AE repair evidence exists.

## Promotion gate

Promotion requires a bounded warm-AE proof that binds an exact existing mask, introduces a known bad tracked-path point, applies the planned repair through protocol 1.2, verifies exact post-write readback, demonstrates induced-failure rollback, retains a viewer-visible repair checkpoint, and restores the proof-owned project baseline without saving, closing, or restarting the user's After Effects process.
