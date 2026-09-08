# M3 Graph Editor Temporal Ease Foundation — Protocol 1.8

Status: **PARTIAL / STRUCTURAL**. Real-After-Effects P1 deterministic rejection and P2 exact structural readback are accepted. The capability is not promoted to VISUAL, TRANSFER, or FULL until P3/P4/P5 evidence is accepted.

## Roadmap scope

This tranche begins **Milestone 3 item 10: Graph Editor speed/value controls, influence/velocity**.

Protocol 1.8 owns the numeric temporal-handle state that After Effects exposes through `KeyframeEase`:

- `property.temporal_ease.set`
- `property.temporal_ease.readback`
- incoming `speed` + `influence`
- outgoing `speed` + `influence`
- exact live-host cardinality validation from the target key's incoming/outgoing `KeyframeEase` arrays
- structural readback, project-revision precondition, no-op detection, and undo rollback

Keyframe values themselves remain owned by the accepted keyframe CRUD surface. Protocol 1.7 remains authoritative for temporal interpolation type, temporal continuity, and temporal auto-Bezier state. Protocol 1.8 deliberately requires manual BEZIER state before a numeric ease mutation instead of silently changing protocol-1.7-owned state.

## External API basis

The implementation is derived from the current After Effects scripting surface rather than trial-and-error assumptions:

- After Effects Scripting Guide — `Property.keyInTemporalEase`, `Property.keyOutTemporalEase`, `Property.setTemporalEaseAtKey`: https://ae-scripting.docsforadobe.dev/property/property/
- After Effects Scripting Guide — `KeyframeEase`: https://ae-scripting.docsforadobe.dev/other/keyframeease/
- Adobe After Effects help — Graph Editor speed/value graph behavior: https://helpx.adobe.com/after-effects/using/editing-moving-copying-keyframes.html

The API contract says `KeyframeEase` is defined by `speed` and `influence`; influence is constrained to `0.1..100.0`. The generic Property documentation describes one, two, or three ease objects according to the property value type. However, Scale has an important host-specific edge: Adobe's own `KeyframeEase` example supplies three ease objects for Scale, and the Property guide states that `scale.setValue([50, 50])` is equivalent to `scale.setValue([50, 50, 100])` because the omitted third component defaults to 100.

A protocol-1.8 diagnostic real-AE run on After Effects 25.6.6 confirmed that exact edge: a 2D layer fixture whose Scale keys were supplied as two-value arrays exposed **three** incoming and **three** outgoing `KeyframeEase` objects at the live key. That diagnostic run is not acceptance evidence, but it is authoritative implementation evidence about host cardinality. Protocol 1.8 therefore does **not** infer ease cardinality from `PropertyValueType`; it reads both `keyInTemporalEase(keyIndex)` and `keyOutTemporalEase(keyIndex)`, requires their lengths to agree in the supported 1..3 range, and validates writes against that live host cardinality.

## Accepted P1/P2 evidence

Production-equivalent real-AE run `34176061647` is the accepted protocol-1.8 P1/P2 proof. It ran from feature source commit `718fd72dd9b07c3605163354cf7ce7be26ef8f23` through control commit `033e4e2f005a175f48fefaca1912dc54716d7eb4`, job `101905568438`, with retained artifact `10037290595` and GitHub artifact SHA-256 `b1046dfe32b1b1c73a3acd65e5d5b3deb90fef50e01170ed3b8e8e04d4e2439b`.

The accepted artifact reports `PASS`, all 44 checks true, exact blank-project fingerprint restoration, scalar Opacity cardinality one, and exact Scale cardinality three. The accepted run used normal CEP host bootstrap without direct v1.8 host-loader preload. Full evidence details are retained in `proofs/diagnostics/m3-temporal-ease-p1-p2-run2-acceptance.md`.

This accepted evidence promotes both protocol-1.8 capabilities to **STRUCTURAL** maturity while leaving status **PARTIAL**.

## Deliberate preconditions

A protocol-1.8 mutation fails closed unless:

1. the target composition, layer, property path, and key index resolve exactly;
2. the property exposes temporal-ease read/write methods;
3. incoming and outgoing interpolation are already `BEZIER`;
4. `temporalAutoBezier` is already `false`;
5. incoming and outgoing host ease arrays report the same supported live cardinality;
6. `inEase` and `outEase` contain exactly that live cardinality;
7. every speed is finite;
8. every influence is finite and within `0.1..100.0`;
9. `expectedHostProjectRevision` matches the current project revision.

These preconditions keep protocol ownership explicit: callers use accepted protocol 1.7 when interpolation state must change, then protocol 1.8 for numeric Graph Editor handles.

## Scope exclusions

This tranche does **not** claim:

- Milestone 3 item 11 spatial Bezier paths/tangents;
- `setSpatialTangentsAtKey`, spatial continuity/auto-Bezier, or roving keyframes;
- new hold/roving/ease-variant helpers beyond the already accepted temporal interpolation state;
- Milestone 3 item 12 markers, motion blur, frame blending, or shutter controls;
- arbitrary code execution or generic ExtendScript evaluation.

## Remaining real-AE proof before full promotion

Protocol 1.8 follows the same evidence meanings already used by accepted M3 tranches; P1/P2 are now accepted and P3–P5 remain outstanding:

- **P1 — deterministic validation/rejection: ACCEPTED.** Bad key/path/cardinality/range/precondition/stale-revision requests reject before mutation and preserve revision/fingerprint truth.
- **P2 — exact structural readback: ACCEPTED.** Exact incoming/outgoing speed/influence is proven on scalar Opacity and the live three-handle Scale surface, including exact no-op behavior.
- **P3 — viewer-visible proof: OUTSTANDING.** Apply deliberately asymmetric numeric ease to real animation and prove sampled/rendered behavior differs from an appropriate baseline while key values and key times remain unchanged.
- **P4 — induced-failure rollback: OUTSTANDING.** Force a post-mutation verification failure inside the transaction boundary and prove the original ease arrays and project state are restored.
- **P5 — save/reopen/reconnect transfer: OUTSTANDING.** Prove persistence and reproduce the capability in a materially different property/context and fresh session, accepting transfer only when correlation, structural truth, and viewer-visible behavior all pass.

Until P3–P5 are accepted, `ae.property.temporal_ease.set` and `ae.property.temporal_ease.readback` remain **PARTIAL / STRUCTURAL**.
