# M3 motion-render P3/P4 real-AE acceptance — run 4

- Feature PR: #128 (`feature/m3-motion-render-controls`)
- Exact CI-green source commit under proof: `042a54b63a73dc3fcbcd77d5cb9d6f981492713e`
- Real-AE control/trigger commit: `b25003477abdf7001779bbdd33247e13bd30b1e9`
- Repository CI before AE launch: run `34279334473` / success
- GitHub Actions real-AE run: `34279808693`, run 4, attempt 1 / success
- Real-AE job: `102241577916`
- Uploaded artifact: `m3-motion-render-p3-p4-proof-34279808693` / artifact id `10077191111`
- Artifact ZIP digest: `sha256:79651dec656bd360e14d2db351333e05cbfee4d1e2efdc0c96dc79c56d509dcf`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- Accepted P1/P2 source: `70b1549c56179689fb033db36f13fc4b6dbb5998`; control `34adbd69d6cfb847c2900551cd5ee6caa872981a`; run `34275036819`; job `102225850170`; artifact `10075375705`

## Automated proof result

The retained `result.json` reports:

- `proof: M3_MOTION_RENDER_P3_P4_REAL_AE`
- `protocolVersion: 1.10.0`
- `status: PASS`
- `ok: true`
- `failureError: null`
- `cleanupComplete: true`
- `cleanupErrors: []`
- `P1_validation_rejection: true`
- `P2_structural_readback: true`
- `P3_visual_proof: false` before independent review
- `P4_failure_injection_rollback: true`
- `P5_save_reopen_reconnect_transfer: false`
- `visualReviewRequired: true`

The harness intentionally does not accept its own pixels. Independent retained-artifact review below is the P3 acceptance step.

Every bounded structural/recovery check in the successful result is true, including:

- authenticated CEP negotiation selected protocol `1.10.0` while preserving baseline `1.1.0` support;
- the real host probe resolved Adobe After Effects;
- the proof began from a blank unsaved project;
- deterministic motion and frame-blending sources were generated and imported;
- the frame-blending source is a directly retimed 36-frame image sequence in a 24 fps target composition, with a real `300%` layer stretch rather than a nested-composition shortcut;
- composition motion blur, shutter angle/phase, samples-per-frame, adaptive sample limit, and composition frame blending applied with exact structural readback;
- layer motion blur and all three frame-blending modes (`NO_FRAME_BLEND`, `FRAME_MIX`, `PIXEL_MOTION`) applied with exact structural readback;
- the seven P3 render artifacts were emitted successfully;
- P4 injected a proof-gated failure after a verified composition motion-render mutation and restored the exact pre-failure project fingerprint and composition state;
- P4 separately injected a proof-gated failure after a verified layer frame-blending mutation and restored the exact pre-failure project fingerprint and layer state;
- post-rollback renders were emitted for both mutation families;
- proof-owned cleanup verified the exact proof namespace, refused saved/foreign/mixed projects, discarded only the disposable unsaved fixture, opened a fresh blank project, and restored baseline fingerprint/item-count/file-path state with no managed proof items remaining.

`P5_save_reopen_reconnect_transfer` remains false and is not claimed by this tranche.

## Independent retained-artifact review

The successful run artifact was downloaded after upload and reviewed independently of the harness.

The seven retained P3 videos are 320x180, 24 fps, 24 frames, exactly `1.000000 s` each:

- `p3-motion-baseline.mp4`
- `p3-motion-blur-enabled.mp4`
- `p3-motion-restored-baseline.mp4`
- `p3-blend-none.mp4`
- `p3-blend-frame-mix.mp4`
- `p3-blend-pixel-motion.mp4`
- `p3-blend-restored-none.mp4`

Viewer-visible review establishes the intended behavior:

- motion baseline is crisp while motion-blur-enabled has a strong directional smear around the rapidly translated source;
- restored motion baseline returns to the original crisp state;
- `NO_FRAME_BLEND` remains crisp on the retimed moving-square sequence;
- `FRAME_MIX` produces visible ghost/intermediate blending around the moving square;
- `PIXEL_MOTION` is visibly distinct from both modes and produces interpolated/warped content on the deliberately high-frequency synthetic checker fixture;
- restored no-frame-blend returns to the original crisp state.

The pixel-motion checker fixture is intentionally adversarial/high-frequency. Its visible warping proves that the exercised Pixel Motion path is materially different; this acceptance does **not** claim artifact-free interpolation quality for arbitrary production footage.

Full-stream comparisons quantify those visual observations:

- motion baseline vs. motion blur: SSIM `0.895750`, average PSNR `23.400648 dB`;
- motion baseline vs. restored motion: SSIM `1.000000`, PSNR `inf`;
- no frame blend vs. frame mix: SSIM `0.994792`, average PSNR `34.211386 dB`;
- no frame blend vs. pixel motion: SSIM `0.889066`, average PSNR `21.602521 dB`;
- no frame blend vs. restored no-blend: SSIM `1.000000`, PSNR `inf`;
- frame mix vs. pixel motion: SSIM `0.888913`, average PSNR `21.668708 dB`.

Decoded RGB full-stream SHA-256 values independently prove exact restoration:

