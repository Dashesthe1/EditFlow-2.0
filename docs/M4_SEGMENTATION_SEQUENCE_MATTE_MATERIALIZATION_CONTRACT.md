# M4 Segmentation Sequence Matte Materialization Contract

Status: **PARTIAL / DETERMINISTIC REAL-AE DYNAMIC VISUAL EVIDENCE**
Capability ID: `tracking.segmentation.sequence_matte_materialize.plan`
Route ID: `m4.tracking.segmentation-sequence-matte-materialize.v1`

## Purpose

Plan an already accepted temporal segmentation raster sequence into native After Effects sequence import, exact forward timing, 2D alignment, and track-matte binding without weakening per-frame artifact identity or cadence.

The public capability remains read-only and emits an operation plan. The retained proof harness dispatches that plan only inside a bounded proof-owned fixture.

## Preconditions

The planner fails closed unless every numbered frame has exact accepted artifact identity, SHA-256, content type, uniform raster geometry, contiguous numbering, and retained evidence. The target must be a proven 2D layer with forward timing, and the requested source interval must fit inside that target timing.

V1 refuses reverse stretch, missing evidence, digest or identity drift, broken sequence numbering, nonuniform geometry, ambiguous stable IDs, and uncovered source ranges.

## Planned operation sequence

A valid plan emits exactly:

1. protocol 2.5 `media.sequence.import`;
2. protocol 1.1 `layer.add_media`;
3. protocol 1.1 `layer.set_transform`;
4. protocol 1.1 `layer.set_timing`;
5. protocol 1.3 `layer.set_track_matte`.
## Retained real-AE evidence

The dynamic proof reuses the already-running After Effects process and imports a three-frame 240×135 mask sequence at 12 fps. The white mask region moves left, center, then right over a red subject and blue background.

After the full five-operation batch, retained readback verifies the sequence is temporal, frame count/rate and first-frame path are exact, matte source identity and timing are exact, and the target is bound to the expected LUMA track matte.

Three mid-frame PNG checkpoints are then pixel-validated outside After Effects. Each frame must reveal red only at its current mask center while the other two centers and an independent background sample remain blue. This rejects a static, mistimed, or incorrectly bound matte.

The proof removes only proof-owned objects and verifies project item count, Render Queue count, and the open project file return to the pre-proof baseline. The retained run passed using the existing AE process without launch or restart.

## Promotion boundary

This evidence raises the AE-side planner from `STRUCTURAL` to `VISUAL`. A separate retained warm-process transfer proof now exercises the same five-operation materialization contract against materially different real Spider-Man footage, with exact source-item preservation, structural sequence/matte readback, moving-mask pixel evidence against same-timestamp source baselines, and proof-owned cleanup. It does **not** prove live SAM 3.1 inference, session-boundary robustness, or unrestricted production dispatch.

Production registration remains withheld until authenticated live SAM 3.1 sequence output is retained and the contract survives reconnect/save-reopen boundaries without hidden approximation. Warm-process materially different-footage transfer is now retained.

## Related evidence

- `proofs/diagnostics/m4-segmentation-sequence-materialization-live-acceptance.json`
- `proofs/diagnostics/m4-segmentation-sequence-transfer-live-acceptance.json`
- `proofs/manifests/m4-segmentation-sequence-materialization-real-ae.request.json`
- `proofs/manifests/m4-segmentation-sequence-transfer-real-ae.request.json`
- `M4_MEDIA_SEQUENCE_PROTOCOL_25_CONTRACT.md`
- `M4_SEGMENTATION_MATTE_MATERIALIZATION_CONTRACT.md`
