# M3 temporal-interpolation P3/P4 real-AE acceptance — run 9

- Feature PR: #120 (`feature/m3-temporal-interpolation-foundation`)
- Accepted base on `main`: `051659452bf7d907b395fe7bc843abc9251358a3`
- Exact CI-green source commit under proof: `6b218bf3f6ba0014a6a78fa33769f170dc300fa3`
- Real-AE control/trigger commit: `5cb3e7bd9fd1fc5cf0d6ff5c17ff7946566c9e45`
- Repository CI before AE launch: run `34166042760` / success
- GitHub Actions real-AE run: `34166441340`, run 9, attempt 1 / success
- Real-AE job: `101878333951`
- Uploaded artifact: `m3-temporal-interpolation-p3-p4-proof-34166441340` / artifact id `10034335983`
- Artifact ZIP digest: `sha256:f66aeb095e28e14d736689a038045f306d5324803c8c49bd29177220ec38ae6a`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- Accepted P1/P2 source: `9b660195c265f35fff79616b1ae345c01aeaec78`; control commit `bfa22a7f6f7254325899e6b3d3b07d14b2fdadd7`; run `34163522485`; job `101869972996`; artifact `10033403065`

## Automated proof result

The retained `result.json` reports:

- `proofId: M3_TEMPORAL_INTERPOLATION_P3_P4_REAL_AE`
- `status: VISUAL_REVIEW_REQUIRED`
- `ok: true`
- `cleanupComplete: true`
- `cleanupStrategy: PROOF_OWNED_CLOSE_WITHOUT_SAVE_NEW_PROJECT_EXACT_BASELINE_VERIFY`
- `cleanupUndoBarrierObserved: true`
- `cleanupUndoCount: 60`
- `cleanupErrors: []`
- `P1_validation_rejection: true`
- `P2_structural_readback: true`
- `P3_visual_artifact_emitted: true`
- `P3_visual_proof: false` before independent review
- `P4_failure_injection_rollback: true`
- `P5_save_reopen_reconnect_transfer: false`

The harness intentionally cannot accept its own P3 pixels. Independent retained-artifact review below is the acceptance step.

Every bounded structural/recovery check in the retained result is true, including:

- authenticated CEP negotiation selected protocol `1.7.0` while retaining protocol `1.1.0` setup/render compatibility;
- host probe resolved real Adobe After Effects `25.6.6x4`, build `4`;
- the proof began from an exact blank unsaved project baseline;
- deterministic warm-background and cool-foreground fixtures were imported into a one-second Opacity interpolation composition;
- LINEAR, incoming-HOLD, outgoing-HOLD, and restored-LINEAR temporal states all applied with exact structural readback;
- P4 injected a proof-gated failure only after a real temporal-interpolation mutation had applied and passed verification;
- the failed response reported the proof-injection failure and the transaction reported rollback through the AE Undo boundary;
- fresh readback restored the exact pre-failure temporal state, structural fingerprint, and project item count;
- the post-rollback recovery render was emitted;
- generic Undo cleanup hit the known asynchronous render-history barrier after the bounded 60 Undo attempts rather than falsely claiming success;
- the isolated proof-owned cleanup validated exact fixture ownership, closed the disposable unsaved project with `CloseOptions.DO_NOT_SAVE_CHANGES`, created a new project, and independently verified the exact pre-proof fingerprint, zero item count, and null file path.

Exact cleanup evidence:

- baseline fingerprint: `project:sha256:0a1f2ab2a77b28d4a483592a7e59b2f1614ce3012a85ef680a97ffbbd9b10440`, item count `0`, file path `null`;
- proof-owned cleanup result: `ok: true`, `error: null`, blank item count `0`;
- independent cleanup verification: the same fingerprint, item count `0`, file path `null`, status `EXACT_MATCH`, `exact: true`.

`P5_save_reopen_reconnect_transfer` remains false and is not claimed by this tranche.

## Independent retained-artifact review

The successful run artifact was downloaded after upload and reviewed independently of the harness.

The five retained proof renders are H.264, 320x320, 24 fps, 24 frames, exactly one second each:

- `p3-linear.mp4`
- `p3-incoming-hold.mp4`
- `p3-outgoing-hold.mp4`
- `p3-restored-linear.mp4`
- `p4-post-rollback-linear.mp4`

The deterministic source fixtures are materially different: the background is warm/red and the foreground is cool/blue. This excludes blank-frame and visually ambiguous false positives.

At the proof sample times `0.25 s` and `0.75 s`, decoded RGB review establishes the intended viewer-visible directional interpolation behavior:

- LINEAR shows the expected mixed warm/cool blend at both sample points;
- incoming-HOLD is foreground-dominant on the incoming side at `0.25 s`, while its outgoing side at `0.75 s` matches LINEAR;
- outgoing-HOLD matches LINEAR on the incoming side at `0.25 s`, while it is foreground-dominant on the outgoing side at `0.75 s`;
- restored-LINEAR matches the original LINEAR result;
- the P4 post-rollback render matches the original LINEAR result.

Representative decoded-frame MD5 signatures reinforce the directional distinction:

