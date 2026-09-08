# M3 temporal-ease P5 real-AE acceptance — attempt 4

- Feature PR: #124 (`chatgpt/m3-temporal-ease-p5-draft`)
- Accepted `main` prerequisite: `72c8dda399ac04528f73f8cb1113af7053b9cbdb`
- Exact P5 feature source used by the control proof: `2fac69c519abe9b960ffe517f744b5e824f84253`
- Control/trigger commit: `277e63ef585f9266cf52574111ea90536d447f14`
- Latest code-level CI before AE launch: run `34179859182` / success (schema validation, typecheck, full test suite; docs-only follow-up did not alter executable proof code)
- GitHub Actions real-AE run: `34179909375` / success
- Real-AE job: `101916716590`
- Retained artifact: `m3-temporal-ease-p5-proof-34179909375`, artifact id `10038543576`
- GitHub artifact digest: `sha256:826c3ace4d8aed717c979037e648406cc36f7174a8b64c2c80008d213d39d0f8`
- Host: Adobe After Effects `25.6.6x4`, build `4`, self-hosted Windows runner `editflow-ae`
- Extension: `com.editflow2.bridge.panel`, version `0.1.0-dev.8`

## Prerequisite binding

The P5 result SHA-256 binds the committed machine-readable P1-P4 acceptance record as:

- proof id: `M3_TEMPORAL_EASE_P1_P4_ACCEPTANCE`
- protocol: `1.8.0`
- accepted: `true`
- retained P1-P4 record SHA-256: `d898f669ac16efed9668fff8058f7445f44fb1c3fed5122e405fa1e0776558ab`
- accepted P1/P2 workflow run: `34176061647`
- accepted P3/P4 workflow run: `34176960701`
- accepted P3/P4 artifact digest: `sha256:e12076fce752dc2eac4b23939d40d2fd839a1d44095ce0aaad3ee4b51fd15903`

P5 therefore did not bypass or substitute for the accepted P1 validation, P2 structural readback, independently reviewed P3 visual proof, or P4 rollback evidence.

## Real-AE lifecycle result

The retained `result.json` reports:

- `proofId: M3_TEMPORAL_EASE_P5_REAL_AE`
- `protocolVersion: 1.8.0`
- `status: PASS`
- `ok: true`
- `P5_save_reopen_reconnect_transfer: true`
- `cleanupComplete: true`
- `cleanupErrors: []`
- `failureError: null`

Every required check is true, including:

- blank runner-owned baseline;
- exact pre-save scalar Opacity ease;
- public `project.save` applied and produced a non-empty `.aep`;
- saved project path and two-item fixture read back exactly;
- fixed-project close/reopen script passed and reloaded the protocol-1.8 dispatcher;
- a distinct authenticated protocol-1.8 CEP session connected after reopen;
- saved structural fingerprint was preserved across reopen;
- exact persisted Opacity ease was recovered before any fresh-session mutation;
- live Scale temporal-ease cardinality was probed and returned `3`;
- three-component Scale `KeyframeEase` mutation applied and exact protocol readback passed;
- proof-only cleanup verified the fixture, retained the saved `.aep`, returned AE to a blank unsaved project, and restored the exact original blank fingerprint.

## Reconnect evidence

Initial authenticated CEP session:

`a5bbe0ce-3d85-4799-afb9-cc24e1d32f8e`

Reconnected authenticated CEP session after AE project reopen and broker restart:

`98066edc-8908-4778-a3cb-f4362ec8e43b`

Both negotiated protocol `1.8.0` and advertised `1.8.0`, `1.7.0`, and `1.1.0`. The session IDs are distinct, so the transfer proof did not reuse the original panel session.

## Persistence and structural evidence

Original blank project fingerprint:

`project:sha256:0a1f2ab2a77b28d4a483592a7e59b2f1614ce3012a85ef680a97ffbbd9b10440`

Saved two-item fixture fingerprint:

`project:sha256:38063762c3cb6d1fb8701c0b91bda1efdb8a82b9fe156826a6fc19a9ab8c4d39`

