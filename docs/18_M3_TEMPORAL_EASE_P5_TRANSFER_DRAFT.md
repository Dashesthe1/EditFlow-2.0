# M3 temporal-ease P5 transfer draft — protocol 1.8

Status: **DRAFT / NOT ACCEPTANCE EVIDENCE**.

This tranche prepares the save/reopen/reconnect transfer proof for protocol 1.8 without running ahead of the evidence ladder. It must not be used to promote `ae.property.temporal_ease.set` or `ae.property.temporal_ease.readback` until the retained P5 run has been independently reviewed.

## Dependency gate

The real-AE P5 wrapper requires the committed file:

`proofs/diagnostics/m3-temporal-ease-p1-p4-acceptance.json`

The CLI refuses the record unless it identifies protocol `1.8.0`, declares `accepted: true`, and truthfully binds:

- P1 deterministic validation/rejection;
- P2 exact structural readback;
- P3 independently reviewed viewer-visible proof;
- P4 induced-failure rollback.

The exact acceptance-record bytes are SHA-256 bound into the P5 result.

## Why this transfer fixture is materially different

The saved side uses the Transform **Opacity** property:

- three keys at `0`, `0.5`, and `1` seconds;
- protocol 1.7 establishes explicit manual BEZIER state (`temporalContinuous=false`, `temporalAutoBezier=false`);
- protocol 1.8 writes one incoming and one outgoing `KeyframeEase` object at the middle key;
- the exact scalar ease is read back, then the project is saved.

After the fixed project is closed/reopened and the additive protocol-1.8 host loader is re-evaluated, the loopback broker is stopped/restarted. The proof requires a different authenticated CEP `sessionId` and then re-reads the exact persisted Opacity ease before making any new mutation.

Fresh-session authority is deliberately transferred to **Scale**, not repeated on Opacity. Real-AE attempt 2 exposed an important fixture assumption: on the actual After Effects 25.6.6 host used by this proof, the live `ADBE Scale` property reports temporal-ease cardinality `3`, even though the layer itself is not promoted to 3D. The protocol correctly rejected the former two-object request with `TEMPORAL_EASE_CARDINALITY_MISMATCH` (`expected: 3`, `actual: 2`).

That behavior is consistent with the current After Effects scripting contract. Scale is represented by a three-float quantitative property surface for scripting, and Adobe documents `[50, 50]` as equivalent to `[50, 50, 100]` for Scale. `setTemporalEaseAtKey` and `keyInTemporalEase`/`keyOutTemporalEase` use three `KeyframeEase` objects for a live `PropertyValueType.ThreeD` property.

Real-AE attempt 3 then separated two concepts that the earlier fixture had conflated:

- the **visible/non-3D Scale value** is canonicalized with a non-material Z scale of `100`;
- the **temporal-ease cardinality** of the live Scale property is still `3`.

Attempt 3 successfully passed every actual P5 lifecycle and protocol gate: save, reopen, distinct authenticated CEP reconnect, exact persisted Opacity ease, live Scale cardinality `3`, three-component Scale ease mutation, and exact protocol readback. It failed only because the proof-only cleanup expected the requested Z Scale value `115` instead of AE's canonical non-3D Z value `100`.

The proof therefore does **not** weaken EditFlow validation. It now:

1. creates the Scale key fixture;
2. establishes the accepted manual-BEZIER precondition;
3. performs a read-only protocol-1.8 cardinality probe and requires the live host to report `3` at the exact middle key;
4. only then writes three independent incoming and three independent outgoing `KeyframeEase` objects;
5. requires exact three-component protocol readback;
6. during proof-only cleanup, separately verifies AE's canonical Scale key value `[140, 80, 100]` and the exact three-component ease state.

This deliberately treats property **value representation** and temporal-ease **handle cardinality** as separate host facts rather than inferring one from the other or from the layer's 2D/3D switch.

## Exact states

Saved scalar Opacity ease:

```json
{
  "inEase": [{ "speed": 37.5, "influence": 26.25 }],
  "outEase": [{ "speed": 142.75, "influence": 73.5 }]
}
```

Fresh-session Scale values requested by the fixture:

```json
[
  { "time": 0, "value": [100, 100, 100] },
  { "time": 0.5, "value": [140, 80, 115] },
  { "time": 1, "value": [75, 135, 90] }
]
```

On the non-3D AVLayer used by the proof, AE canonicalizes the middle Scale key exposed by `keyValue(2)` to:

```json
[140, 80, 100]
```

The cleanup gate records this canonical value before validating it. The Z value is not treated as a visible third layer dimension; it is the documented default Scale component used by AE's scripting representation.