- LINEAR frame 6 (`0.25 s`) and frame 18 (`0.75 s`): `85cd0a1a51c4e4cc27609ac512584a0e`;
- incoming-HOLD frame 6: `226729ca8e662f8a62764da260e26d29`; frame 18 matches LINEAR;
- outgoing-HOLD frame 6 matches LINEAR; frame 18: `226729ca8e662f8a62764da260e26d29`.

Decoded RGB full-stream SHA-256 values:

- LINEAR: `b9bce22c12a13e16ab35619278ed971bae2ba8c2d291d92334985f085820ce69`
- incoming-HOLD: `e9a735c9fc5fb40a74d9cca5642435593c8f70fbc0afdab796922c98ffd42ff8`
- outgoing-HOLD: `689522ec20226b7eab8a56cafc21beac876558be09ffb46c9bed68bac6604661`
- restored-LINEAR: `b9bce22c12a13e16ab35619278ed971bae2ba8c2d291d92334985f085820ce69`
- post-rollback LINEAR: `b9bce22c12a13e16ab35619278ed971bae2ba8c2d291d92334985f085820ce69`

Thus every decoded frame of restored-LINEAR is pixel-identical to the original LINEAR stream, and every decoded frame of the P4 post-rollback render is also pixel-identical to the original LINEAR stream.

## Retained evidence hashes

- `result.json`: `92d0b1c41f72d9996f730c52a3983677083d390938f4d14b2caf2bab37bbe813`
- `cleanup-baseline.json`: `083e1ba28bdf9e7835c21c57d682e9ab30c4c94c8a38639cc395f090f42d6896`
- `cleanup-result.json`: `2b23a12f04c04357730d67124a88a1de270eeeee1018253a49dbf3158e8efda9`
- `cleanup-verify.json`: `5db67bbf3ef78ad1da8e32e4097652cb66e87b0154126990032cf927b96a3fef`
- `p3-linear.mp4`: `48f165f759c6dfb2ab2e5491dbf42661952cd3aa81a8f638bdae655000077465`
- `p3-incoming-hold.mp4`: `afcc292a8422d8cf50da296187b57abb9981b71784b246e8d439825f78f37506`
- `p3-outgoing-hold.mp4`: `4de45685069f34c6d47480c26f922aa593b69dee2a7453e1ef7bd4e1616e632f`
- `p3-restored-linear.mp4`: `a85943466b892d7ac8af97d0b9096743b8d6b4d574644ace729170a0b0b5e6b4`
- `p4-post-rollback-linear.mp4`: `069f90df37c4aac490a19f66c572b0ae67c888061858cdba37c61fbbbe967d06`
- warm background source bitmap: `333b609a4c4e08ebce496289d5e522beebf8454fac5e360bb74bc6367b941222`
- cool foreground source bitmap: `823d621aa1939e27ddfa410cb84da23f8c149d2f7a5015548cb96c20a1269d7f`
- `panel-bootstrap.log`: `c3abcbe811a04c198a8b70ffcf1dcdf7f29a53f5c4fd6154fd1a80f5ba00cfaa`
- `startup-diagnostics.log`: `c881e647df5c0c1bccdbb8fc2090a69635faf9a3a195999a9f93b1e0f6984240`

Render lifecycle marker SHA-256 values:

- LINEAR: `cf05787d9faed5944b8b2301f6ae176dae1b6e3de6b1082c37a6cdfe2149b124`
- incoming-HOLD: `453b0045ef3950824fb499cf9f25653bc9793af7108c6636cdac7089a6b60cb1`
- outgoing-HOLD: `272dddd88daf09055cf6d821ba9d433503d29547cbaf9345c0f5746b0c21fe71`
- restored-LINEAR: `0fb64e6e35234dc504f93becabe195dc03922721ffa2a73a4d12bde3051a4735`
- post-rollback LINEAR: `e27b4ccc97abf48bf46273f07777ca49fa3ac5a380841b0ce915a29c37c1b5ee`

## External semantic cross-check

Current After Effects documentation independently matches the retained visual interpretation:

- Adobe's current keyframe-interpolation documentation describes temporal Linear, Bezier, and Hold behavior and explicitly notes that Hold prevents a gradual transition: https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/animation-keyframes/keyframe-interpolation.html
- The After Effects Scripting Guide documents `Property.setInterpolationTypeAtKey()`, `isInterpolationTypeValid()`, direct incoming/outgoing interpolation readback, and the temporal continuity/auto-Bezier methods used by protocol 1.7: https://ae-scripting.docsforadobe.dev/property/property/

The real-AE retained pixels, not the documentation, are the acceptance authority for this proof.

## Acceptance

**P3 is accepted by independent retained-artifact review for the exercised protocol-1.7 temporal-interpolation envelope.** LINEAR and independently directed incoming/outgoing HOLD states produce the expected viewer-visible behavior, and restoring LINEAR returns the exact decoded pixel stream.

**P4 is accepted by proof-gated post-mutation failure injection, AE Undo self-rollback, exact temporal-state/fingerprint/item-count restoration, and pixel-exact post-rollback visual preservation.**

This closes the protocol-1.7 temporal-interpolation P3/P4 tranche without overclaiming transfer. The two capabilities remain evidence-scoped and `PARTIAL`; P5 save/reopen/reconnect transfer is the next separate gate. Numeric Graph Editor ease/influence and spatial interpolation controls remain later roadmap tranches.
