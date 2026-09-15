# M4 Segmentation Sequence Matte Materialization Contract

Status: **FULL / TRANSFER — LIVE SAM 3.1 E2E + RETAINED REAL-AE P5**
Capability ID: `tracking.segmentation.sequence_matte_materialize.plan`
Route ID: `m4.tracking.segmentation-sequence-matte-materialize.v1`

## Purpose

Plan an already accepted temporal segmentation raster sequence into native After Effects sequence import, exact forward timing, 2D alignment, and track-matte binding without weakening per-frame artifact identity or cadence.

The public capability remains read-only and emits an operation plan. Retained proof harnesses dispatch that plan only inside bounded proof-owned fixtures.

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

The deterministic dynamic proof reuses the already-running After Effects process and imports a three-frame 240×135 mask sequence at 12 fps. The white mask region moves left, center, then right over a red subject and blue background.

After the full five-operation batch, retained readback verifies the sequence is temporal, frame count/rate and first-frame path are exact, matte source identity and timing are exact, and the target is bound to the expected LUMA track matte. Three mid-frame PNG checkpoints are pixel-validated outside After Effects, rejecting a static, mistimed, or incorrectly bound matte.

The materially different-footage transfer proof applies the same temporal materialization contract to registered real video while preserving the source item and restoring the warm project baseline.

The P5 lifecycle proof reuses the current AE process, saves the user project once, performs the proof in a disposable lifecycle copy, reopens that copy without restarting AE, establishes a distinct authenticated CEP session, verifies exact temporal sequence/matte readback, performs a fresh post-reconnect matte mutation with exact readback, preserves the visual checkpoints, and restores the saved user-project baseline.

## Live SAM 3.1 → AE dynamic matte E2E

A separate retained proof now feeds checkpoint-backed `sam3.1.local` temporal output directly into this planner. Six 1080×1080 masks at 59.94 fps are imported natively by protocol 2.5 and bound as a LUMA track matte through the exact five-operation plan.

Three source-frame checkpoints (frames 0, 3, and 5) are pixel-validated after AE materialization. All foreground/background samples pass, all three review-frame SHA-256 values are distinct, the sequence reads back as six temporal frames at the requested cadence, and the expected matte identity/timing/composite binding read back exactly.

The proof reused the existing AE PID, created only proof-owned objects, and restored project item count, Render Queue count, and the open project file to their pre-proof baseline. A follow-on P5 rerun then accepted save/reopen/distinct-authenticated-CEP reconnect, a fresh post-reconnect matte mutation, visual stability, and exact user-project restoration.

## Promotion boundary

The temporal planner/materialization surface is accepted as `FULL / TRANSFER`. The checkpoint-backed SAM 3.1 runtime is separately accepted through digest-bound retained evidence, and `registerAcceptedM4SegmentationRuntimeCapabilities` registers the accepted segmentation route plus this planner only when that trusted evidence is loaded.

This is still an `R0_READ_ONLY` public planning capability. The live E2E harness proves that its unchanged typed plan can be executed safely inside a bounded proof fixture; it does **not** promote unrestricted production write dispatch or allow callers to bypass normal typed-operation validation and production controls.

## Related evidence

- `proofs/diagnostics/m4-segmentation-sequence-materialization-live-acceptance.json`
- `proofs/diagnostics/m4-segmentation-sequence-transfer-live-acceptance.json`
- `proofs/diagnostics/m4-segmentation-sequence-p5-live-acceptance.json`
- `proofs/diagnostics/m4-sam31-live-sequence-matte-e2e-live-acceptance.json`
- `proofs/diagnostics/m4-sam31-live-transfer-proof.json`
- `proofs/manifests/m4-segmentation-sequence-materialization-real-ae.request.json`
- `proofs/manifests/m4-segmentation-sequence-transfer-real-ae.request.json`
- `proofs/manifests/m4-segmentation-sequence-p5-real-ae.request.json`
- `proofs/manifests/m4-sam31-live-sequence-matte-e2e-real-ae.request.json`
- `M4_MEDIA_SEQUENCE_PROTOCOL_25_CONTRACT.md`
- `M4_SAM31_LOCAL_PROVIDER_CONTRACT.md`
- `M4_SEGMENTATION_MATTE_MATERIALIZATION_CONTRACT.md`
