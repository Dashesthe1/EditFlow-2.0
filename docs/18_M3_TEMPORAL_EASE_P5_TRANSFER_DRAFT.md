# M3 temporal-ease P5 transfer draft — protocol 1.8

Status: **DRAFT / NOT ACCEPTANCE EVIDENCE**.

This tranche prepares the save/reopen/reconnect transfer proof for protocol 1.8 without running ahead of the evidence ladder. It must not be executed or used to promote `ae.property.temporal_ease.set` or `ae.property.temporal_ease.readback` until retained P1-P4 evidence has been independently accepted.

## Dependency gate

The real-AE P5 wrapper requires the committed file:

`proofs/diagnostics/m3-temporal-ease-p1-p4-acceptance.json`

The CLI refuses the record unless it identifies protocol `1.8.0`, declares `accepted: true`, and truthfully binds:

- P1 deterministic validation/rejection;
- P2 exact structural readback;
- P3 independently reviewed viewer-visible proof;
- P4 induced-failure rollback.

The exact acceptance-record bytes are SHA-256 bound into the P5 result. The gate file is intentionally absent while P1/P2 is still awaiting real-AE execution and P3/P4 remains a dependent draft.

## Why this transfer fixture is materially different

The saved side uses the Transform **Opacity** property:

- three keys at `0`, `0.5`, and `1` seconds;
- protocol 1.7 establishes explicit manual BEZIER state (`temporalContinuous=false`, `temporalAutoBezier=false`);
- protocol 1.8 writes one incoming and one outgoing `KeyframeEase` object at the middle key;
- the exact scalar ease is read back, then the project is saved.

After the fixed project is closed/reopened and the additive protocol-1.8 host loader is re-evaluated, the loopback broker is stopped/restarted. The proof requires a different authenticated CEP `sessionId` and then re-reads the exact persisted Opacity ease before making any new mutation.

Fresh-session authority is deliberately transferred to **Scale**, not repeated on Opacity. The proof creates three 2D Scale keys, establishes the same explicit protocol-1.7 manual-BEZIER precondition, and uses protocol 1.8 to write/read two incoming and two outgoing `KeyframeEase` objects. This changes both the property semantics and live ease cardinality from one component to two.

## Exact states

Saved scalar Opacity ease:

```json
{
  "inEase": [{ "speed": 37.5, "influence": 26.25 }],
  "outEase": [{ "speed": 142.75, "influence": 73.5 }]
}
```

Fresh-session 2D Scale ease:

```json
{
  "inEase": [
    { "speed": 18.25, "influence": 32.5 },
    { "speed": 41.5, "influence": 47.25 }
  ],
  "outEase": [
    { "speed": 95.75, "influence": 69.5 },
    { "speed": 63.25, "influence": 54.75 }
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
8. compare the reopened structural fingerprint to the saved fingerprint before any post-reconnect mutation.

## Proof-only cleanup

Cleanup refuses to discard a project unless all of the following are exact:

- the project is the fixed saved P5 artifact;
- exactly two compositions exist and share one proof-generation prefix;
- the source composition is empty;
- the target has exactly one proof-owned AV layer sourced from the source composition;
- Opacity has exactly three keys, exact middle key identity, manual-BEZIER flags, and the exact saved scalar ease;
- Scale has exactly three keys, exact middle key identity, manual-BEZIER flags, and the exact two-component transferred ease.

Only after those checks does cleanup close the project without saving and create a blank project. The saved `.aep` remains retained evidence, and the Node harness re-observes the original blank project fingerprint.

## Retry policy

The self-hosted runner permits at most one retry, and only for `CEP_PANEL_REGISTRATION_TIMEOUT` before any protocol response, baseline observation, mutation, or saved `.aep` exists. A retry is refused unless After Effects has returned to a verified zero-process baseline. All other failures are retained and surfaced.

## External API basis

Consulted September 7, 2026:

- After Effects Scripting Guide — `KeyframeEase`: https://ae-scripting.docsforadobe.dev/other/keyframeease/
  - `speed` is floating point;
  - `influence` is `0.1..100.0`;
  - `setTemporalEaseAtKey` uses one ease object for most value types and one per component for 2D/3D temporal values.
- After Effects Scripting Guide — `Property`: https://ae-scripting.docsforadobe.dev/property/property/
  - `keyInTemporalEase`, `keyOutTemporalEase`, and `setTemporalEaseAtKey` are the structural source of truth;
  - temporal continuity and auto-Bezier are separate interpolation state.
- Adobe After Effects Help — speed graph / Keyframe Velocity controls: https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/speed-between-keyframes/speed.html
  - incoming/outgoing velocity and influence can be controlled separately;
  - Continuous locks incoming/outgoing velocity together, so this independent-handle proof explicitly uses `temporalContinuous=false` through accepted protocol 1.7.
- After Effects Scripting Guide — Project/Application: https://ae-scripting.docsforadobe.dev/general/project/ and https://ae-scripting.docsforadobe.dev/general/application/
  - `Project.save(file)`, `Project.close(CloseOptions.DO_NOT_SAVE_CHANGES)`, and `app.open(file)` are the fixed persistence primitives used by the proof.

These sources guide the implementation; they are not evidence that protocol 1.8 has passed real-AE transfer.

## Files in this draft

- `apps/desktop-host/src/m3-temporal-ease-p5-cli.ts`
- `scripts/windows/m3-temporal-ease-p5-reopen.jsx`
- `scripts/windows/m3-temporal-ease-p5-cleanup.jsx`
- `scripts/windows/run-m3-temporal-ease-p5.ps1`
- `scripts/windows/run-m3-temporal-ease-p5-self-hosted.ps1`
- `.github/workflows/m3-temporal-ease-real-ae-p5.yml`
- `tests/m3-temporal-ease-p5-contract.test.mjs`

The real-AE workflow is isolated to `ae-test/m3-temporal-ease-p5-control` and a dedicated trigger file. No trigger is created by this draft.
