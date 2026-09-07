# M3 layer-controls P3/P4 real-AE acceptance — run 9

- Feature PR: #117 (`feature/m3-layer-controls-p3-p4-proof`)
- Accepted P1/P2 merge baseline: `fc6c7954e2bd8f8e166d9b0387408142b628afc6`
- Exact CI-green source commit under proof: `2aa9b979c80ca4c4f025918943e725a345cd29f6`
- Real-AE control/trigger commit: `7e493aa05af5d0cb98ad242c9b752f96fa14b14b`
- Repository CI before AE launch: run `34159598297` / success
- GitHub Actions real-AE run: `34159635705`, run 9, attempt 1 / success
- Real-AE job: `101858554842`
- Uploaded artifact: `m3-layer-controls-p3-p4-proof-34159635705` / artifact id `10032176111`
- Artifact ZIP digest: `sha256:e9f863ed08f481be5aa5d3d3177058371634ad98101dfe40e29b1074d12fbc50`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- Accepted P1/P2 source: `bf26b3a4351a947d130f792ca7a1a26aa6091a2c`; acceptance commit `48055f15bd7856f3aad8cde762c58b521324f187`; run `34156910741`; artifact `10031293005`

## Automated proof result

The retained `result.json` reports:

- `proofId: M3_LAYER_CONTROLS_P3_P4_REAL_AE`
- `status: VISUAL_REVIEW_REQUIRED`
- `ok: true`
- `cleanupComplete: true`
- `P1_validation_rejection: true`
- `P2_structural_readback: true`
- `P3_visual_artifact_emitted: true`
- `P3_visual_proof: false` before independent review
- `P4_failure_injection_rollback: true`
- `P5_save_reopen_reconnect_transfer: false`
- no failure error
- no cleanup errors

The harness intentionally cannot accept its own P3 pixels. Independent retained-artifact review below is the acceptance step.

Every bounded structural/recovery check in the result is true, including:

- authenticated CEP negotiation selected protocol `1.6.0` while retaining protocol `1.1.0` setup/render compatibility;
- host probe resolved real Adobe After Effects;
- proof began from the blank unsaved baseline;
- deterministic warm-front and cool-back full-frame sources were imported into a two-layer composition;
- direct structural readback confirmed the expected initial top/bottom layer identities;
- disabling the front layer applied and emitted the back-state render;
- restoring the front layer applied and emitted the restored-front render;
- moving the enabled front layer to END applied and emitted the back-state order render;
- moving the front layer back to BEGINNING applied and emitted the restored-front order render;
- P4 injected a failure only after a real `layer.order.set` END mutation had applied and passed structural verification;
- the failed response reported `M3_LAYER_CONTROLS_P4_INDUCED_FAILURE` and the transaction reported rollback through the AE Undo boundary;
- fresh readback restored the exact pre-failure layer state/order, structural fingerprint, and project item count;
- the post-rollback recovery render was emitted;
- proof-owned cleanup removed all temporary fixture items and restored the original blank item count and structural fingerprint.

`P5_save_reopen_reconnect_transfer` remains false and is not claimed by this tranche.

## Independent retained-artifact review

The successful run artifact was downloaded after upload and reviewed independently of the harness.

The six retained proof renders are H.264, 320x320, 24 fps, 24 frames, exactly `1.000000 s` each:

- `p3-initial-front.mp4`
- `p3-disabled-back.mp4`
- `p3-restored-front.mp4`
- `p3-order-back.mp4`
- `p3-order-restored-front.mp4`
- `p4-post-rollback-front.mp4`

The front fixture is visibly warm and asymmetric across four quadrants (red/orange/magenta/yellow). The back fixture is visibly cool and asymmetric (blue/cyan/dark-blue/green). This excludes blank-frame and visually ambiguous false positives.

Decoded RGB review establishes the intended viewer-visible behavior across the complete 24-frame streams:

- initial-front, restored-front, order-restored-front, and post-rollback-front are **pixel-exact for the full decoded stream**;
- disabled-back and order-back are **pixel-exact for the full decoded stream**;
- front vs. back is materially different; on the inspected frame the mean absolute channel difference is `102.08333587646484` with maximum channel difference `199`.

Decoded RGB full-stream SHA-256 values:

- initial front: `25fcf56c62a61ad4bc15401893cd2d861aaa42c8a45e05821f7d7c6d78375d42`
- disabled back: `d109afde22fb595f4b62d8501e8b7aad8a87773b573cdbe96012468c45439d73`
- restored front: `25fcf56c62a61ad4bc15401893cd2d861aaa42c8a45e05821f7d7c6d78375d42`
- order back: `d109afde22fb595f4b62d8501e8b7aad8a87773b573cdbe96012468c45439d73`
- order restored front: `25fcf56c62a61ad4bc15401893cd2d861aaa42c8a45e05821f7d7c6d78375d42`
- post rollback front: `25fcf56c62a61ad4bc15401893cd2d861aaa42c8a45e05821f7d7c6d78375d42`

