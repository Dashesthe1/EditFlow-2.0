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

`packages/point-tracker/src/index.ts` provides a deterministic local point-tracking core with:

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

`packages/point-tracker/src/bmp.ts` and `packages/point-tracker/src/tiff.ts` provide dependency-free bounded frame-evidence decoders. BMP supports uncompressed 24/32-bit Windows input. TIFF supports the bounded baseline uncompressed RGB/RGBA form observed from After Effects and handles both byte orders and multi-strip input. Both validate dimensions and byte bounds before allocation, produce deterministic 8-bit luminance, and preserve evidence provenance.

The implementation does **not** require FFmpeg. This keeps the first tracking route self-contained and avoids adding a recurring software or inference dependency.

`packages/capability-registry/src/m4.ts` still registers `ae.tracking.point` truthfully as `ADAPTER_REQUIRED` with `STRUCTURAL` proof and an unavailable production route. Structural implementation is visible to planning, but production resolution fails closed until the remaining live-host and proof gates pass.

## Slice 3 — Typed AE TIFF frame-evidence integration

M4 now has an additive tracking-evidence route above the accepted M2/M3 host stack:

- `editflow_host_current_m4.jsx` loads the immutable accepted protocol-2.0 host first, then the M4 tracking wrapper;
- `render.capture` remains the public typed command; M4 does not add arbitrary script execution;
- only the allow-listed `TRACKING_TIFF_SEQUENCE_V1` profile is accepted;
- the profile uses the installed `TIFF Sequence with Alpha` output-module template rather than a caller-supplied template;
- capture length is constrained to an exact whole-frame span from 1–120 frames;
- evidence renders at a fixed half-resolution factor on each axis to reduce pixel I/O while preserving normalized coordinates;
- the output directory remains bounded by the existing filesystem policy;
- stale matching evidence is removed before capture;
- the exact produced sequence is counted and every frame must be non-empty;
- a separate immutable frame manifest records the exact frame paths and job identity;
- ordinary `render.capture` behavior remains delegated unchanged.

The accepted async renderer still owns queue execution and cleanup. The M4 wrapper does not call `RenderQueue.render()` or `renderAsync()` itself.

## Real-AE evidence reached so far

A direct bounded After Effects experiment has already established the underlying pixel path:

- AE 2025 produced a real four-frame TIFF sequence using `TIFF Sequence with Alpha`;
- the M4 TIFF decoder consumed those exact AE-produced files;
- `trackPointV1` followed the deliberately moving proof target across all four frames;
- that direct experiment produced `STABLE` status, confidence `1.0`, uniqueness `1.0`, and zero round-trip error for the tracked steps;
- the proof-owned fixture and Render Queue item were removed and the pre-existing user project items remained intact.

This is real-host pixel evidence, but it is **not** equivalent to the final authenticated CEP acceptance route below. It therefore does not promote `ae.tracking.point` to production availability.

## Authenticated warm-AE acceptance harness

The branch now contains the complete bounded acceptance path:

- `apps/desktop-host/src/m4-tracking-real-ae-cli.ts` starts the authenticated loopback broker and uses `AeCepAdapterClientV11`;
- it observes the current active composition without creating or replacing compositions/layers;
- it requests `render.capture` with `TRACKING_TIFF_SEQUENCE_V1`;
- it validates the terminal render marker, queue cleanup, frame manifest, bounded paths, and non-empty TIFF files;
- it decodes the actual TIFFs and deterministically ranks textured seed points from the first frame;
- each bounded seed candidate is evaluated by the real point tracker rather than by a fabricated subject detector;
- acceptance requires `STABLE`, track confidence >= `0.72`, and measurable normalized motion >= `0.0025`;
- final project fingerprint, item count, and active-item identity must match the pre-capture observation;
- a static/weak clip returns `EVIDENCE_INSUFFICIENT` rather than falsely passing tracking;
- the proof explicitly leaves P3 visual review, P4 recovery, and P5 transfer false.

`scripts/windows/run-m4-tracking-real-ae.ps1` and `open-editflow-m4-bridge.jsx` execute that proof against an already-running AE process. The runner requires one responsive AE process, records its PID, installs the additive host files, opens the fixed EditFlow CEP panel, executes the proof, and verifies the same AE PID afterward. It never owns AE shutdown/restart.

Repository schema validation, TypeScript typecheck, and the complete unit/contract test suite pass with this route present. The authenticated warm-AE acceptance run itself is still pending execution on the self-hosted Shadow/AE workstation; code readiness must not be confused with host acceptance.

## Four M4 gates

### 1. Capability Gate

Current slice: **STRUCTURAL + TYPED FRAME-EVIDENCE ROUTE READY — NOT PRODUCTION AVAILABLE**.

The deterministic tracker, BMP/TIFF decoders, semantic state readback, additive typed TIFF capture profile, bounded frame manifest, authenticated proof CLI, and warm-AE runner exist and pass repository CI. Direct real-AE TIFF pixels have also been decoded and tracked successfully.

The gate remains open because the complete authenticated `render.capture` → TIFF manifest → decoder → point tracker path has not yet produced a retained passing self-hosted AE acceptance artifact. `ae.tracking.point` therefore remains unavailable in the production capability registry.

### 2. Brain Gate

Current slice: **INITIAL PASS**.

The Brain has explicit policies for track acceptance/rejection, drift-repair routing, tracked reframing, subject preservation, and foreground-occlusion candidacy. Decisions remain confidence-gated and explainable. Production use remains blocked by the Capability Gate.

### 3. Visual Gate

Current slice: **DIRECT PIXEL EVIDENCE EXISTS — FORMAL VISUAL GATE NOT YET PASSED**.

The direct AE experiment demonstrates retention of a deliberately moving target in AE-rendered pixels. Formal acceptance still requires retained proof frames and viewer-visible criteria on representative footage, including ambiguity, loss/occlusion, and tracked-reframe stability. Structural or tracker-only success is insufficient.

### 4. Workflow Gate

Current slice: **HARNESS READY — NOT YET PASSED**.

The authenticated observe → capture pixels → track → semantic readback portion is implemented as a bounded proof harness. The full M4 workflow still must demonstrate decide → construct → preview → detect drift/defect → repair or fail closed without corrupting the project.

## Next implementation slice

Run and retain **M4 P1/P2 authenticated warm-AE acceptance** through the checked-in harness, then advance only from evidence.

Required immediate outputs:

- terminal authenticated `render.capture` evidence from the current M4 host wrapper;
- exact TIFF frame manifest and decoded `GrayFrameV1` sequence;
- stable real-composition trajectory with confidence/provenance, or an explicit `EVIDENCE_INSUFFICIENT` result if the active clip lacks suitable motion;
- unchanged project fingerprint, item count, active composition, and cleaned Render Queue after proof;
- retained `M4_POINT_TRACK_REAL_AE_V1` result artifact.

After that accepted result, continue with:

- semantic readback into `EditorSubjectStateV1` and Editor Brain v1 decision on retained real-host evidence;
- deterministic tracked-reframe construction only at the proof maturity actually reached;
- formal visual ambiguity/loss/occlusion cases;
- recovery proof for lost/drifting tracks;
- transfer proof on materially different motion/appearance evidence.

Only after the required real-host, visual, recovery, and transfer evidence passes should `ae.tracking.point` be promoted beyond its current fail-closed foundation state for production use.
