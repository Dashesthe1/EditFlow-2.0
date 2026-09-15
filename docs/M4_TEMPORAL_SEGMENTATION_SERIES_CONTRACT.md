# M4 Temporal Segmentation Series Contract

Status: **STRUCTURAL CONTRACT / NOT RUNTIME PROMOTED**  
Contract: `SubjectSegmentationSeriesProviderV1`  
Consumer boundary: native temporal raster materialization (`media.sequence.*`, protocol 2.5)

## Purpose

Define the missing provider/runtime boundary for dynamic subject segmentation without weakening the accepted single-frame V1 contract.

A temporal provider must emit one explicitly correlated series for one source and one stable semantic subject. EditFlow does not treat a loop of unrelated single-frame results as a temporal series merely because the timestamps happen to be adjacent.

## Additive compatibility rule

The existing `SubjectSegmentationRequestV1`, `SubjectSegmentationResultV1`, `SubjectSegmentationProviderV1`, `validateSubjectSegmentationRequestV1`, and `acceptSubjectSegmentationResultV1` surfaces remain unchanged.

The temporal surface adds:

- `SubjectSegmentationSeriesRequestV1`;
- `SubjectSegmentationSeriesResultV1`;
- `AcceptedSubjectSegmentationSeriesV1`;
- `SubjectSegmentationSeriesProviderV1`;
- `validateSubjectSegmentationSeriesRequestV1`;
- `acceptSubjectSegmentationSeriesResultV1`.

Every temporal frame remains an exact V1 request/result pair, so temporal support reuses the accepted single-frame correlation rules rather than bypassing them.

## Request guarantees

A series request requires:

- non-empty stable `seriesId`;
- exact `sourceId` and `semanticId` shared by every frame;
- exact optional `entityClass` shared by every frame;
- explicit positive `frameRate` no greater than 99 fps, matching the accepted protocol-2.5 host ceiling;
- at least one frame request;
- unique frame request IDs;
- strictly increasing frame timestamps;
- no source, semantic-identity, or entity-class drift between frames;
- no frame-level preferred encoding that conflicts with an explicit series encoding.

The contract deliberately does not synthesize timestamps, infer missing subject identity, or coerce mismatched frame rates.

## Result guarantees

A series result must correlate exactly to the request by:

- `seriesId`;
- `sourceId`;
- `semanticId`;
- optional exact `entityClass`;
- exact `frameRate`;
- exact frame count and frame order.

Every frame is independently accepted through `acceptSubjectSegmentationResultV1` against the corresponding request frame.

All accepted frames must also share:

- one provider ID;
- one provider version value;
- one mask encoding;
- one raster width and height;
- one normalized source-space bounds rectangle;
- one artifact content type.

If the series request constrains mask encoding, every accepted frame must use that exact encoding.

## Integrity rule

Single-frame V1 keeps SHA-256 optional for compatibility.

Temporal-series acceptance is intentionally stricter: **every accepted frame must carry a lowercase 64-character SHA-256 digest**. This makes per-frame integrity evidence mandatory before a temporal series can be handed to sequence-artifact planning.

This tranche validates the presence and syntax of each accepted frame digest. It does not yet prove that a downstream numbered image-sequence directory contains exactly those verified bytes in exact frame order; that materialized-sequence integrity proof remains a separate gate.

## Fail-closed rules

Series validation or acceptance returns refusal/null rather than repairing:

- empty or malformed series identity;
- invalid/unsupported frame rate;
- duplicate frame request IDs;
- non-increasing timestamps;
- source/subject/entity-class drift;
- frame-count or ordering mismatch;
- provider identity/version drift;
- encoding substitution;
- raster dimension drift;
- source-bounds drift;
- artifact content-type drift;
- missing or malformed per-frame SHA-256 evidence;
- any frame that independently fails the accepted V1 result contract;
- absent series provenance evidence.

## Relationship to SAM 3.1

The existing `sam3.1.local` adapter remains an image-only single-frame provider and continues to refuse `previousArtifactId` temporal refinement. This contract does not relabel that adapter as temporal and does not silently loop it to simulate temporal model behavior.

A future SAM 3.1 temporal adapter may implement `SubjectSegmentationSeriesProviderV1` only after retained evidence shows that it genuinely consumes/maintains temporal subject state and returns a correlated series satisfying this contract.

## Relationship to After Effects protocol 2.5

Protocol 2.5 already proves native AE image-sequence import/readback, frame-rate/frame-count interpretation, idempotency, stale-revision refusal, and rollback.

This contract closes the missing **core temporal-series shape and acceptance boundary** between a future temporal segmentation provider and that host primitive. It does not yet create a numbered mask sequence or bind source timestamps to comp timing.

## Deterministic proof

The retained contract test covers:

- valid ordered series acceptance;
- duplicate request-ID refusal;
- non-increasing timestamp refusal;
- source/semantic/entity-class drift refusal;
- invalid frame-rate and encoding refusal;
- exact series/frame correlation;
- reordered/missing-frame refusal;
- provider ID/version drift refusal;
- raster geometry/encoding/content-type drift refusal;
- mandatory per-frame lowercase SHA-256 evidence;
- series evidence de-duplication.

A strict TypeScript compile with `noUncheckedIndexedAccess` also passes for the added surface.

## Promotion boundary

Still open before dynamic segmentation can be promoted end to end:

1. a real temporal SAM 3.1 provider implementation that fulfills this contract on the target workstation;
2. retained live inference on materially changing footage;
3. byte-verification and canonical ordering of every materialized numbered sequence frame;
4. temporal materialization planning that binds exact source timestamps/frame rate to source and comp timing;
5. viewer-visible dynamic matte proof in the warm After Effects process;
6. rollback/readback across the full composed provider-to-AE write path;
7. save/reopen/reconnect and materially different-footage transfer evidence;
8. production runtime registration only after those gates pass.
