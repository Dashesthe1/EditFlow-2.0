# M4 Segmentation Sequence Matte Materialization Contract

Status: **FULL / TRANSFER — RETAINED REAL-AE P5**
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

The planner/materialization surface now has retained P5 transfer evidence. The accepted lifecycle proof reuses the already-running After Effects process, saves the user project once, performs the proof in a disposable lifecycle copy, reopens that copy without restarting AE, establishes a distinct authenticated CEP session, verifies exact temporal sequence/matte readback, performs a fresh post-reconnect matte mutation with exact readback, preserves the three visual checkpoints, and restores the saved user-project baseline.

This promotes `tracking.segmentation.sequence_matte_materialize.plan` to `FULL / TRANSFER`. It does **not** promote the live SAM 3.1 provider or unrestricted production dispatch. Production registration remains withheld until checkpoint-backed SAM 3.1 temporal output is retained through the accepted provider correlation, provenance, per-frame digest, and downstream materialization gates.

## Related evidence

- `proofs/diagnostics/m4-segmentation-sequence-materialization-live-acceptance.json`
- `proofs/diagnostics/m4-segmentation-sequence-transfer-live-acceptance.json`
- `proofs/diagnostics/m4-segmentation-sequence-p5-live-acceptance.json`
- `proofs/manifests/m4-segmentation-sequence-materialization-real-ae.request.json`
- `proofs/manifests/m4-segmentation-sequence-transfer-real-ae.request.json`
- `M4_MEDIA_SEQUENCE_PROTOCOL_25_CONTRACT.md`
- `M4_SEGMENTATION_MATTE_MATERIALIZATION_CONTRACT.md`
