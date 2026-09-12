# M4 Semantic Attach Points Contract

Status: **PARTIAL / DECLARED / R0_READ_ONLY**  
Capability ID: `ae.tracker.semantic_attach.resolve`  
Route ID: `ae.m4.tracker.semantic-attach-resolve.v1`

## Purpose

Bridge scene intelligence and tracking/edit execution without pretending that raw image coordinates are semantic understanding. The resolver turns an already observed, evidence-backed semantic entity into an explicit attach point that downstream tracking, stabilization, reframing, effects placement, and isolation operations can consume.

This tranche is deliberately a **resolver, not a detector**. Detection/classification, face or pose landmarks, segmentation, and temporal identity continuity remain upstream responsibilities.

## Relationship to existing M4 state

The current M4 tracking-state contract already uses a stable `semanticId` plus normalized x/y coordinates, confidence, drift risk, occlusion, and evidence IDs. Semantic attach points preserve that normalized-coordinate convention. They do not introduce a competing pixel-only scene model.

## Input entity geometry

`SemanticSceneEntityGeometryV1` requires:

- `semanticId`: stable semantic identity;
- `entityClass`: exact upstream class such as `PERSON`, `FACE`, `TEXT`, `LOGO`, `PRODUCT`, `SCREEN`, or another scene-intelligence class;
- `boundingBox`: normalized `[x, y, width, height]` fully inside `[0, 1]` scene extent;
- `confidence`: `[0, 1]`;
- optional exact named landmarks, each with normalized x/y, confidence, and evidence IDs;
- optional entity evidence IDs.

The resolver does not infer entity class, identity, or landmarks.

## Query semantics

A query may select by:

1. exact `semanticId` (preferred);
2. exact `entityClass` only when exactly one valid entity matches;
3. both identity and class, in which case both must match.

Class-only ambiguity fails closed. The resolver never picks the first/highest-confidence entity merely because several entities share a class.

Optional `minConfidence` applies to the final attach-point evidence. Optional composition width/height may be supplied together to derive a pixel coordinate; supplying only one dimension or a non-positive/non-finite extent fails closed.

## Attach targets

### Bounding-box anchors

Bounding-box geometry may resolve these deterministic anchors:

- `CENTER`
- `TOP`
- `BOTTOM`
- `LEFT`
- `RIGHT`
- `TOP_LEFT`
- `TOP_RIGHT`
- `BOTTOM_LEFT`
- `BOTTOM_RIGHT`

These are geometry derivations, not semantic landmark claims. For example, `CENTER` of a `PERSON` box is not asserted to be the person's chest, face, or center of mass.

### Named landmarks

`LANDMARK` requires an exact upstream landmark name on the selected entity, such as `nose_tip` or `left_hand`. Missing or malformed landmarks return `null`; the resolver does not synthesize a plausible point from the bounding box.

The final landmark confidence is conservative: `min(entity.confidence, landmark.confidence)`.

## Output

`SemanticAttachResolutionV1` contains:

- bound `semanticId` and `entityClass`;
- source (`BOUNDING_BOX` or `LANDMARK`);
- exact anchor/landmark identity;
- normalized point;
- optional composition-pixel point;
- conservative confidence;
- de-duplicated evidence IDs.

This makes semantic binding explicit and auditable before downstream tracking or edit writes.

## Fail-closed behavior

The resolver returns `null` for unsupported or unreliable cases, including:

- no selector;
- zero or multiple valid matches;
- identity/class mismatch;
- malformed/out-of-frame bounding box;
- invalid confidence threshold;
- confidence below threshold;
- missing/malformed landmark;
- partial/invalid composition extent.

No fallback to guessed semantics is allowed.

## Safety and proof maturity

This tranche is `R0_READ_ONLY`; it changes no After Effects state and requires no rollback. It begins at `DECLARED` proof maturity with deterministic unit coverage.

Runtime capability registration is intentionally withheld until the scene-intelligence producer is integrated and a retained proof demonstrates that semantic identity, geometry, confidence, and evidence provenance survive the full path into this resolver.

## Required promotion proof

A future retained proof should demonstrate at minimum:

1. scene intelligence emits a real entity with stable semantic identity and evidence provenance;
2. exact-id resolution produces the intended normalized attach point;
3. at least one evidence-backed landmark resolves without fallback invention;
4. ambiguous class-only input fails closed;
5. the resolved attach point can seed or bind a downstream tracker/effect target without identity drift;
6. confidence/evidence remain traceable through readback;
7. no unrelated project state changes.

## Human-parity status

This closes the deterministic **semantic attach-point resolution** portion of the M4 roadmap. It does not yet provide semantic detection, segmentation, landmark extraction, automatic target recovery after occlusion, or tracker application. The next M4 gap is the subject/object segmentation interface, followed by segmentation-to-mask/matte application and manual repair/resume workflows.
