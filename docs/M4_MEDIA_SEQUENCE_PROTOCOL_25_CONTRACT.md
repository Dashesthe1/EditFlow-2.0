# M4 Media Sequence Protocol 2.5

Status: **FULL / TRANSFER PRIMITIVE — RETAINED REAL-AE + DOWNSTREAM LIVE E2E**
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

The accepted primitive proof generated three numbered 64×48 BMP mask frames and executed protocol 2.5 in the already-running After Effects 2025 process.

The host read back:

- sequence name `mask-sequence-[0001-0003].bmp`;
- 3 frames;
- 12 fps native, conformed, displayed, and item frame rate;
- 0.25 second duration;
- temporal footage (`isStill: false`);
- exact first-frame material path.

The same warm-process proof independently read the sequence back, proved identical re-import is idempotent, rejected a deliberately stale revision, injected a failure after a second import, verified Undo removed the failed stable item, and restored the project item count to its pre-proof baseline.

The proof ran under the AE host supervisor, reused the existing After Effects PID, did not restart or close the application, and left the warm host verified healthy.

## Downstream acceptance

The temporal segmentation route now closes the downstream gates that were previously open around this primitive:

- checkpoint-backed live SAM 3.1 video-session inference is retained with exact per-frame SHA-256/provenance evidence;
- the accepted sequence planner binds verified temporal masks to protocol 2.5 with exact cadence and target timing;
- viewer-visible dynamic matte output passes distinct multi-frame pixel checkpoints in real AE using live SAM 3.1 masks;
- materially different-footage transfer is retained;
- save/reopen plus a distinct authenticated CEP reconnect preserves the temporal sequence/matte state and accepts a fresh post-reconnect mutation;
- digest-bound runtime registration exposes the accepted segmentation route and sequence-matte planner as `FULL / TRANSFER / R0_READ_ONLY` only when trusted evidence is loaded.

The live E2E proof imported six 1080×1080 SAM 3.1 masks at 59.94 fps, read them back as a native six-frame sequence, bound them as a LUMA track matte, produced three distinct validated review frames, reused the same AE PID, and restored the proof-owned project baseline.

## Remaining boundary

Protocol 2.5 is an accepted typed AE primitive, but acceptance of the primitive and the read-only planner does not authorize unrestricted production write dispatch. Production execution must continue through the normal typed-operation validation, project-state guards, and production control path; callers may not treat retained proof harnesses as a general arbitrary-write API.

Protocol 1.1 still-image import remains unchanged and remains the path for static segmentation materialization.

## Related evidence

- `proofs/diagnostics/m4-sam31-live-sequence-matte-e2e-live-acceptance.json`
- `proofs/diagnostics/m4-segmentation-sequence-p5-live-acceptance.json`
- `proofs/manifests/m4-sam31-live-sequence-matte-e2e-real-ae.request.json`
- `M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_CONTRACT.md`
- `M4_SAM31_LOCAL_PROVIDER_CONTRACT.md`
