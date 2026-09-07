# M3 managed null-rig P3/P4 real-AE acceptance — run 1

- Feature PR: #108 (`m3-null-rigs-p3-p4`)
- Accepted P1/P2 parent branch: `m3-null-rigs-p1-p2`
- Exact CI-green source commit under proof: `b16b744456ebaf3367831488358ffa6969ec6ba7`
- Real-AE control/trigger commit: `9e606c9a68a5f3232f790aeaca2a1dea60a1f5a8`
- Repository CI before AE launch: run `34140723520` / success
- GitHub Actions real-AE run: `34140788458`, attempt 1
- Real-AE job: `101802070945`
- Uploaded artifact: `m3-null-rig-p3-p4-proof-34140788458` / artifact id `10025831274`
- Artifact ZIP digest: `sha256:33b1a3e1063ab49f7ef27413772c798a9cfa844a39d82c902acd68a1fcfb057f`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- Accepted P1/P2 source: `955e24401ee37febf998d8ec4c544e345aebab6d`; run `34139625065`, attempt 1; artifact `10025391737`

## Automated proof result

The retained `result.json` reports:

- `proofId: M3_NULL_RIG_P3_P4_REAL_AE`
- `status: VISUAL_REVIEW_REQUIRED`
- `ok: true`
- `cleanupComplete: true`
- `P3_visual_artifact_emitted: true`
- `P3_visual_proof: false`
- `P4_failure_injection_rollback: true`
- `P5_save_reopen_reconnect_transfer: false`
- no failure error
- no cleanup errors

The harness intentionally cannot accept its own P3 render. Independent retained-artifact review below is the acceptance step.

Every bounded structural/recovery check is true, including:

- authenticated CEP negotiation selected protocol 1.5 while retaining protocol 1.4 parenting and protocol 1.1 setup/render compatibility;
- host probe resolved real Adobe After Effects;
- proof began from a blank unsaved project;
- deterministic asymmetric multicolor source media was imported;
- a caller-stable managed layer was created as a true After Effects null with exact owned backing-source identity;
- protocol 1.4 preserve-transform parenting attached the visible child to the managed null with exact stable identity and no five-point comp-space jump;
- protocol 1.5 topology readback reported the child attached to the true null;
- transforming only the invisible null materially moved the visible child geometry while the rig remained a true null and exact topology stayed attached;
- the driven real-AE render was emitted;
- protocol 1.4 preserve-transform detach cleared the relationship while preserving all five driven comp-space geometry points exactly within proof tolerance;
- protocol 1.5 topology readback then reported no children;
- the detached real-AE render was emitted;
- the proof-gated post-create failure reported exact code `M3_NULL_RIG_P4_INDUCED_FAILURE`;
- the host reported `Failed null-rig mutation self-rolled back with AE Undo.`;
- a fresh project observation restored the exact pre-failure structural fingerprint and project item count;
- readback of the induced-failure rig rejected with `NULL_RIG_NOT_FOUND`;
- the original main rig's complete readback and empty child topology were restored exactly;
- a post-rollback recovery render was emitted;
- proof-owned cleanup removed all temporary proof items and restored the original blank item count and structural fingerprint;
- the self-hosted runner gracefully closed only its owned After Effects process and confirmed zero remaining After Effects processes.

`P5_save_reopen_reconnect_transfer` remains false and is not claimed by this tranche.

## Exercised controller geometry

Proof generation prefix: `M3_NULL_RIG_P34_1788796614794`.

The child began unparented with five-point comp-space geometry:

- top-left: `[90, 115]`
- top-right: `[270, 115]`
- bottom-right: `[270, 225]`
- bottom-left: `[90, 225]`
- center: `[180, 170]`

Attaching the neutral null preserved those five points exactly. The true null then changed from its default center transform to:

- position: `[455, 235]`
- scale: `[128, 128]` (AE readback carries Z scale separately as `100`)
- rotation: `28` degrees
- opacity: `0`

With the child still attached, its five-point comp-space geometry became:

- top-left: `[234.120269775391, 23.3263320922852]`
- top-right: `[437.551391601562, 131.492584228516]`
- bottom-right: `[371.449798583984, 255.811599731445]`
- bottom-left: `[168.018661499023, 147.645355224609]`
- center: `[302.785034179688, 139.568969726562]`

After preserve-transform detach, all five points remained exactly at those driven values. The main rig remained a true null and its topology changed from the exact child stable ID to an empty children list.

## Independent retained-artifact review

The successful run artifact was downloaded after upload and reviewed independently of the harness.

