# M4 — Tracking & Isolation / Editor Brain v1

## Purpose

M4 is the first milestone where EditFlow must reason about persistent subjects and objects inside the frame rather than treating video primarily as a rectangle.

This document defines the first M4 vertical slice. It does **not** declare tracking, segmentation, matte export, or drift repair complete. Those capabilities remain unavailable until a real execution route and the required proof maturity exist.

## Development rule

Every M4 capability must advance through the same vertical path:

1. implement the AE/perception capability;
2. prove the capability;
3. expose its trusted semantic state;
4. teach Editor Brain when and why to use or reject it;
5. bind the decision to a deterministic construction/recipe;
6. define viewer-visible success and defect criteria;
7. test recovery and transfer;
8. record useful outcome evidence.

The Editor Brain never mutates After Effects directly and never treats a declared or unavailable capability as usable.

## Slice 1 — Trusted object state and fail-closed decisions

### Trusted Editor State

`packages/editor-state/src/index.ts` introduces typed M4 state for:

- persistent subject identity;
- normalized subject geometry;
- subject scale;
- motion direction, speed, and acceleration;
- observation, identity, geometry, tracking, and occlusion confidence;
- track state (`NOT_TRACKED`, `STABLE`, `AT_RISK`, `DRIFTING`, `LOST`);
- isolation availability;
- foreground occluder identity and coverage;
- framing quality;
- semantic attach points;
- evidence provenance;
- runtime capability/proof evidence.

The state layer validates normalized geometry and confidence values and refuses to guess a hero subject when multiple candidates are ambiguous.

### Editor Brain v1

`packages/editor-brain/src/v1.ts` sits above Editor Brain v0 and adds object-aware routing while preserving the v0 fast deterministic path for familiar decisions.

It currently knows how to:

- use a stable, high-confidence subject observation to drive a tracked reframe decision;
- reject an at-risk or low-confidence track;
- stop continued use of a drifting/lost track;
- request drift repair only when that capability is actually proven;
- recognize foreground occlusion as a possible transition construction;
- block that construction when required tracking capability is unavailable;
- hand a proven occlusion opportunity toward deterministic recipe construction rather than inventing AE mutations;
- preserve a heavily occluded or critically framed subject instead of adding a gratuitous effect;
- identify cases where isolation is unnecessary;
- fall back to Editor Brain v0 when object-aware reasoning is not required.

## Four M4 gates

### 1. Capability Gate

Current slice: **FOUNDATION ONLY**.

No M4 tracking/isolation capability is promoted by this slice. The next capability implementation must begin with a truthful point-tracking route and capability record.

### 2. Brain Gate

Current slice: **INITIAL PASS**.

The Brain has explicit policies for track acceptance/rejection, drift-repair routing, tracked reframing, subject preservation, and foreground-occlusion candidacy. Decisions remain confidence-gated and explainable.

### 3. Visual Gate

Current slice: **NOT YET PASSED**.

The first point-tracking implementation must define visual invariants including target retention, drift bounds, occlusion behavior, and viewer-visible reframe stability. Structural host success alone is insufficient.

### 4. Workflow Gate

Current slice: **NOT YET PASSED**.

The first real M4 workflow proof must demonstrate observe → track → read back semantic state → decide → construct → preview → detect drift/defect → repair or fail closed, without corrupting the project.

## Next implementation slice

Build **M4 P1: point tracking + semantic track readback** as the first real capability slice.

Required outputs:

- a capability-registry entry with truthful status and proof maturity;
- typed track request/result contracts;
- a tracker/AE adapter execution route;
- persistent target identity across frames;
- normalized trajectory samples with confidence and provenance;
- track-state classification (`STABLE`, `AT_RISK`, `DRIFTING`, `LOST`);
- readback into `EditorSubjectStateV1`;
- deterministic tracked-reframe construction;
- visual drift criteria and proof frames;
- recovery proof for lost/drifting tracks;
- transfer proof on materially different footage.

Only after these pass should `m4.point_tracking` be considered usable by Editor Brain v1.
