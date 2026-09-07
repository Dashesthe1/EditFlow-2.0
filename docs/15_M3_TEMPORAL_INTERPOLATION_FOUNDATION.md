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

The contract was cross-checked against the After Effects scripting documentation:

- `Property.setInterpolationTypeAtKey(keyIndex, inType[, outType])` sets incoming/outgoing interpolation and accepts `LINEAR`, `BEZIER`, or `HOLD`: https://ae-scripting.docsforadobe.dev/property/property/#propertysetinterpolationtypeatkey
- `Property.isInterpolationTypeValid(type)` reports whether the target property supports a requested interpolation type: https://ae-scripting.docsforadobe.dev/property/property/#propertyisinterpolationtypevalid
- `Property.keyInInterpolationType()` / `keyOutInterpolationType()` provide direct structural readback of the two interpolation directions: https://ae-scripting.docsforadobe.dev/property/property/
- `Property.keyTemporalAutoBezier()` and `keyTemporalContinuous()` are effective only when both keyframe directions use Bezier interpolation: https://ae-scripting.docsforadobe.dev/property/property/#propertykeytemporalautobezier
- `Property.setTemporalContinuousAtKey()` and `setTemporalAutoBezierAtKey()` expose the corresponding per-key temporal flags: https://ae-scripting.docsforadobe.dev/property/property/
- `KeyframeEase` and `setTemporalEaseAtKey()` expose speed/influence and are intentionally deferred to the next Graph Editor tranche: https://ae-scripting.docsforadobe.dev/other/keyframeease/

The self-hosted panel path also follows the established CEP production bootstrap: protocol 1.7 is loaded additively, the broker negotiates the highest mutually supported protocol, and the accepted real-AE proofs do not substitute a proof-only direct dispatcher for the production-equivalent authenticated panel path.

## Accepted real-AE P1/P2 evidence

Accepted provenance:

- source commit: `9b660195c265f35fff79616b1ae345c01aeaec78`;
- control commit: `bfa22a7f6f7254325899e6b3d3b07d14b2fdadd7`;
- GitHub Actions run: `34163522485`;
- self-hosted job: `101869972996`;
- proof artifact: `10033403065`;
- artifact ZIP SHA-256: `a029092ae5a0b0a3f492abd3c71276816081d36b2b7e00e3ccc08a5537406977`.

P1/P2 proved authenticated protocol-1.7 negotiation, deterministic non-mutating validation rejection, exact `LINEAR` / `BEZIER` / `HOLD` support/readback, independent incoming/outgoing interpolation, exact continuity/auto-Bezier flags, stale-revision rejection, exact no-op behavior, stable key identity, and exact disposable-fixture cleanup.

The historical P1/P2 maturity remains queryable as `PARTIAL / STRUCTURAL`; it is not used to overstate what was known before the later proof levels were completed.

## Accepted real-AE P3/P4 evidence

Accepted provenance:

- source commit: `6b218bf3f6ba0014a6a78fa33769f170dc300fa3`;
- control commit: `5cb3e7bd9fd1fc5cf0d6ff5c17ff7946566c9e45`;
- GitHub Actions run: `34166441340`;
- self-hosted job: `101878333951`;
- proof artifact: `10034335983`;
- artifact ZIP SHA-256: `f66aeb095e28e14d736689a038045f306d5324803c8c49bd29177220ec38ae6a`;
- independent acceptance record: `proofs/diagnostics/m3-temporal-interpolation-p3-p4-run9-acceptance.md`.

P3 independently reviewed retained pixels from deterministic warm/cool source fixtures. LINEAR produced the expected blended states; incoming-HOLD and outgoing-HOLD produced the correct directional viewer-visible behavior. Restoring LINEAR returned a decoded pixel stream identical to the original LINEAR render.

P4 injected a proof-gated failure only after a real temporal-interpolation mutation had applied. The normal AE Undo transaction boundary restored exact temporal state, structural fingerprint, and project item count, and the post-rollback render was decoded-pixel-identical to the original LINEAR result.

Asynchronous render history created a known generic 60-Undo cleanup barrier after the core proof. The accepted cleanup did not pretend Undo had crossed that barrier: it validated exact proof ownership, discarded only the disposable unsaved proof project with `CloseOptions.DO_NOT_SAVE_CHANGES`, created a fresh project, and independently verified the exact pre-proof blank unsaved fingerprint.

## Accepted real-AE P5 transfer evidence

Accepted provenance:

- accepted source commit: `9d7533cd5c3a3964ffd8ce82cd17cd6c718d43f9`;
- control trigger commit: `fa6e7f9e07fef32b5bf79ec4a3c1fcdbddac4f57`;
- GitHub Actions run: `34167719180`;
- self-hosted job: `101881984709`;
- proof artifact: `10034708844`;
- artifact ZIP SHA-256: `463fd32231e5689b8f8f2a1827470310e9ccdaaf83a006ba8c492677b4128132`;
- host: Adobe After Effects `25.6.6x4`, build `4`, on the isolated Windows `editflow-ae` runner.

The accepted P5 run required no retry. It established the initial authenticated CEP session directly and completed the full lifecycle:

1. start from the exact blank unsaved baseline;
2. create the fixed two-composition, one-layer, three-key Opacity fixture;
3. set and exactly read the middle key as incoming `BEZIER`, outgoing `BEZIER`, `temporalContinuous=true`, `temporalAutoBezier=true`;
4. save a non-empty runner-owned `.aep` through the public project-save capability;
5. verify the saved path, item count, stable fixture, and structural fingerprint;
6. close/reopen only the fixed saved proof project and reload the additive protocol-1.7 dispatcher;
7. stop/restart the loopback broker and require a distinct authenticated CEP session;
8. prove the saved structural fingerprint and exact temporal state survived save/reopen/reconnect;
9. from the fresh session, mutate the same key to incoming `HOLD`, outgoing `LINEAR`, with both temporal flags false, and verify exact readback;
10. retain the saved `.aep` as evidence;
11. proof-gated cleanup discards only the exact verified disposable project, creates a blank unsaved project, and restores the exact original baseline fingerprint.

Initial session:

- session ID: `9028e46a-94b8-49e8-bd43-c4543d452be2`;
- registered: `2026-09-07T22:45:49.784Z`;
- negotiated protocol: `1.7.0`.

Reconnected session:

- session ID: `1e94494b-514f-43c0-90e9-66215c78e9e4`;
- registered: `2026-09-07T22:45:58.669Z`;
- negotiated protocol: `1.7.0`.

The session IDs are distinct. The retained result reports `status: ACCEPTED`, `ok: true`, `P5_save_reopen_reconnect_transfer: true`, every bounded proof check true, `cleanupComplete: true`, `cleanupErrors: []`, and `failureError: null`.

The accepted saved-project artifact has SHA-256 `89f82ceca67b48966f2bd0f01692f322a6d61e1094be2c2cee2b5c20ba372fad`.

## Evidence posture

**P1-P5 are accepted for the bounded protocol-1.7 item-9 envelope.** The two declared temporal-interpolation capabilities are therefore promoted to **`FULL / TRANSFER`**.

That promotion means the exact item-9 surface is now proven through validation, structural readback, viewer-visible behavior, rollback, save/reopen/reconnect persistence, and fresh-session mutation/readback authority in real After Effects.

It does **not** imply completion of item 10 Graph Editor numeric speed/influence controls, item 11 spatial Bezier paths/tangents/roving, or item 12 markers/motion-blur/frame-blending/rendering controls. Those remain separate Human-Parity tranches and must be implemented and proven independently.
