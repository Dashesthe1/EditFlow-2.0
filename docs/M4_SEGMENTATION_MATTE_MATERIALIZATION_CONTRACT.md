# M4 Segmentation Matte Materialization Contract

Status: **PARTIAL / STRUCTURAL + DETERMINISTIC REAL-AE VISUAL/ROLLBACK EVIDENCE**
Capability ID: `tracking.segmentation.matte_materialize.plan`
Route ID: `m4.tracking.segmentation-matte-materialize.v1`

## Purpose

Materialize one already accepted segmentation raster into After Effects without weakening source identity, crop geometry, timing, or track-matte semantics.

The public capability remains a read-only planner. It composes existing accepted AE mutation surfaces into an exact operation sequence; the retained proof harness dispatches that sequence only inside a bounded proof-owned fixture.

## Preconditions

The planner fails closed unless it receives:

- the exact accepted segmentation artifact ID, content type, SHA-256 digest, and absolute local path;
- retained artifact provenance;
- exact source-frame width/height with square pixels and retained geometry evidence;
- an exact 2D target-layer stable ID plus read-back transform and timing evidence;
- caller-owned, collision-free import-item and matte-layer stable IDs;
- an explicit `ALPHA` or `LUMA` channel and optional explicit inversion.

V1 deliberately refuses 3D target layers, non-square-pixel source geometry, missing evidence, malformed crop bounds, zero target scale, or ambiguous identity.

## Alignment model
A cropped segmentation raster is not stretched blindly to the target layer. Its normalized source-space bounds determine the crop center and source-space extent.

The planner maps that crop center through the target layer's scale and rotation to derive the matte position. Matte scale is derived independently from normalized source extent versus raster resolution, while target rotation and timing are preserved exactly.

## Composed operation sequence

A valid plan emits exactly:

1. protocol 1.1 `media.import`;
2. protocol 1.1 `layer.add_media`;
3. protocol 1.1 `layer.set_transform`;
4. protocol 1.1 `layer.set_timing`;
5. protocol 1.3 `layer.set_track_matte`.

The planner does not dispatch these writes itself and therefore remains `R0_READ_ONLY`. The proof harness exercises the composed operations against real After Effects and cleans only proof-owned objects.

## Retained real-AE evidence

The warm-process proof uses a deterministic cropped LUMA raster and verifies exact matte stable identity, exact imported source, crop alignment, opacity, timing, target-state preservation, track-matte source/type, artifact path, artifact dimensions, and operation order.

It also retains a rendered artifact and a review PNG whose expected subject and background pixels are validated outside After Effects.

The proof injects a guarded failure after matte application, applies the existing transaction Undo route, verifies that the track matte is structurally cleared, reapplies the exact planned matte operation, and verifies restoration.
Two consecutive retained runs passed in the same persistent After Effects process, with the proof fixture and Render Queue restored to the pre-proof baseline after each run.

Protocol 2.5 now separately has retained real-AE proof for native numbered image-sequence import/readback, exact frame-rate/frame-count interpretation, idempotency, stale-revision refusal, and rollback. That closes the AE-side sequence-import primitive without changing this static V1 planner. See `M4_MEDIA_SEQUENCE_PROTOCOL_25_CONTRACT.md`.

## What this does not prove

This tranche does not claim:

- live SAM 3.1 inference or production provider registration;
- save/reopen/reconnect or materially different-footage transfer;
- live-provider end-to-end dynamic multi-frame segmentation (deterministic temporal sequence integrity, timing-plan assembly, native AE import/binding, and dynamic visual motion are now retained; live SAM 3.1-generated output remains open);
- 3D or non-square-pixel materialization;
- unrestricted production dispatch of the composed write plan.

The configured development venv still lacks the `sam3` package and authenticated gated checkpoint access, so SAM 3.1 provider promotion remains separately blocked.

## Promotion boundary

Production registration remains withheld until the live provider can supply exact accepted artifacts and transfer/robustness evidence demonstrates that the same materialization contract survives unrelated footage and session boundaries without hidden approximation.
