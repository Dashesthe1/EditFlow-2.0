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

`SubjectSegmentationProviderV1` exposes one operation:

`segment(request) -> SubjectSegmentationResultV1`

The provider may later be local, remote, host-native, or model-backed. The core tracking contract does not depend on a particular model family, runtime, licensing scheme, or hardware backend.

## Result contract

A provider result must correlate exactly to the request by:

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

Every accepted result contains normalized `[0, 1]` values for:

- confidence;
- edge quality;
- temporal consistency;
- occlusion.

At least one non-empty evidence ID is mandatory. Evidence IDs are de-duplicated on acceptance. The validator does not invent missing provenance.

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

Runtime-shaped malformed inputs are guarded so external JavaScript callers fail closed instead of throwing.

## Relationship to existing AE mask support

EditFlow already has typed transactional After Effects Bezier-mask operations. This interface intentionally sits **before** those host writes. A raster segmentation artifact is not automatically treated as an AE Bezier path, track matte, alpha matte, or Roto Brush result.

The next M4 tranche must define a truthful segmentation-to-mask/matte application strategy with coordinate conversion, transaction ownership, readback, rollback, and real-AE visual proof.

## Safety and proof maturity

This capability is `R0_READ_ONLY` and requires no rollback. It begins at `DECLARED` proof maturity with deterministic contract tests. Runtime registration is withheld until at least one concrete provider produces retained end-to-end evidence through this boundary.

A promotion proof should demonstrate:

1. exact subject identity survives request/result correlation;
2. real segmentation output is retained under a stable artifact identity;
3. dimensions, bounds, encoding, quality, and provenance read back truthfully;
4. ambiguous or mismatched subject evidence fails closed;
5. temporal refinement can explicitly reference a prior artifact without hidden mutable state;
6. no After Effects project state changes occur in this read-only tranche.

## Human-parity status

This closes the M4 **subject/object segmentation interface** gap, not segmentation execution or AE application. Remaining M4 work includes segmentation-to-mask/matte application, visual/readback proof in After Effects, occlusion/identity recovery, and manual repair/resume workflows.
