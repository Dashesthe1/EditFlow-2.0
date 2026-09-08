# M3 spatial Graph Editor standard-runtime promotion acceptance — run 1

- Feature PR: #127 (`feature/m3-spatial-graph-runtime-promotion`)
- Accepted protocol-1.9 semantic baseline merge: `aa681126f8e916d151d2eae71b3fa151df1733ad`
- Exact repository-CI-green source under standard-runtime proof: `f170fdcb6ad4351cd27c7e837952e82a3209c4e7`
- Repository CI: run `34267919085`, job `102201880442` / success
- Real-AE control/trigger commit: `b23d92d68339906e55d8b87f3c984facbfdc3e4a` (parent = exact source above)
- GitHub Actions real-AE run: `34267997685`, attempt 1 / success
- Real-AE job: `102202139936`
- Uploaded artifact: `m3-spatial-graph-p5-proof-34267997685` / artifact id `10072781200`
- Artifact ZIP digest: `sha256:7ea321e60f8f9df055494c6ada069b23fc1e7752f20a83e861635081f6730286`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- CEP extension: `com.editflow2.bridge.panel` / `0.1.0-dev.8`
- Standard installer under proof: `scripts/windows/install-editflow-cep.ps1`

## Scope

This acceptance does **not** redefine the protocol-1.9 spatial Graph Editor semantics. Those semantics had already completed the independent P1–P5 ladder before this promotion. This proof answers the narrower production question:

> Can the accepted protocol-1.9 spatial Graph Editor surface be installed, negotiated, saved/reopened, reconnected, read, and mutated through the ordinary EditFlow runtime path without the proof-only v1.9 installer patch?

The answer is yes for the exercised accepted envelope.

The exact source under proof guards this condition in `scripts/windows/run-m3-spatial-graph-p5-self-hosted.ps1`: its inherited low-level lifecycle must point to `scripts\windows\install-editflow-cep.ps1`, and the proof refuses a lifecycle containing `install-editflow-cep-v19-preview.ps1`. The former preview installer is now only a compatibility verifier.

## Prior semantic evidence

The production promotion inherits, rather than replays, the accepted semantic proof lineage:

- P1/P2 run: `34182897797`
- P1/P2 artifact: `10039524832`
- P1–P4 record: `proofs/diagnostics/m3-spatial-graph-p1-p4-acceptance.json`
- P3/P4 source: `0c297200af3563d2f714d61a2df718af81cd1d4c`
- P3/P4 run: `34184591197`
- P3/P4 artifact: `10070526495`
- P3/P4 record: `proofs/diagnostics/m3-spatial-graph-p3-p4-run1-acceptance.md`
- Earlier isolated protocol-1.9 P5 run: `34264619734`

## Automated standard-runtime P5 result

The retained `result.json` reports:

- `proofId: M3_SPATIAL_GRAPH_P5_REAL_AE`
- `protocolVersion: 1.9.0`
- `status: ACCEPTED`
- `ok: true`
- `cleanupComplete: true`
- `failureError: null`
- `cleanupErrors: []`

Every bounded promotion/transfer check is true, including:

- accepted P1–P4 record present;
- proof scripts and After Effects executable present;
- initial authenticated panel negotiated protocol `1.9.0`;
- initial panel advertised protocol `1.9.0` plus safe baseline `1.1.0`;
- real After Effects host probe succeeded;
- proof began from the blank unsaved baseline;
- deterministic source/target fixture created;
- protocol-1.9 spatial readback reported supported;
- distinctive Auto-Bezier spatial state applied exactly;
- native After Effects layer identity captured before save;
- public project save produced the fixed non-empty `.aep` artifact;
- saved project path and fixture shape read back exactly;
- proof-gated reopen script succeeded;
- broker restart produced a distinct authenticated CEP session;
- reopened project path, item count, stable fixture, structural fingerprint, and native layer identity were preserved;
- exact spatial state survived save/reopen/reconnect;
- a fresh post-reconnect manual-tangent mutation applied;
- fresh post-reconnect spatial readback matched the requested mutation;
- proof cleanup succeeded, retained the saved `.aep`, and restored the original blank-project fingerprint.

## Transfer identity evidence

Initial authenticated CEP session:

- session id: `4d87cb9e-4674-4512-be35-4248a3464cc9`
- negotiated protocol: `1.9.0`
- supported protocols in the proof broker: `1.9.0`, `1.1.0`

Reconnected authenticated CEP session:

