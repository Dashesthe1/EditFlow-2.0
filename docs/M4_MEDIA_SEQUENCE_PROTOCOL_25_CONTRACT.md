# M4 Media Sequence Protocol 2.5

Status: **PARTIAL / REAL-AE STRUCTURAL + ROLLBACK PROOF**
Protocol: `2.5.0`
Route ID: `ae-cep.media-sequence.v2_5`

## Purpose

Provide a bounded native After Effects image-sequence surface for temporal segmentation rasters without changing the accepted protocol 1.1 still-media import path.

Protocol 2.5 is additive over accepted protocol 2.4. A protocol-2.5 module-load failure returns a typed failure for 2.5 traffic while preserving earlier dispatch surfaces.

## Commands

`media.sequence.import` requires:

- absolute/material first-frame path;
- caller-owned stable item ID;
- explicit positive frame rate no greater than 99 fps;
- explicit positive expected frame count;
- exact current host project revision.

The host uses After Effects `ImportOptions.sequence = true`, disables forced alphabetical ordering, imports the footage natively, assigns the stable ID, and sets `mainSource.conformFrameRate` to the requested rate.

`media.sequence.readback` resolves only stable/host item references and returns exact footage identity, first-frame path, dimensions, duration, frame rate, frame duration, native/conformed/display frame rates, still/temporal state, and derived frame count.

## Fail-closed rules

Import rejects before mutation when the path or stable identity is missing, the first frame is absent, frame rate/frame count is invalid, or the expected host revision is stale.

A pre-existing stable ID is accepted as `NO_OP` only when path, temporal state, frame rate, display frame rate, and frame count all match. Otherwise the request fails with a stable-ID conflict rather than rebinding identity.

After import, exact host readback must match requested path, frame rate, and frame count. Any mismatch enters transaction rollback. The rollback route closes the undo group, executes the bounded After Effects Undo command, and verifies the imported stable item no longer resolves.

## Retained real-AE proof

The accepted proof generated three numbered 64x48 BMP mask frames and executed protocol 2.5 in the already-running After Effects 2025 process.

The host read back:

- sequence name `mask-sequence-[0001-0003].bmp`;
- 3 frames;
- 12 fps native, conformed, displayed, and item frame rate;
- 0.25 second duration;
- temporal footage (`isStill: false`);
- exact first-frame material path.

The same warm-process proof independently read the sequence back, proved identical re-import is idempotent, rejected a deliberately stale revision, injected a failure after a second import, verified Undo removed the failed stable item, and restored the project item count to its pre-proof baseline.

The proof ran under the AE host supervisor, reused the existing After Effects PID, did not restart or close the application, and left the warm host verified healthy.

## Promotion boundary

This closes the missing **AE-native image-sequence import/readback primitive** for dynamic segmentation materialization. It does not by itself make segmentation dynamic end to end.

Still open are:

- a provider/runtime contract that emits a correlated temporal series rather than one independent mask result;
- full sequence-artifact integrity across every frame, not only first-frame path identity;
- temporal materialization planning that binds sequence timing to exact source/comp timing;
- viewer-visible dynamic matte proof on materially changing footage;
- save/reopen/reconnect and unrelated-footage transfer evidence;
- production runtime registration after those gates pass.

Protocol 1.1 still-image import remains unchanged and remains the path for static segmentation materialization.
