# M4 Segmentation -> Matte Export Contract

Status: **PARTIAL / VISUAL / R0_READ_ONLY**
Capability ID: `tracking.segmentation.matte_export.plan`  
Route ID: `m4.tracking.segmentation-matte-export.v1`

## Purpose

Bridge an already accepted subject/object segmentation artifact to EditFlow's proven After Effects protocol 1.3 track-matte contract without weakening artifact identity or channel semantics.

The planner produces the exact `layer.set_track_matte` payload used after the raster artifact is materialized as an AE layer. A separate composed materialization planner and retained real-AE proof now exercise exact media import, matte-layer creation, 2D crop alignment, target timing, and track-matte application; this export planner itself remains read-only and does not dispatch those writes.

## Explicit channel semantics

The caller must specify `ALPHA` or `LUMA`, plus optional inversion. The planner maps this directly to:

- `ALPHA`
- `ALPHA_INVERTED`
- `LUMA`
- `LUMA_INVERTED`

Channel interpretation is never inferred from segmentation encoding or file content type. A probability raster, PNG, TIFF, or other artifact does not automatically imply a particular AE matte channel.

## Materialization precondition

Every plan retains:

- exact segmentation artifact ID and content type;
- raster width/height;
- normalized source-space bounds;
- exact AE matte-layer stable ID;
- `requiresExactArtifactProof: true`.

Any write executor must prove the matte layer was created from that exact artifact before it may dispatch `ae.layer.track_matte.set`. The retained bounded materialization proof satisfies this requirement for its proof-owned fixture and then verifies the resulting matte structurally and visually.

Cropped artifact bounds are preserved because the raster must be aligned into source/comp space before matte binding. The planner does not silently stretch a crop to full frame.

## Composite payload

The output contains a typed protocol 1.3 `AeSetTrackMattePayloadV13` with:

- exact comp stable reference;
- exact target-layer stable reference;
- distinct matte-layer stable reference;
- explicit track-matte type.

The target layer may not also be its own matte layer.

## Fail-closed behavior

Planning returns `null` for unknown channels, invalid inversion values, malformed/missing stable references, self-matte binding, malformed artifact identity/dimensions/bounds, invalid segmentation identity/time, or absent evidence provenance.

## Safety and proof maturity

This tranche is `R0_READ_ONLY`. It performs no AE write and requires no rollback. Retained real-AE composition evidence now covers exact artifact materialization/import, cropped 2D alignment, track-matte transaction dispatch, structural readback of the intended matte source/type, retained render emission, and deterministic cleanup to the pre-proof warm-project baseline.

The retained deterministic real-AE fixture proves a pixel-validated visual isolation checkpoint plus an induced failure followed by Undo, structural verification that the track matte cleared, and exact matte reapplication. A separate deterministic temporal proof now covers native sequence import, exact cadence/timing, moving-mask visual evidence, matte binding, and baseline restoration. Runtime registration remains withheld because checkpoint-backed live segmentation-provider integration plus materially different-footage and session/save-reopen transfer evidence are still open. The actual write uses the existing reversible `ae.layer.track_matte.set` capability and inherits its transaction/undo/readback requirements.

## Human-parity status

This closes the deterministic **segmentation-to-matte export planning** proof gap through retained real-AE static visual/rollback evidence, while the separate temporal materialization route has its own dynamic visual proof. Checkpoint-backed live-provider output and transfer/session robustness remain unproven. Bezier contour extraction from raster masks is also not claimed by this tranche; it requires an explicit contour-generation route and separate geometry proof.