- session id: `8247b93d-f69a-4c88-9d44-b1dc97dc37e5`
- negotiated protocol: `1.9.0`
- supported protocols in the proof broker: `1.9.0`, `1.1.0`

The session IDs are distinct, so the post-reopen readback and mutation do not reuse the original authenticated broker session.

The target layer retained native After Effects `Layer.id = 25` before save and after reopen/reconnect. This independently anchors EditFlow stable fixture continuity to After Effects' own persistent layer identity.

The host-owned roving-key time retained by the saved proof was `0.49995930989583` seconds.

## Exact spatial state before save and after reconnect

The saved host-owned spatial state was:

- Auto Bezier: `true`
- Continuous: `true`
- Roving: `true`
- incoming tangent: `[-74.6666641235352, 0, 0]`
- outgoing tangent: `[74.6666641235352, 0, 0]`

The exact state, structural fingerprint, key time, stable fixture IDs, and native layer ID survived save/reopen/reconnect before any new write.

## Fresh post-reconnect authority

After transfer was established, the new authenticated protocol-1.9 session changed the same spatial Position key to:

- mode: `MANUAL`
- incoming tangent: `[-96, 132, 0]`
- outgoing tangent: `[156, -84, 0]`
- Continuous: `false`
- Roving: `false`

The fresh readback matched that requested state exactly. This proves the promotion is not only persistent readback: spatial write/readback authority remains usable after standard installation, save, reopen, dispatcher reload, broker restart, and authenticated CEP reconnection.

## Project/cleanup evidence

- original blank fingerprint: `project:sha256:0a1f2ab2a77b28d4a483592a7e59b2f1614ce3012a85ef680a97ffbbd9b10440`
- saved fixture fingerprint: `project:sha256:bc76e2162096b98a337ba48afb016a4298f5bf4d6f772006bea4a18f99c75fc3`
- saved item count: `2`
- cleanup blank item count: `0`
- cleanup fingerprint restoration check: `true`
- saved `.aep` remained retained after cleanup.

## Retained evidence hashes

- artifact ZIP: `7ea321e60f8f9df055494c6ada069b23fc1e7752f20a83e861635081f6730286`
- `result.json`: `2590a5e3cb49570b81fc34d39fea8db08f66e789a73f42cf862c78157430dda4`
- `reopen-result.json`: `150779a209a3909b89f0dbc370272d890e0e22ed57a2c407aaf71298f3cb8669`
- `cleanup-result.json`: `74ae7380dd3117728ef34c21181e549db4deebe23f0924a25556ff01c4ab65ac`
- `m3-spatial-graph-p5-transfer.aep`: `646a0b684813e61f72519635aae52d090cfe6e89d9da229520ef9cb35c0a7831`
- `panel-bootstrap.log`: `fa6462c27d2f4cc92b8cdb8184efa3380a365e786cbb8ae8b93dea14c0a3e949`
- `startup-diagnostics.log`: `205ba25a449ad7706acaaf7f2a5fcd521182c598763e3adb120ed226f409d014`

## Startup retry note

The self-hosted lifecycle retained one earlier panel-registration attempt under `panel-registration-retry-attempt-1`. That attempt timed out at CEP panel registration before host probe, fixture creation, spatial mutation, project save, or transfer proof began. The bounded lifecycle then cold-started a clean After Effects instance and the accepted attempt above completed end-to-end. The failed registration attempt is retained for diagnosis rather than erased from provenance.

## External semantic cross-check

The proof relies on current documented After Effects behavior but does not substitute documentation for real-host evidence:

- After Effects scripting `Property` documentation: https://ae-scripting.docsforadobe.dev/property/property/ — spatial tangent APIs and roving-key behavior are defined for spatial properties.
- After Effects scripting `Layer` documentation: https://ae-scripting.docsforadobe.dev/layer/layer/ — `Layer.id` is documented as persistent when a project is saved and later reloaded.

These documented invariants match the exact retained P5 checks above.

## Acceptance

**Protocol 1.9 spatial Graph Editor standard-runtime promotion is accepted for the exercised transfer-approved envelope.** The ordinary EditFlow CEP installer can now install and negotiate the accepted v1.9 host, the saved spatial state survives reopen/reconnect with persistent native AE identity, and a fresh authenticated session retains exact spatial write/readback authority.

This promotion does not claim arbitrary custom-plugin curve editors or non-spatial property graphs; those remain outside the protocol-1.9 evidence envelope.