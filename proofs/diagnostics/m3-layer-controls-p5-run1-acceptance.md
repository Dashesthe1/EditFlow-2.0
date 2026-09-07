# M3 layer-controls P5 real-AE acceptance — run 1

- Feature PR: #119 (`feature/m3-layer-controls-p5-transfer`)
- Accepted P1–P4 merge baseline: `7dc3558b932995dba078030089226b894cf95d85`
- Exact repository-CI-green source under P5 proof: `a6181c0af2f22fd83141625f6c5852ae0a27b786`
- Repository CI: run `34160504063`, job `101861183798` / success
- Real-AE control/trigger commit: `82e55f8b2c8ee868cf2ac168e27b0ef5c4579340`
- GitHub Actions real-AE run: `34160617926`, attempt 1 / success
- Real-AE job: `101861547189`
- Uploaded artifact: `m3-layer-controls-p5-proof-34160617926` / artifact id `10032484694`
- Artifact ZIP digest: `sha256:92ad6c675ae7908da79d4434011ea8e4df41cff587baa4f2e8d450c189cdf246`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- CEP extension: `com.editflow2.bridge.panel` / `0.1.0-dev.6`

## Accepted prior evidence

P5 starts from, and does not replay, the already accepted lower proof levels:

- P1/P2 source: `bf26b3a4351a947d130f792ca7a1a26aa6091a2c`
- P1/P2 acceptance commit: `48055f15bd7856f3aad8cde762c58b521324f187`
- P1/P2 run: `34156910741`
- P1/P2 artifact: `10031293005`
- P1/P2 record: `proofs/diagnostics/m3-layer-controls-p1-p2-run7-acceptance.md`
- P3/P4 source: `2aa9b979c80ca4c4f025918943e725a345cd29f6`
- P3/P4 control commit: `7e493aa05af5d0cb98ad242c9b752f96fa14b14b`
- P3/P4 run: `34159635705`
- P3/P4 job: `101858554842`
- P3/P4 artifact: `10032176111`
- P3/P4 record: `proofs/diagnostics/m3-layer-controls-p3-p4-run9-acceptance.md`

## Automated P5 result

The retained `result.json` reports:

- `proofId: M3_LAYER_CONTROLS_P5_REAL_AE`
- `status: ACCEPTED`
- `ok: true`
- `P5_save_reopen_reconnect_transfer: true`
- `failureError: null`
- `cleanupErrors: []`
- `cleanupComplete: true`

Every bounded transfer/recovery check is true, including:

- proof scripts and After Effects executable present;
- initial authenticated panel negotiated protocol `1.6.0` and advertised both `1.6.0` and baseline `1.1.0`;
- host probe resolved real Adobe After Effects;
- proof began from the blank unsaved runner-owned baseline;
- deterministic three-composition/two-AVLayer fixture created;
- all twelve accepted protocol-1.6 switch keys reported supported;
- distinctive pre-save switch patch applied exactly;
- the locked front layer moved to END and retained exact readback;
- public v1.1 `project.save` produced the fixed non-empty `.aep` artifact;
- saved project path, item shape, stable IDs, layer order, and structural fingerprint read back exactly;
- proof-gated JSX closed and reopened the fixed saved project and reloaded the protocol-1.6 dispatcher;
- broker restart produced a distinct authenticated CEP session;
- exact layer-control semantics survived reopen/reconnect;
- native After Effects layer IDs survived save/reload;
- a fresh post-reconnect switch mutation applied;
- a fresh post-reconnect stacking-order mutation applied;
- fresh readback matched the requested state while untouched switches remained unchanged;
- proof-only cleanup retained the saved `.aep`, returned After Effects to a blank unsaved project, and restored the original structural fingerprint.

## Transfer identity evidence

Initial authenticated CEP session:

- session id: `eb09ad8f-43c6-41db-a4b2-2f7a41ee8001`
- negotiated protocol: `1.6.0`
- supported protocols: `1.6.0`, `1.1.0`

Reconnected authenticated CEP session:

- session id: `c8bfb5ad-84e8-4d11-811a-ae2107b85dfe`
- negotiated protocol: `1.6.0`
- supported protocols: `1.6.0`, `1.1.0`

The session IDs are distinct, so the post-reopen readback and writes did not merely reuse the original broker session.

