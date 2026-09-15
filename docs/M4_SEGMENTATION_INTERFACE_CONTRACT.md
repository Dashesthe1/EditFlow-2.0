# M4 Subject/Object Segmentation Interface

Status: **PARTIAL / DECLARED / R0_READ_ONLY**  
Capability ID: `tracking.segmentation.subject_object.accept`  
Route ID: `m4.tracking.segmentation.subject-object.v1`

## Purpose

Define the model/provider-neutral boundary between EditFlow scene/tracking intelligence and a future subject/object segmentation engine. This tranche does **not** bundle, select, download, or execute a segmentation model. It establishes the exact request/result contract required before segmentation output can be trusted by downstream After Effects mask or matte application.

## Subject binding

Every request requires an exact stable `semanticId`. Class-only requests such as `PERSON` or `FACE` are intentionally unsupported here because multiple matching entities may be present. Semantic selection/disambiguation belongs upstream in scene intelligence and the semantic attach-point layer.

A request carries:

- stable request/source identity;
- exact timestamp in milliseconds;
- exact `semanticId` and optional exact entity class;
- optional normalized bounding-box hint;
- optional normalized positive/negative point prompts;
- optional prior accepted artifact identity for temporal propagation/refinement;
- optional preferred mask encoding.

All prompt geometry uses normalized source coordinates.

## Provider boundary

`SubjectSegmentationProviderV1` exposes one single-frame operation:

`segment(request) -> SubjectSegmentationResultV1`

The provider may be local, remote, host-native, or model-backed. The core tracking contract does not depend on a particular model family, runtime, licensing scheme, or hardware backend.

A concrete local `sam3.1.local` adapter now exists as a separate structural foundation. It deliberately remains outside production runtime registration until retained live SAM 3.1 inference evidence is accepted. The provider refuses unsupported point prompts and prior-artifact temporal refinement, explicitly selects a SAM 3.1 checkpoint rather than accepting the image builder's SAM 3.0 default, and verifies materialized mask bytes by SHA-256 before exposing an artifact to downstream code. See `M4_SAM31_LOCAL_PROVIDER_CONTRACT.md`.

## Temporal series boundary

Dynamic segmentation now has a separate additive provider contract:

`segmentSeries(request) -> SubjectSegmentationSeriesResultV1`

The temporal request is one exact source/semantic identity containing strictly ordered V1 frame requests, a bounded explicit frame rate, and optional series-wide encoding. The temporal result must preserve exact frame order/count and one provider identity while keeping raster encoding, dimensions, normalized source bounds, and artifact content type homogeneous across the series.

Every temporal frame is independently accepted through the single-frame validator. Temporal acceptance additionally requires a lowercase SHA-256 digest on every frame artifact before the series can be trusted by downstream sequence planning.

The existing single-frame `sam3.1.local` adapter does **not** implement this temporal interface and is not silently looped to imitate temporal model behavior. See `M4_TEMPORAL_SEGMENTATION_SERIES_CONTRACT.md`.

## Result contract

A single-frame provider result must correlate exactly to the request by:

- request ID;
- source ID;
- timestamp;
- semantic ID;
- entity class when the request constrained it.

It must include provider identity/version, normalized quality metrics, evidence provenance, and one raster mask artifact descriptor.

Supported mask semantics:

- `BINARY`
- `ALPHA`
- `PROBABILITY`

The artifact descriptor contains integer raster dimensions, normalized source-space bounds, opaque artifact identity, content type, and optional lowercase SHA-256 integrity hash. Cropped mask artifacts are therefore representable without pretending their raster coordinates already equal full-frame After Effects coordinates.

## Quality and provenance

Every accepted single-frame result contains normalized `[0, 1]` values for:

- confidence;
- edge quality;
- temporal consistency;
- occlusion.

At least one non-empty evidence ID is mandatory. Evidence IDs are de-duplicated on acceptance. The validator does not invent missing provenance.

Temporal series also require non-empty series provenance, with duplicate series evidence IDs removed on acceptance.

## Fail-closed validation

`validateSubjectSegmentationRequestV1` rejects malformed identity, time, prompt geometry, point prompts, prior artifact identity, or requested encoding.

`acceptSubjectSegmentationResultV1` rejects, rather than repairs:

- request/source/time/subject correlation mismatch;
- entity-class mismatch;
- unknown or silently substituted encoding;
- non-integer/non-positive raster size;
- malformed/out-of-frame source bounds;
- missing artifact identity/content type;
- malformed SHA-256;
- non-normalized quality metrics;
- absent provenance.

`validateSubjectSegmentationSeriesRequestV1` and `acceptSubjectSegmentationSeriesResultV1` add refusal for duplicate request IDs, non-increasing timestamps, source/subject/class drift, frame-count/order mismatch, provider drift, raster-shape/content-type drift, and missing per-frame SHA-256 integrity evidence.

Runtime-shaped malformed inputs are guarded so external JavaScript callers fail closed instead of throwing.

## Relationship to existing AE mask support

EditFlow already has typed transactional After Effects Bezier-mask operations. These interfaces intentionally sit **before** host writes. A raster segmentation artifact is not automatically treated as an AE Bezier path, track matte, alpha matte, or Roto Brush result.

Protocol 2.5 now separately proves native numbered image-sequence import/readback for temporal rasters. The remaining composed path must create and byte-verify the exact numbered series, bind exact source/comp timing, apply the temporal matte transactionally, and retain viewer-visible real-AE proof.

## Safety and proof maturity

The segmentation acceptance surfaces are `R0_READ_ONLY` and require no rollback. The single-frame provider foundation and temporal-series contract remain outside production runtime registration until concrete live providers produce retained evidence through them.

A promotion proof should demonstrate:

1. exact subject identity survives request/result correlation;
2. real segmentation output is retained under stable artifact identity;
3. dimensions, bounds, encoding, quality, and provenance read back truthfully;
4. ambiguous or mismatched subject evidence fails closed;
5. temporal output preserves exact frame ordering and one stable source/subject identity without hidden substitution;
6. every temporal frame is byte-verified before materialization planning;
7. no After Effects project state changes occur during the read-only provider proof.

## Human-parity status

The M4 segmentation interface now includes both single-frame and temporal-series acceptance boundaries. Remaining work is execution and composition: live SAM 3.1 temporal inference, canonical sequence materialization/integrity, exact timing plan assembly, viewer-visible dynamic matte proof, rollback/readback across the composed write path, transfer/save-reopen evidence, and production runtime registration.
