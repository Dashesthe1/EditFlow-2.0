# M3 temporal-interpolation P5 real-AE transfer acceptance — run 1

- Feature PR: #120 (`feature/m3-temporal-interpolation-foundation`)
- Accepted base on `main`: `051659452bf7d907b395fe7bc843abc9251358a3`
- Exact CI-green source commit under proof: `9d7533cd5c3a3964ffd8ce82cd17cd6c718d43f9`
- Real-AE control/trigger commit: `fa6e7f9e07fef32b5bf79ec4a3c1fcdbddac4f57`
- P5 real-AE run: `34167719180` / success
- P5 real-AE job: `101881984709`
- Uploaded artifact: `m3-temporal-interpolation-p5-proof-34167719180` / artifact id `10034708844`
- Artifact ZIP digest: `sha256:463fd32231e5689b8f8f2a1827470310e9ccdaaf83a006ba8c492677b4128132`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`

## Prior accepted evidence

P1/P2:

- source `9b660195c265f35fff79616b1ae345c01aeaec78`
- control `bfa22a7f6f7254325899e6b3d3b07d14b2fdadd7`
- run `34163522485`
- job `101869972996`
- artifact `10033403065`
- artifact digest `sha256:a029092ae5a0b0a3f492abd3c71276816081d36b2b7e00e3ccc08a5537406977`

P3/P4:

- source `6b218bf3f6ba0014a6a78fa33769f170dc300fa3`
- control `5cb3e7bd9fd1fc5cf0d6ff5c17ff7946566c9e45`
- run `34166441340`
- job `101878333951`
- artifact `10034335983`
- artifact digest `sha256:f66aeb095e28e14d736689a038045f306d5324803c8c49bd29177220ec38ae6a`
- independent acceptance record `proofs/diagnostics/m3-temporal-interpolation-p3-p4-run9-acceptance.md`

P1-P4 were accepted baseline and were deliberately not replayed inside P5.

## P5 retained result

The retained `result.json` reports:

- `proofId: M3_TEMPORAL_INTERPOLATION_P5_REAL_AE`
- `protocolVersion: 1.7.0`
- `status: ACCEPTED`
- `ok: true`
- `P5_save_reopen_reconnect_transfer: true`
- `cleanupComplete: true`
- `cleanupErrors: []`
- `failureError: null`

Every bounded P5 check is true:

- proof scripts and AfterFX executable present;
- initial panel negotiated protocol 1.7 and retained 1.1 compatibility;
- real-AE host probe passed;
- proof began from the exact blank unsaved project baseline;
- source/target fixture compositions created;
- the accepted temporal-interpolation surface was supported;
- the distinctive pre-save temporal state applied and read back exactly;
- the exact fixed fixture shape existed before save;
- public project save applied;
- non-empty saved `.aep` was retained;
- saved path and fixture shape read back exactly;
- fixed proof-owned reopen script passed;
- a distinct authenticated CEP reconnect occurred;
- post-reconnect real-AE host probe passed;
- reopened project path, item count, stable fixture, and saved structural fingerprint were preserved;
- the exact temporal state survived save/reopen/reconnect;
- a fresh post-reconnect mutation applied;
- that mutation read back exactly;
- fixed proof-owned cleanup passed;
- saved `.aep` remained retained as evidence;
- cleanup returned to the exact blank unsaved project baseline and fingerprint.

## Transfer fixture

The proof created a fixed two-composition fixture with one target AV layer and three Opacity keys. The transfer target was key index `2` at `0.5 s` on:

`ADBE Transform Group -> ADBE Opacity`

Pre-save temporal state:

- incoming `BEZIER`
- outgoing `BEZIER`
- `temporalContinuous: true`
- `temporalAutoBezier: true`

Post-reconnect fresh mutation:

- incoming `HOLD`
- outgoing `LINEAR`
- `temporalContinuous: false`
- `temporalAutoBezier: false`

This asymmetry matters: P5 does not merely prove the saved project can reopen. It proves that the exact flag-bearing pre-save state persists across transfer and that the new authenticated session has fresh exact protocol-1.7 mutation/readback authority.

## Distinct authenticated sessions

Initial session:

- ID `9028e46a-94b8-49e8-bd43-c4543d452be2`
- registered `2026-09-07T22:45:49.784Z`
- protocol `1.7.0`
- supported proof protocols `1.7.0`, `1.1.0`
- extension `com.editflow2.bridge.panel`
- extension version `0.1.0-dev.7`

Reconnected session:

- ID `1e94494b-514f-43c0-90e9-66215c78e9e4`
- registered `2026-09-07T22:45:58.669Z`
- protocol `1.7.0`
- supported proof protocols `1.7.0`, `1.1.0`
- same extension and extension version.

The session IDs are distinct. Broker stop/start plus a fresh panel registration therefore proves reconnect rather than reuse of the original authenticated session.

## Structural transfer and cleanup

Baseline:

- fingerprint `project:sha256:0a1f2ab2a77b28d4a483592a7e59b2f1614ce3012a85ef680a97ffbbd9b10440`
- item count `0`
- file path `null`

Saved fixture:

- fingerprint `project:sha256:ef02d04370c460fbda10d1b15d00e5574ef29488d71389f03d789c10edddb5da`
- item count `2`
- non-empty runner-owned `.aep` retained in the uploaded proof package.

After reopen/reconnect, the saved path, item count, stable fixture topology, structural fingerprint, and exact temporal state all matched the saved state before the fresh post-reconnect mutation.

Cleanup was proof-gated and exact-fixture-only. It validated the fixed saved proof project and expected final temporal state, closed it with `CloseOptions.DO_NOT_SAVE_CHANGES`, created a new project, retained the saved `.aep` artifact, and the harness re-observed the exact original blank fingerprint/item-count/null-path baseline.

## Retry posture

A prior diagnostic P5 run (`34167279455`) timed out before the first authenticated CEP registration. It had no session, no observed baseline, no dispatched command, no mutation, and no saved `.aep`. The harness was hardened with one bounded retry allowed only for that exact zero-mutation/zero-save/zero-AfterFX timeout envelope.

The accepted run `34167719180` did **not** use that retry. Initial panel registration succeeded on the first isolated AE launch, so retry logic is resilience machinery and is not necessary to establish the accepted P5 transfer result.

## Retained evidence hashes

- artifact ZIP: `463fd32231e5689b8f8f2a1827470310e9ccdaaf83a006ba8c492677b4128132`
- `result.json`: `9bd22d316d53c55cafe44c3579dfa6fcf36e159929bd5d2c1283068ccc686c4c`
- `reopen-result.json`: `2791b3d298a647e63df1d9e2b8888ba6eedd925ca29997d2c1bffb49adf67896`
- `cleanup-result.json`: `682e4a41fe182906dec5d9c5492c2f182cc6898be1eda66f16eed88ebea23540`
- saved `m3-temporal-interpolation-p5-transfer.aep`: `89f82ceca67b48966f2bd0f01692f322a6d61e1094be2c2cee2b5c20ba372fad`
- `panel-bootstrap.log`: `35fda1a889c8d70f51417385fab5f1dc6731e9534494e21cd5fd1faa7f89e2ab`
- `startup-diagnostics.log`: `5a6ad9937c9774e27dd6810dce0c5b6656805aa13d54b4e2bc37f90b1061296d`

## Acceptance

**P5 is accepted for the exercised protocol-1.7 temporal-interpolation envelope.** The exact saved temporal state survives save/reopen into a distinct authenticated CEP session, and that fresh session retains exact mutation and readback authority.

Together with the accepted P1/P2 and P3/P4 evidence, this completes P1-P5 for Milestone 3 item 9. The two protocol-1.7 capabilities may therefore be promoted to **`FULL / TRANSFER`**.

This acceptance is deliberately bounded. It does not claim Graph Editor numeric speed/influence (`KeyframeEase`), spatial interpolation/tangents/roving, or markers/motion-blur/frame-blending/rendering controls. Those remain later Human-Parity roadmap tranches.