The visual result therefore proves the exercised layer-controls envelope: disabling the front layer reveals the back layer; re-enabling it restores the same front pixels; moving an enabled front layer under the back layer changes the rendered composite as expected; restoring the stacking order returns the exact front pixels; and induced post-mutation failure leaves the exact restored front pixels after AE Undo recovery.

## Retained evidence hashes

- `result.json`: `6a4c2ebdab213ca7f046f878d378707ed31b046c51dcc2fa37c696b2bb7b6c4f`
- `p3-initial-front.mp4`: `44f7337bf1d2a3ac379ce0703ace42b72d52a1d26f81e14d0eb7c359b43182b5`
- `p3-disabled-back.mp4`: `e144c39b472db290462fd6fd1c9309879d8df787ff516e4459a0ba35288b9d48`
- `p3-restored-front.mp4`: `881f2a79b398abd33f64f370d130241a6bafcb8196b4976dccc2bad28fe47c62`
- `p3-order-back.mp4`: `f92e1a6a394c54917ccdeb28306331ebd389bdb9f06098f492feb7f928fa0400`
- `p3-order-restored-front.mp4`: `eedbbb3f0d1a46decb2a8c52c725dc2bf847352cc0ed76442dbb0615dcaa9677`
- `p4-post-rollback-front.mp4`: `9f8fabaa88095c4723bc4ba2d8f0a78e20378f85be4cc55260c1ad1fae495c70`
- warm front source bitmap: `22d66823678a246f0f7e550e658ddd83d0b3ce43b09233eacce2ca25b0dc08d3`
- cool back source bitmap: `f6b0f20727db16820114f7b511ca8a78124f5d599d404082caf401f4e0305871`
- `panel-bootstrap.log`: `f173851b82c5ba69f44a7313325c77ea35da8cca2f33a3cbe766502bb0dfdc7f`
- `startup-diagnostics.log`: `29d8a5f94363175880efc74a3e9100a4a856ff24a859352d8bb545c2fec24c87`
- `startup-dialog-details.log`: `7ff73fa8441ebe3a31931ae80e1349041a9c19ee6b1b3ac59cc55d6e40c001b4`
- `crash-repair-recovery.log`: `d4a5a997b1665f92a62c416e205a46b3cff7cd7b395c703dc68dfc9e24e638c1`

Render lifecycle marker SHA-256 values:

- initial front: `d02bda7dbbc9fad7f411566625e443f07a3273d8a5e2462e5d061b480ab7c604`
- disabled back: `4c848696df703bdb08264472128ad0708a55fbf82eef2b6c180f4e97c0dc1fda`
- restored front: `db14fa4dc8cd65972211e04764c394f67b730f2f190228d9506e80e87908d9ba`
- order back: `45abf39f1b40ae524fb6d890a129e6939f57c1401220044b379b61a169594f4f`
- order restored front: `def1e9a5618f1d31aaf8151f38df24f645fad27507fea2d2bea8fb77ec757cd7`
- post rollback front: `0e1aa68d85d4cdc691e592a0981b87b3aae4c2961ce09e6bfdf46cc0836cded2`

## External semantic cross-check

Current Adobe documentation independently matches the test interpretation:

- Adobe documents that layer stacking order is directly related to render order: https://helpx.adobe.com/after-effects/desktop/work-with-layers/select-and-arrange-layers/selecting-arranging-layers.html
- Adobe documents that After Effects scripts can reorder composition layers: https://helpx.adobe.com/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html
- Adobe documents layer switches and separately notes the composition-level dependencies of Frame Blend and Motion Blur, matching this tranche's explicit scope boundary: https://helpx.adobe.com/after-effects/desktop/work-with-layers/manage-layers/layers.html

## Acceptance

**P3 is accepted by independent retained-artifact review for the exercised protocol-1.6 layer visibility and stacking-order envelope.** Both mutation families produce the expected viewer-visible state changes and exact restoration.

**P4 is accepted for layer ordering by proof-gated post-mutation failure injection, AE Undo self-rollback, exact project fingerprint/item-count/structural restoration, and pixel-exact post-rollback visual preservation.**

This closes the protocol-1.6 layer-controls P3/P4 tranche without overclaiming transfer. The layer-controls capabilities remain evidence-scoped and `PARTIAL`; P5 save/reopen/reconnect transfer is the next separate tranche.