The target front layer retained native After Effects `Layer.id = 38` before save and after reopen/reconnect. Its back-layer neighbor retained native `Layer.id = 37`. This independently anchors EditFlow stable-ID continuity to After Effects' own persistent layer identity.

## Exact semantic state before save and after reconnect

The front-layer semantic snapshot was identical before save and after reconnect:

- `enabled: true`
- `audioEnabled: false`
- `solo: false`
- `locked: true`
- `shy: true`
- `collapseTransformation: false`
- `quality: DRAFT`
- `effectsActive: false`
- `adjustmentLayer: false`
- `threeDLayer: false`
- `preserveTransparency: true`
- `samplingQuality: BICUBIC`
- order index `2 / 2`
- previous layer = exact back-layer EditFlow stable ID and native AE host id `37`
- target layer native AE host id `38`

The equality comparison covers declared support flags as well as values, order, total layer count, and neighbor identities.

## Fresh post-reconnect authority

After transfer was established, the new authenticated session changed the same stable front layer to:

- `audioEnabled: true`
- `locked: false`
- `shy: false`
- `quality: BEST`
- `effectsActive: true`
- `preserveTransparency: false`
- `samplingQuality: BILINEAR`
- order index `1 / 2`, with the back layer as the exact next neighbor

Untouched switches (`enabled`, `solo`, `collapseTransformation`, `adjustmentLayer`, `threeDLayer`) remained unchanged. Native front-layer id remained `38`.

This proves P5 is not only persistence readback: protocol-1.6 write/readback authority remains usable after save, reopen, dispatcher reload, broker restart, and authenticated CEP reconnection.

## Retained evidence hashes

- artifact ZIP: `92ad6c675ae7908da79d4434011ea8e4df41cff587baa4f2e8d450c189cdf246`
- `result.json`: `fefea3198b35cf4a96d2e1a98735cf0c054436114edb651ab6aeb2fd6a4bb0bd`
- `m3-layer-controls-p5-transfer.aep`: `5093cb9bf82885731d5d5fd1b6d2bc2d8a48d2d237939622af3dc4eed1131b3a`
- `reopen-result.json`: `29c7ddedceb047e1aa71ff3fc658e7f70556f4445f20c1a38d82d8abff1953cb`
- `cleanup-result.json`: `591396c8ce0bf391d1b91f010ca4176adf1ce3f247d126965d24bf59fb59b4fe`
- `panel-bootstrap.log`: `4889cc76884e85958bce684dadf19f3ad081439a5fadec96f48f78837389d20a`
- `startup-diagnostics.log`: `f34f2fff44139e481bd1cf5be09eec334ae2487ef4c7268f4dfbd2514a965787`
- `startup-dialog-details.log`: `9004518c0b6cf54cfd4e63433610985e2ffb79348aec7662e7051d52c6f5b160`

## External semantic cross-check

The proof deliberately relies on current documented After Effects behavior rather than assuming save/reopen semantics:

- After Effects Scripting Guide, `Layer.id`: https://ae-scripting.docsforadobe.dev/layer/layer/ — `Layer.id` is documented as persistent between sessions and unchanged when a project is saved and later reloaded.
- Adobe After Effects scripting documentation: https://helpx.adobe.com/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html — Adobe documents `afterfx.exe -r <script>` as running the script in the existing After Effects instance rather than launching a separate application instance.

These references match the P5 invariants but do not substitute for the retained real-AE evidence above.

## Acceptance

**P5 save/reopen/reconnect transfer is accepted for the exercised protocol-1.6 layer-controls envelope.** The distinctive switch state, stacking order, EditFlow stable IDs, native AE layer identities, and project structural fingerprint survive save/reopen/reconnect exactly, and the new authenticated session retains fresh write/readback authority.

Together with the already accepted P1/P2 structural evidence and P3/P4 visual/rollback evidence, this completes the layer-controls P1–P5 proof ladder for:

- `ae.layer.controls.readback`
- `ae.layer.switches.set`
- `ae.layer.order.set`

Those three capabilities may now be projected to `FULL` + `TRANSFER`, while the explicitly deferred compound rendering controls (motion blur/frame blending and their composition-level dependencies) remain outside this evidence envelope.