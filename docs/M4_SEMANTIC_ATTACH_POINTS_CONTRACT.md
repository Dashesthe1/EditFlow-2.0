# M4 Semantic Attach Points Contract

Status: **FULL / TRANSFER / R0_READ_ONLY**
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

This capability remains `R0_READ_ONLY`; the resolver itself changes no After Effects state and requires no rollback. The accepted proof maturity is now `TRANSFER` because exact evidence-backed semantic attachment was exercised through a live After Effects construction on two materially different retained SAM 3.1 source fixtures.

Runtime capability registration is accepted through the M4 foundation registry. This does **not** promote unrestricted AE write dispatch: the resolver remains a pure subsystem adapter with `FORBID` fallback, and downstream writes remain governed by their own typed capabilities and proof gates.

## Accepted transfer proof

Retained proof `M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE` demonstrates:

1. two digest-bound real source fixtures with materially different footage;
2. retained SAM 3.1 masks converted into deterministic interior landmarks with exact per-frame evidence provenance;
3. exact-`semanticId` landmark resolution at all six frames of each fixture;
4. ambiguous class-only input failing closed;
5. a visible AE construction attached to the resolved point with frame-held keyframes;
6. an intentionally wrong attachment, explicit repair state reaching `RESUMED`, and visible wrong-to-correct relocation;
7. native temporal source and matte sequences, LUMA matte isolation, and downstream composite readback;
8. transfer to the unrelated second fixture without identity fallback;
9. seven visual checkpoints passing, warm AE process reuse, and exact project-baseline restoration;
10. fast-path routine dispatch gaps of 7 ms maximum and approximately 0.53 ms mean in the retained run.

The retained acceptance artifact is `proofs/diagnostics/m4-exit-gate-semantic-attach-real-ae-acceptance.json`.

## Human-parity status

The M4 semantic attach requirement and the wider Tracking & Isolation exit gate are now accepted at the bounded proof level: a moving real-world subject is isolated, a visible construction follows evidence-backed semantic geometry, deliberate drift is repaired, and the workflow transfers to unrelated footage.

The resolver still does not claim to be a detector, face/pose model, segmenter, or tracker. Those remain separate upstream/downstream capabilities with their own evidence and failure semantics. The next roadmap milestone is M5 interactive AE adapters.