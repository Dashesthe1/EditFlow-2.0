# M4 — Tracking & Isolation / Editor Brain v1

## Purpose

M4 is the first milestone where EditFlow must reason about persistent subjects and objects inside the frame rather than treating video primarily as a rectangle.

This document defines the active M4 vertical slice. It does **not** declare tracking, segmentation, matte export, or drift repair complete. Those capabilities remain unavailable until a real execution route and the required proof maturity exist.

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

## Slice 2 — M4 P1 point-tracking foundation

`packages/point-tracker/src/index.ts` now provides a deterministic local point-tracking core with:

- typed request/result/sample contracts;
- fixed feature and search windows;
- normalized appearance error;
- match uniqueness;
- maximum-jump checks;
- forward/backward round-trip error;
- explicit `STABLE`, `AT_RISK`, `DRIFTING`, and `LOST` classification;
- persistent entity binding;
- trajectory confidence and evidence provenance;
- semantic readback into `EditorSubjectStateV1`, including center, motion direction, speed, acceleration, track confidence and observation time.

`packages/point-tracker/src/bmp.ts` adds a dependency-free, bounded frame-evidence seam for AE-rendered images. It accepts uncompressed 24-bit or 32-bit Windows BMP input, validates file/header/dimension/byte limits before decoding, handles top-down and bottom-up storage, produces deterministic 8-bit luminance, and preserves evidence provenance.

The implementation does **not** require FFmpeg. This keeps the first tracking route self-contained and avoids adding a recurring software or inference dependency.

`packages/capability-registry/src/m4.ts` registers `ae.tracking.point` truthfully as `ADAPTER_REQUIRED` with `STRUCTURAL` proof and an unavailable route. Structural implementation is therefore visible to planning, but production resolution fails closed until real-AE capture and the remaining proof gates pass.

## Four M4 gates

### 1. Capability Gate

Current slice: **STRUCTURAL FOUNDATION — NOT PRODUCTION AVAILABLE**.

The deterministic point tracker, bounded BMP evidence decoder, semantic state readback, and capability record exist and are unit-tested. The route remains unavailable because a real `render.capture` → BMP evidence proof has not yet passed on the self-hosted AE runner.

### 2. Brain Gate

Current slice: **INITIAL PASS**.

The Brain has explicit policies for track acceptance/rejection, drift-repair routing, tracked reframing, subject preservation, and foreground-occlusion candidacy. Decisions remain confidence-gated and explainable.

### 3. Visual Gate

Current slice: **NOT YET PASSED**.

The first real-AE point-tracking proof must demonstrate target retention in rendered pixels and define measurable invariants for drift, ambiguity, loss/occlusion, and viewer-visible reframe stability. Structural host success alone is insufficient.

### 4. Workflow Gate

Current slice: **NOT YET PASSED**.

The first real M4 workflow proof must demonstrate observe → capture pixels → track → read back semantic state → decide → construct → preview → detect drift/defect → repair or fail closed, without corrupting the project.

## Next implementation slice

Complete **M4 P1 real-AE frame ingestion and visual point-track proof** using the existing warm self-hosted After Effects/CEP runner.

Required outputs:

- render-backed frame evidence originating from the real AE composition;
- deterministic decode into `GrayFrameV1` without external media-decoding dependencies;
- persistent target identity across captured frames;
- normalized trajectory samples with confidence and provenance;
- explicit visual drift criteria and proof frames;
- stable/ambiguous/lost-track cases that produce the correct state classification;
- readback into `EditorSubjectStateV1` and an Editor Brain v1 decision;
- deterministic tracked-reframe construction only after the capability gate is satisfied;
- recovery proof for lost/drifting tracks;
- transfer proof on materially different motion/appearance evidence.

Only after real-host, visual, recovery, and transfer evidence passes should `ae.tracking.point` be promoted from its current fail-closed foundation state for production use.