- motion baseline: `6dcd8cf4effe7ac99682ab432fc1737636c73fdaf1824fb19087c20acfc75d13`
- motion blur enabled: `b0b98d15b8f14e294228df3947931e7ac7ad31723ddcd8deaedb9e9439914c1b`
- motion restored: `6dcd8cf4effe7ac99682ab432fc1737636c73fdaf1824fb19087c20acfc75d13`
- no frame blend: `4c184192372ecb4b7b5b0b212839b7d47ad956eb5a6089519b95f293ae177ce9`
- frame mix: `90025fb7d428b91e440dc99d42cbaba1bcfc114b0ce720acbc6ea216eae77968`
- pixel motion: `be95ad002bb53558cc6ad1e424e5510b52569338464cadefffe19b24bf4c3c1a`
- restored no frame blend: `4c184192372ecb4b7b5b0b212839b7d47ad956eb5a6089519b95f293ae177ce9`
- P4 post-rollback motion: `6dcd8cf4effe7ac99682ab432fc1737636c73fdaf1824fb19087c20acfc75d13`
- P4 post-rollback blend: `4c184192372ecb4b7b5b0b212839b7d47ad956eb5a6089519b95f293ae177ce9`

The two post-rollback streams are therefore pixel-exact with their corresponding P3 baselines, independently corroborating the structural P4 rollback checks.

## Retained evidence hashes

- `result.json`: `ca8db8ed5443dbde8f0db812584a593b34aebcde7e5aeb7bb85aff95477aae70`
- `cleanup-result.json`: `4a80e632b8bd0413005c6b09841f32b09a7320693d73c2fe258ba224c25fe562`
- `p3-motion-baseline.mp4`: `a5a13be9950e249188e9f85560cebca919b252bfc513d8d621a2fccb950005ed`
- `p3-motion-blur-enabled.mp4`: `96e1e89c3443c5c0b4f136acc28f6b4727f91009d21100726e3c7307edcd0d29`
- `p3-motion-restored-baseline.mp4`: `ae7997ff4c3596d60da918fc9232d282faeac74f7aea110d69ac4e79ceb31f48`
- `p3-blend-none.mp4`: `1431be840fbdac116bd0b5cc4d4f77b8d626da25eab8db7c352fa9c5c6359016`
- `p3-blend-frame-mix.mp4`: `a99e8979aadb7649d7e224b5c5b4288d9b1632d9fe5e6d93746556b6e5dca806`
- `p3-blend-pixel-motion.mp4`: `dbe97c1220b64b4b44f49dd2cf29a6db4dfdd782c3efac7c17f8856a78dcaf9a`
- `p3-blend-restored-none.mp4`: `680a5bb51969d62c461ef488740b85ecc974df02b0d1c49bd799dcd0d3b75e67`
- `p4-post-rollback-motion-baseline.mp4`: `99c3a678ab582345954ccd17955d3ed6e1eb6e82fed37bd01c2d586ac0f9af3d`
- `p4-post-rollback-blend-none.mp4`: `16655ebb1c6e5ca9e04d6b51ad3adc30a508f82eee72ed5dd83d90ce371b2b24`
- motion source bitmap: `021d13a47caad66fdba77274b22876c3efc2c9d4206ddec9466daecf0a34d9f3`
- first blend-sequence bitmap: `00886b943f0fcc20f78fd5bd3cb724b3a9a6397a1fe0f2b8e7416c77c68a275d`
- `panel-bootstrap.log`: `db400aaa4b2c45237786a8b5689188ab80df1ad666842083a65386f0f5f7fe70`
- `startup-diagnostics.log`: `3216cc2aa6427b963c752b8c369ed069e7770ebe208eac7f72829cf2103b852f`
- `startup-dialog-handler.log`: `02689709a3973ce277b64a7fe8f3c78f6b392c57e9d96e6cdf629e56e82b7b43`

## External semantic cross-check

The current After Effects scripting object-model guide independently matches the test interpretation:

- `CompItem.frameBlending` is a writable composition switch; the same object exposes writable composition motion blur, shutter angle/phase, samples-per-frame, and adaptive sample-limit controls: https://ae-scripting.docsforadobe.dev/item/compitem/
- `AVLayer.frameBlending` is derived/read-only, while `AVLayer.frameBlendingType` is writable and supports `FRAME_MIX`, `NO_FRAME_BLEND`, and `PIXEL_MOTION`; `AVLayer.motionBlur` is writable: https://ae-scripting.docsforadobe.dev/layer/avlayer/
- `Layer.stretch` is the layer time-stretch percentage and `100` means no stretch, validating the direct `300%` retime used by this proof fixture: https://ae-scripting.docsforadobe.dev/layer/layer/

## Acceptance

**P3 is accepted by independent retained-artifact review for the exercised protocol-1.10 motion blur and frame-blending envelope.** Motion blur is viewer-visible, Frame Mix and Pixel Motion are viewer-visible and mutually distinct, and both restored baselines decode pixel-exactly to their initial states.

**P4 is accepted for both composition and layer motion-render mutation families.** Proof-gated post-mutation failure injection restores exact structural state/fingerprints, and the retained post-rollback render streams are pixel-exact with their corresponding baselines.

This closes the protocol-1.10 motion-render P3/P4 tranche without overclaiming transfer or general visual-quality robustness. The three motion-render capabilities remain `PARTIAL`, with accepted proof maturity advanced through `ROLLBACK`. P5 save/reopen/reconnect transfer is the next separate tranche required before `TRANSFER`/`FULL` promotion.