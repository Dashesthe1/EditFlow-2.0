# M3 Graph Editor Temporal Ease Foundation — Protocol 1.8

Status: **PARTIAL / DECLARED**. This foundation is implemented and contract-testable, but it is not promoted to STRUCTURAL, VISUAL, TRANSFER, or FULL until real-After-Effects proof is accepted.

## Roadmap scope

This tranche begins **Milestone 3 item 10: Graph Editor speed/value controls, influence/velocity**.

Protocol 1.8 owns the numeric temporal-handle state that After Effects exposes through `KeyframeEase`:

- `property.temporal_ease.set`
- `property.temporal_ease.readback`
- incoming `speed` + `influence`
- outgoing `speed` + `influence`
- exact live-host cardinality validation for scalar/spatial, TwoD, and ThreeD properties
- structural readback, project-revision precondition, no-op detection, and undo rollback

Keyframe values themselves remain owned by the accepted keyframe CRUD surface. Protocol 1.7 remains authoritative for temporal interpolation type, temporal continuity, and temporal auto-Bezier state. Protocol 1.8 deliberately requires manual BEZIER state before a numeric ease mutation instead of silently changing protocol-1.7-owned state.

## External API basis

The implementation is derived from the current After Effects scripting surface rather than trial-and-error assumptions:

- After Effects Scripting Guide — `Property.keyInTemporalEase`, `Property.keyOutTemporalEase`, `Property.setTemporalEaseAtKey`: https://ae-scripting.docsforadobe.dev/property/property/
- After Effects Scripting Guide — `KeyframeEase`: https://ae-scripting.docsforadobe.dev/other/keyframeease/
- Adobe After Effects help — Graph Editor speed/value graph behavior: https://helpx.adobe.com/after-effects/using/editing-moving-copying-keyframes.html

The API contract says `KeyframeEase` is defined by `speed` and `influence`; influence is constrained to `0.1..100.0`. `Property.setTemporalEaseAtKey` consumes one ease object for most value types, two for `PropertyValueType.TwoD`, and three for `PropertyValueType.ThreeD`. Spatial TwoD/ThreeD properties therefore use the single-object path described by the scripting guide.

## Deliberate preconditions

A protocol-1.8 mutation fails closed unless:

1. the target composition, layer, property path, and key index resolve exactly;
2. the property exposes temporal-ease read/write methods;
3. incoming and outgoing interpolation are already `BEZIER`;
4. `temporalAutoBezier` is already `false`;
5. `inEase` and `outEase` contain exactly the live property cardinality;
6. every speed is finite;
7. every influence is finite and within `0.1..100.0`;
8. `expectedHostProjectRevision` matches the current project revision.

These preconditions keep protocol ownership explicit: callers use accepted protocol 1.7 when interpolation state must change, then protocol 1.8 for numeric Graph Editor handles.

## Scope exclusions

This tranche does **not** claim:

- Milestone 3 item 11 spatial Bezier paths/tangents;
- `setSpatialTangentsAtKey`, spatial continuity/auto-Bezier, or roving keyframes;
- new hold/roving/ease-variant helpers beyond the already accepted temporal interpolation state;
- Milestone 3 item 12 markers, motion blur, frame blending, or shutter controls;
- arbitrary code execution or generic ExtendScript evaluation.

## Required real-AE proof before promotion

The first proof sequence should follow the repository's established P1–P5 maturity discipline:

- **P1 — exact structural readback:** prove scalar/spatial single-ease cardinality and at least one multi-component temporal property, with exact incoming/outgoing speed/influence readback.
- **P2 — viewer-visible mutation:** apply deliberately asymmetric numeric ease to real animation and prove that sampled/rendered motion differs from the linear/manual-Bezier baseline while key values and key times remain unchanged.
- **P3 — persistence:** save, close/reopen or equivalent owned-session persistence boundary, then read back the exact ease state.
- **P4 — rollback:** induce a post-mutation failure inside the transaction boundary and prove the original ease arrays are restored.
- **P5 — transfer:** reproduce the capability in a materially different property/context and fresh session, then accept evidence only if correlation, structural truth, and viewer-visible behavior all pass.

Until those proofs exist, `ae.property.temporal_ease.set` and `ae.property.temporal_ease.readback` remain **PARTIAL / DECLARED**.
