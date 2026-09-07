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

The self-hosted panel path was also checked against Adobe CEP guidance: later JSX files may be loaded through CEP `evalScript` / `$.evalFile`, while the special `$.fileName` caveat applies to the first manifest-loaded JSX. The accepted P1/P2 run therefore uses the normal production-style CEP host bootstrap rather than a proof-only direct loader preload.

## Accepted real-AE P1/P2 evidence

Protocol 1.7 is now `PARTIAL / STRUCTURAL` on the strength of accepted real-After-Effects P1/P2 evidence. It is **not FULL**.

Accepted provenance:

- source commit: `9b660195c265f35fff79616b1ae345c01aeaec78`;
- control-branch commit: `bfa22a7f6f7254325899e6b3d3b07d14b2fdadd7`;
- GitHub Actions run: `34163522485`;
- self-hosted job: `101869972996`;
- proof artifact: `10033403065`;
- uploaded artifact ZIP SHA-256: `a029092ae5a0b0a3f492abd3c71276816081d36b2b7e00e3ccc08a5537406977`;
- host: Adobe After Effects `25.6.6` on the isolated Windows `editflow-ae` runner.

The accepted run used the normal production-equivalent panel startup path with **no direct host-loader preflight**. It proved:

- authenticated additive negotiation of protocol `1.7.0` while retaining baseline protocol `1.1.0` fixture support;
- deterministic, non-mutating rejection of an out-of-range key index;
- deterministic, non-mutating rejection of an unresolved property path;
- deterministic, non-mutating rejection of temporal continuous/auto-Bezier flags on a non-Bezier state;
- deterministic, non-mutating rejection of a stale host revision;
- target Opacity support for `LINEAR`, `BEZIER`, and `HOLD`;
- exact independent incoming/outgoing readback with `BEZIER` incoming and `LINEAR` outgoing;
- exact `BEZIER/BEZIER` temporal-continuous readback;
- exact `BEZIER/BEZIER` temporal-continuous plus auto-Bezier readback;
- exact `HOLD/HOLD` and `LINEAR/LINEAR` mutation/readback;
- exact no-op detection with unchanged host revision;
- exact key identity at key index `2`, time `0.5` seconds;
- restoration of the exact pre-proof project fingerprint and item count after disposable-fixture cleanup.

A prior diagnostic run demonstrated that the v1.7 host loader can also be preloaded directly, but that changed the startup path and was intentionally **not** used as acceptance evidence. The accepted run above is the production-style proof source.

## Evidence posture and remaining gates

The two protocol-1.7 capabilities are `PARTIAL / STRUCTURAL`.

P1/P2 are accepted. **P3/P4/P5 remain unproven**, so neither capability may be promoted to `FULL`, `VISUAL`, `ROLLBACK`, or `TRANSFER` on the basis of the current evidence.

The next acceptance gates are intentionally separate:

1. **P3 visual proof:** demonstrate viewer-observable temporal interpolation behavior on a deterministic fixture without substituting structural readback for visual evidence.
2. **P4 failure-injection rollback:** induce a failure only after a real temporal-interpolation mutation inside the normal AE Undo boundary and prove exact restoration.
3. **P5 save/reopen/reconnect transfer:** save the proven interpolation state, reopen the project, establish a fresh authenticated CEP session, and prove exact state survives transfer.

Only accepted P1-P5 evidence can justify promotion of protocol 1.7 to `FULL / TRANSFER`. Numeric Graph Editor ease/influence, spatial paths/tangents/roving, and marker/motion-blur/frame-blending controls remain later roadmap tranches and must not be inferred from item-9 success.
