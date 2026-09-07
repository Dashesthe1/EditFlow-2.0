# M3 Exact Temporal Interpolation Foundation — Protocol 1.7

## Roadmap position

This tranche implements Milestone 3 item 9: **exact temporal interpolation**.

It deliberately does not jump ahead into the next Human-Parity Core requirements:

- item 10: Graph Editor speed/value controls, influence, velocity, and explicit `KeyframeEase` values;
- item 11: spatial Bezier paths/tangents, spatial continuity/auto-Bezier, roving, and related spatial/ease variants;
- item 12: markers, motion blur, frame blending, and composition shutter/rendering dependencies.

## Capability surface

Protocol `1.7.0` adds two typed capabilities:

- `ae.property.temporal_interpolation.set`
- `ae.property.temporal_interpolation.readback`

A target is identified by:

- caller-owned composition stable reference;
- caller-owned layer stable reference;
- a non-empty typed property path (`string | positive integer` segments);
- an existing positive keyframe index.

The mutation sets the complete bounded temporal-interpolation state together:

- incoming interpolation type: `LINEAR | BEZIER | HOLD`;
- outgoing interpolation type: `LINEAR | BEZIER | HOLD`;
- temporal continuity boolean;
- temporal auto-Bezier boolean.

Requiring all four fields prevents a caller from accidentally inheriting hidden temporal mode state from the prior key configuration.

## Host behavior

The protocol-1.7 host adapter:

- resolves the existing EditFlow composition/layer stable identity before traversing the typed property path;
- rejects missing/unresolvable property paths and out-of-range key indices before mutation;
- asks After Effects `Property.isInterpolationTypeValid()` whether the target property supports each requested interpolation type;
- rejects `temporalContinuous=true` or `temporalAutoBezier=true` unless both effective in/out types are `BEZIER`, avoiding an accepted-but-ineffective state;
- reads exact in/out types with `keyInInterpolationType()` / `keyOutInterpolationType()`;
- reads temporal continuity and auto-Bezier directly with `keyTemporalContinuous()` / `keyTemporalAutoBezier()`;
- records key time, property metadata, supported interpolation-type map, and exact state in structural readback;
- requires `expectedHostProjectRevision` for mutation and fails stale requests before writing;
- detects exact no-op requests;
- performs mutation inside an After Effects Undo group;
- applies interpolation type first, then temporal continuity, then temporal auto-Bezier;
- verifies all four requested fields immediately after the write;
- rolls back through the AE Undo boundary if mutation or readback verification fails;
- accepts no arbitrary code/script payload.

## Deliberate Graph Editor boundary

Protocol 1.7 does **not** call or expose:

- `Property.setTemporalEaseAtKey()`;
- `Property.keyInTemporalEase()` / `keyOutTemporalEase()`;
- `KeyframeEase(speed, influence)`;
- spatial tangent getters/setters;
- spatial continuity/auto-Bezier setters;
- roving setters.

Those controls change the Graph Editor's numeric speed/influence or spatial curve geometry and therefore remain separately testable Human-Parity capabilities rather than being hidden inside a generic interpolation command.

## External semantic references

The contract was cross-checked against the current After Effects scripting documentation:

- `Property.setInterpolationTypeAtKey(keyIndex, inType[, outType])` sets incoming/outgoing interpolation and accepts `LINEAR`, `BEZIER`, or `HOLD`: https://ae-scripting.docsforadobe.dev/property/property/#propertysetinterpolationtypeatkey
- `Property.isInterpolationTypeValid(type)` reports whether the target property supports a requested interpolation type: https://ae-scripting.docsforadobe.dev/property/property/#propertyisinterpolationtypevalid
- `Property.keyInInterpolationType()` / `keyOutInterpolationType()` provide direct structural readback of the two interpolation directions: https://ae-scripting.docsforadobe.dev/property/property/
- `Property.keyTemporalAutoBezier()` and `keyTemporalContinuous()` are effective only when both keyframe directions use Bezier interpolation: https://ae-scripting.docsforadobe.dev/property/property/#propertykeytemporalautobezier
- `Property.setTemporalContinuousAtKey()` and `setTemporalAutoBezierAtKey()` expose the corresponding per-key temporal flags: https://ae-scripting.docsforadobe.dev/property/property/
- `KeyframeEase` and `setTemporalEaseAtKey()` expose speed/influence and are intentionally deferred to the next Graph Editor tranche: https://ae-scripting.docsforadobe.dev/other/keyframeease/

## Evidence posture

The new capabilities begin at `PARTIAL / DECLARED`.

Contract/schema tests may validate the typed control plane, fail-closed loader, additive protocol negotiation, scope boundaries, and transaction structure, but they **must not** promote either capability to `FULL` or to structural/visual/rollback/transfer proof maturity.

The next acceptance step is a real-After-Effects P1/P2 proof that exercises validation rejection and exact structural readback on a deterministic animated property fixture. Later P3/P4/P5 evidence will be added separately rather than being inferred from unit tests.