The reopened project preserved that saved structural fingerprint before the post-reconnect Scale mutation. After proof-only cleanup, the observed project returned to the exact original blank fingerprint and item count zero.

The retained `.aep` is 110,763 bytes and remains available in the artifact after cleanup.

## Persisted scalar Opacity state

The saved middle Opacity key remains under explicit manual-BEZIER temporal interpolation:

```json
{
  "inType": "BEZIER",
  "outType": "BEZIER",
  "temporalContinuous": false,
  "temporalAutoBezier": false
}
```

The exact protocol-1.8 ease state written before save and recovered after reopen/reconnect is:

```json
{
  "inEase": [{ "speed": 37.5, "influence": 26.25 }],
  "outEase": [{ "speed": 142.75, "influence": 73.5 }]
}
```

The post-reconnect readback was `NO_OP` and passed the exact state/cardinality/key-identity checks before any new mutation was permitted.

## Fresh-session Scale transfer

The live `ADBE Scale` property was first read through protocol 1.8 and had to report temporal-ease cardinality `3` at key index 2 / time `0.5`. Only after that read-only gate passed did the proof write:

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

The set response was `APPLIED`, and the subsequent exact readback was `NO_OP` with cardinality 3 and exact key identity.

Proof-only cleanup independently observed AE's canonical middle Scale value as:

```json
[140, 80, 100]
```

This is intentionally treated separately from temporal-ease cardinality. Adobe's scripting documentation states that two-value Scale input such as `[50, 50]` is equivalent to `[50, 50, 100]`, while temporal-ease arrays for a live `ThreeD` quantitative property require three `KeyframeEase` objects. The retained real-AE behavior matches that distinction.

## Retained evidence hashes

- `result.json`: `354601baacf1276bb9448f59f2c35bbf2af9e1bde5d2f8d36fe560486c667a02`
- `reopen-result.json`: `3cde2b67b3605054ce9fe999946aaf72149e9abaa1f1793350183e1d2457a71b`
- `cleanup-result.json`: `6a829ecea240faf11b6d69cdc3fd5178e14d0d01084797843c75960726228910`
- `m3-temporal-ease-p5-transfer.aep`: `6ec98dc3949d2846653e5ecb5a0191165fc14f11c1a5cb05a471adac754ada42`
- `panel-bootstrap.log`: `798b842070ec376f48ffa13b965fe2fae05eecfb1ab774650418013581bbf51e`
- `startup-diagnostics.log`: `1ef4f48ff20f6d49bac9364b38e385a20cd3abec3afea9535bfe93eaadf07da5`

An independent local screen of the downloaded artifact re-parsed all records, required every P5 gate above, required distinct session IDs, required the canonical Scale middle value `[140,80,100]`, required clean rollback/cleanup state, required the saved `.aep` to be non-empty, and returned `independent_checks=PASS`.

## External semantic cross-check

Current After Effects scripting documentation independently supports the host behavior used by this proof:

- Property API and Scale/value examples: https://ae-scripting.docsforadobe.dev/property/property/
- `KeyframeEase`: https://ae-scripting.docsforadobe.dev/other/keyframeease/
- Project lifecycle: https://ae-scripting.docsforadobe.dev/general/project/ and https://ae-scripting.docsforadobe.dev/general/application/

The retained real-AE records, not the documentation, remain the acceptance authority.

## Acceptance

**P5 save/reopen/reconnect transfer is accepted for protocol 1.8 within the exercised evidence envelope.** The exact scalar Opacity ease survives a real project save and reopen, survives a distinct authenticated CEP reconnect, and can be followed by a materially different fresh-session three-component Scale ease mutation/readback. The saved project is retained and proof-only cleanup returns the runner to the exact original blank structural state.

This acceptance does **not** claim full Graph Editor human parity. Spatial tangents/motion paths, roving keys, value-graph editing, arbitrary effect-property ease, marker controls, motion blur/frame blending, shutter controls, or visual proof for every multidimensional property remain separate capability tranches and must keep their own proof ladders.
