# M5 Roto Brush / Refine Edge Adapter Contract

Status: **DECLARED / ADAPTER REQUIRED / R4 EXTERNAL UI**
Milestone: `M5 Interactive AE Adapters (0.6.0-dev)`
Adapter build: `0.6.0-dev.1`

## Purpose

Roto Brush, Refine Edge, propagation, freeze, repair, and object-matte export are interactive After Effects subsystem workflows. They are not ordinary effect-property writes. This contract creates the semantic boundary before any production route is exposed.

## Semantic operations

The adapter contract defines these bounded operations:

- `INSPECT_SESSION` — read exact session identity/progress without mutation;
- `SEED_FOREGROUND` / `SEED_BACKGROUND` — evidence-bound normalized layer-space seed strokes;
- `PROPAGATE_FORWARD` / `PROPAGATE_BACKWARD` — bounded propagation over an explicit time range;
- `REFINE_EDGE` — bounded edge-refinement semantics;
- `FREEZE` / `UNFREEZE` — explicit session freeze state changes;
- `REPAIR_STROKE` — evidence-bound manual correction after matte failure/drift;
- `EXPORT_MATTE` — explicit stable-ID export to `MASK` or `TRACK_MATTE` output.

All mutating operations require an exact target binding, an expected opaque session revision, and retained evidence IDs. Stroke geometry is normalized to layer space; the contract contains no screen coordinates or raw cursor instructions.

## Capability posture

Seven capability records are declared for inspect, seed, propagate, Refine Edge, freeze, repair, and export. Every route is a first-class `SUBSYSTEM_ADAPTER`, is currently unavailable, and remains `ADAPTER_REQUIRED / DECLARED`.

The read-only inspect capability is `R0_READ_ONLY`. Every mutating capability is currently classified `R4_EXTERNAL_UI` because no deeper typed host surface has yet been proven for AE 25.6.6. A later tranche may lower the risk class only with retained evidence for a deeper deterministic route.

No M5 Roto Brush capability is registered into the default desktop runtime in this tranche.

A draft read-only protocol 2.6.0 now defines bounded ADBE Samurai effect/session discovery. Its host layer walks a capped custom property tree (depth 5, 512 nodes), rejects ambiguous multiple-effect identity without an explicit effect index, and derives an opaque session revision from exact readback plus host project revision. The protocol is layered over the accepted 2.5 loader for development proof only; it is not installed or registered as a production capability yet.

## Guardrails

The implementation must fail closed on:

- missing/mismatched comp or layer identity;
- stale or missing session revision for mutation;
- missing mutation evidence;
- non-finite/out-of-range normalized stroke geometry;
- propagation ranges that are empty, reversed, or unbounded;
- inferred foreground/background roles;
- implicit export destination or unstable output identity;
- unexpected AE panels, dialogs, state, or target changes.

A future guarded UI implementation may translate semantic actions into verified visual interaction, but that UI driver is not the public semantic contract and must never accept unrestricted mouse/keyboard commands.

## Required readback/evidence before promotion

Before any route becomes available, retained real-AE evidence must establish:

1. exact session/target identity before action;
2. observable session revision or equivalent stale-state guard;
3. target-bound foreground/background seed application;
4. bounded propagation with progress evidence and clean stop state;
5. Refine Edge state/effect on the intended subject boundary;
6. freeze/unfreeze truth and refusal on unexpected state;
7. manual repair that visibly corrects a known matte defect;
8. export identity plus structural output readback;
9. popup/error detection with exact error capture and safe acknowledgement handling;
10. proof-owned cleanup or exact checkpoint restoration without closing/restarting the warm AE process;
11. transfer to materially different footage before `TRANSFER` maturity is claimed.

Speed claims, if made, must measure actual AE action-to-action latency. Routine warm actions should remain under the project-wide 3-second ceiling and target sub-second execution when the subsystem permits it.

## Current boundary

This tranche is intentionally code/read-only with respect to live After Effects. It establishes the semantic contract and fail-closed validation only. It does not seed, propagate, freeze, repair, export, or register a production Roto Brush route.