Fresh-session Scale ease after the live cardinality-3 probe:

```json
{
  "inEase": [
    { "speed": 18.25, "influence": 32.5 },
    { "speed": 41.5, "influence": 47.25 },
    { "speed": 72.25, "influence": 58.75 }
  ],
  "outEase": [
    { "speed": 95.75, "influence": 69.5 },
    { "speed": 63.25, "influence": 54.75 },
    { "speed": 128.5, "influence": 61.25 }
  ]
}
```

## Save/reopen/reconnect boundary

The proof reuses the already accepted project lifecycle rather than introducing a new persistence mechanism:

1. save through the public v1.1 `project.save` capability into the runner-owned artifact directory;
2. require the open project path to equal that fixed proof path;
3. close with `CloseOptions.DO_NOT_SAVE_CHANGES`;
4. reopen the fixed `.aep` with `app.open(file)`;
5. clear the process-global dispatcher and evaluate `editflow_host_current_v18.jsx`;
6. stop/restart the loopback broker;
7. require a distinct authenticated protocol-1.8 panel session;
8. compare the reopened structural fingerprint to the saved fingerprint before any post-reconnect mutation;
9. read back the exact saved scalar Opacity ease;
10. probe the live Scale temporal-ease cardinality, then exercise the fresh-session transfer against that exact host surface.

## Proof-only cleanup

Cleanup refuses to discard a project unless all of the following are exact:

- the project is the fixed saved P5 artifact;
- exactly two compositions exist and share one proof-generation prefix;
- the source composition is empty;
- the target has exactly one proof-owned AV layer sourced from the source composition;
- Opacity has exactly three keys, exact middle key identity, manual-BEZIER flags, and the exact saved scalar ease;
- Scale has exactly three keys with canonical middle value `[140, 80, 100]`, manual-BEZIER flags, and the exact three-component transferred ease.

Only after those checks does cleanup close the project without saving and create a blank project. The saved `.aep` remains retained evidence, and the Node harness re-observes the original blank project fingerprint.

## Retry policy

The self-hosted runner permits at most one retry, and only for `CEP_PANEL_REGISTRATION_TIMEOUT` before any protocol response, baseline observation, mutation, or saved `.aep` exists. A retry is refused unless After Effects has returned to a verified zero-process baseline. All other failures are retained and surfaced.

## External API basis

Consulted September 7, 2026 and rechecked against real-AE attempts 2 and 3:

- After Effects Scripting Guide — `Property`: https://ae-scripting.docsforadobe.dev/property/property/
  - the guide's Scale example explicitly states `[50, 50]` is equivalent to `[50, 50, 100]`;
  - the same property API defines the live temporal-ease array cardinality, and `keyInTemporalEase`, `keyOutTemporalEase`, and `setTemporalEaseAtKey` use three `KeyframeEase` objects for `PropertyValueType.ThreeD`, two for `TwoD`, and one for other value types;
  - temporal continuity and auto-Bezier are separate interpolation state.
- After Effects Scripting Guide — `KeyframeEase`: https://ae-scripting.docsforadobe.dev/other/keyframeease/
  - `speed` is floating point;
  - `influence` is `0.1..100.0`.
- Adobe After Effects Help — speed graph / Keyframe Velocity controls: https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/speed-between-keyframes/speed.html
  - incoming/outgoing velocity and influence can be controlled separately;
  - Continuous locks incoming/outgoing velocity together, so this independent-handle proof explicitly uses `temporalContinuous=false` through accepted protocol 1.7.
- After Effects Scripting Guide — Project/Application: https://ae-scripting.docsforadobe.dev/general/project/ and https://ae-scripting.docsforadobe.dev/general/application/
  - `Project.save(file)`, `Project.close(CloseOptions.DO_NOT_SAVE_CHANGES)`, and `app.open(file)` are the fixed persistence primitives used by the proof.

These sources guide the implementation; they are not evidence that protocol 1.8 has passed real-AE transfer. The retained AE run remains the acceptance authority.

## Files in this draft

- `apps/desktop-host/src/m3-temporal-ease-p5-cli.ts`
- `scripts/windows/m3-temporal-ease-p5-reopen.jsx`
- `scripts/windows/m3-temporal-ease-p5-cleanup.jsx`
- `scripts/windows/run-m3-temporal-ease-p5.ps1`
- `scripts/windows/run-m3-temporal-ease-p5-self-hosted.ps1`
- `.github/workflows/m3-temporal-ease-real-ae-p5.yml`
- `tests/m3-temporal-ease-p5-contract.test.mjs`

The real-AE workflow is isolated to `ae-test/m3-temporal-ease-p5-control` and a dedicated trigger file.