The four retained proof renders are H.264, 640x360, 24 fps, exactly one frame each (`0.041667 s`):

- `p3-attached-neutral.mp4`
- `p3-rig-driven.mp4`
- `p3-detached-preserved.mp4`
- `p4-post-rollback.mp4`

The neutral frame is visibly nontrivial: an asymmetric multicolor rectangle with red, green, blue, yellow, dark, and white regions appears against black. The driven frame visibly translates, rotates, and scales that child while the null itself remains invisible. This excludes blank-frame or invisible-child false positives.

Decoded RGB comparison establishes the required visual behavior:

- neutral attached vs rig-driven: **not equal**; `47,259` changed pixels, `20.51171875%` of the 640x360 frame, mean absolute channel difference `20.319223090277777`, maximum channel difference `255`, difference bounding box `[88, 22, 438, 258]`;
- rig-driven vs detached-preserved: **pixel-exact**; zero changed pixels;
- detached-preserved vs post-rollback: **pixel-exact**; zero changed pixels;
- rig-driven vs post-rollback: **pixel-exact**; zero changed pixels.

Decoded RGB pixel SHA-256 values:

- attached neutral: `deaf7a5d0833ad239c81c1fa4578d8bd57e8b03056bb5053171b4b710953274b`
- rig-driven: `0ae2541fd0d0f13eb62294a41340be6db401939cfe6a65376404b387be814c03`
- detached-preserved: `0ae2541fd0d0f13eb62294a41340be6db401939cfe6a65376404b387be814c03`
- post-rollback: `0ae2541fd0d0f13eb62294a41340be6db401939cfe6a65376404b387be814c03`

The visual result therefore proves the intended controller envelope: the invisible managed true null materially drives the visible child, preserve-transform detach causes no viewer-visible jump, and the induced failed null creation leaves the already-driven/detached visible state unchanged after AE Undo recovery.

## Retained evidence hashes

- `result.json`: `2666ce563139f600920d0b9642f47cf23a0b3c7d7361c7f1f46e3b735321a4db`
- `p3-attached-neutral.mp4`: `e5c917914bd105757adbb8509e349fbe3d17553c53f17c57c7fa18c378ba0a03`
- `p3-rig-driven.mp4`: `8ebcb5ded32585921aad7f2b3daba8c99729e4a8d1f29247270ab1378d4c0f84`
- `p3-detached-preserved.mp4`: `3fe9615c5e2a30859090e33a466d66724e13867a2ec65e09de6877549f36bf4a`
- `p4-post-rollback.mp4`: `873679314cd64f3c67da80de37d2d806d0705f38e880c1b089240edb2c8fd7d1`
- generated source bitmap: `453ea25ad5313dd60bcc25b6a369bdeb692ff703a1864bb8720733c289d7cfac`
- `panel-bootstrap.log`: `ecd6c8d547546c9ee7f5ad03bbc7df27a173507d62a934ae345306cd9e63fae9`
- `startup-diagnostics.log`: `f97ebdc3d43756fe7bc1ecfa2e6cd8a54729a9d07bc492e14e1364da95171dc0`

Render lifecycle marker SHA-256 values:

- attached neutral: `ab010008dd6f32739c1b93cdd1f9df74c2ce929d358fe6cbd607c5ce211ecd30`
- rig-driven: `f248ce99de8168176a877002a4af994c603827f996ddf3b93c059c46620dd10a`
- detached-preserved: `794aa47264981c8861ef015f05b69640101d96bd824ceac9d632385b74097ac3`
- post-rollback: `83c144d2600346e6cf506d0c690f75ea7a50af90241e1c4ec1901be3b088cfb0`

Each lifecycle marker is terminal `DONE`, reports `ok: true`, identifies its canonical `.mp4` output, has no render error, and reports temporary render-queue cleanup.

## Acceptance

**P3 is accepted by independent retained-artifact review for the exercised managed true-null controller envelope.** The invisible null materially drives the visible child, and preserve-transform detach retains the exact driven decoded pixels.

**P4 is accepted for managed-null creation by proof-gated post-mutation failure injection, AE Undo self-rollback, exact project fingerprint/item-count restoration, absence of the failed rig, exact restoration of the existing main-rig readback/topology, and pixel-exact post-rollback visual preservation.**

This closes the managed null-rig P3/P4 tranche without overclaiming transfer. The null-rig capabilities remain evidence-scoped and `PARTIAL`; P5 save/reopen/reconnect transfer is the next separate tranche.