# M3 composite P3/P4 real-AE acceptance — run 3

- PR: #82 (`feature/m3-composite-p3-p4-proof`)
- Source commit under proof: `4021dd607e0a130f3dcf2e6bcab27966afcd6aca`
- Isolated control trigger merge: `43095e35ebd0dd7aee660832ffeb4bda0cea379a`
- Trigger-only PR: #85
- GitHub Actions run: `34079590956`
- Real-AE job: `101612211678`
- Uploaded artifact: `m3-composite-p3-p4-proof-34079590956` / artifact id `10003250056`
- Artifact ZIP digest: `sha256:ed420b3afbd7f571121cda3e8eabcd45910edc9c86d5e7fe51980e4dbbc18234`
- Host: Adobe After Effects 25.6.6 on the self-hosted Windows `editflow-ae` runner
- Accepted P1/P2 baseline: main `6bc1033f043ec10f064026ef91337c3358d06478` / run `34077728610`, attempt 2

## Automated proof result

The retained `result.json` reports `ok: true`, `status: VISUAL_REVIEW_REQUIRED`, `cleanupComplete: true`, no failure error, and no cleanup errors.

All required automated checks are true:

- authenticated panel negotiation selected protocol 1.3 while retaining 1.1 compatibility;
- deterministic background, foreground, and three-band LUMA matte fixture media were imported into real After Effects;
- exact target comp/layer construction and layer order passed;
- `layer.set_track_matte` applied a real `LUMA` arbitrary-source matte and exact structural readback matched;
- `layer.set_blend_mode` applied real `ADD` compositing and exact structural readback matched;
- P3 emitted a non-empty canonical After Effects render artifact;
- the exact proof-only P4 post-mutation `ADD -> MULTIPLY` failure was reported as `M3_COMPOSITE_P4_INDUCED_FAILURE`;
- the host reported `Failed mutation self-rolled back with AE Undo.`;
- the pre-failure structural project fingerprint was restored;
- exact composite state/readback was restored to LUMA + ADD;
- the post-rollback recovery render was emitted;
- proof-gated disposable-project cleanup removed every temporary item, restored item count, and restored the original blank structural fingerprint;
- the self-hosted runner confirmed zero After Effects processes after final cleanup.

The harness correctly leaves `P3_visual_proof: false` because it is not permitted to self-accept its own render. `P5_save_reopen_reconnect_transfer` remains false and is not claimed by this tranche.

## Independent retained-artifact review

The successful-run artifacts were reviewed independently of the proof harness after upload.

Both retained renders are H.264, 320x320, 24 fps, one second, 24 frames. The P3 render shows exactly the expected three stable vertical bands produced by the LUMA matte plus ADD blend:

- left/black-matte band sample at x=50: RGB `(24, 39, 55)` — background-only appearance;
- middle/50%-gray-matte band sample at x=160: RGB `(74, 79, 85)` — partial foreground contribution;
- right/white-matte band sample at x=270: RGB `(124, 119, 116)` — full foreground ADD contribution.

The bands are ordered darkest -> intermediate -> brightest, the matte image itself does not leak into the final composite, and there is no inversion or unexpected full-frame foreground leak. This is direct viewer-visible evidence that the LUMA matte and ADD blend are both active in the real AE render.

The post-rollback render is visually equivalent to the P3 render. More strongly, all 24 decoded RGB frames are byte-for-byte identical. The combined decoded-pixel SHA-256 is the same for both sequences:

- P3 decoded frame-sequence hash: `33f0cc51e13386a64a9c115fc16643f4605644b4cb71ddd890789caf91365de5`
- P4 decoded frame-sequence hash: `33f0cc51e13386a64a9c115fc16643f4605644b4cb71ddd890789caf91365de5`

The MP4 container hashes differ, which is expected for separately encoded outputs, while the decoded visual result remains exact.

Additional retained hashes:

- `p3-luma-add-composite.mp4`: `40d947f943d1cca6dc72a54eb9b762f351e3a94af455eb18f0a2908b3c2b4383`
- `p4-post-rollback.mp4`: `723a70bf8dfd2fc7482c9b2e50a2a91056ad936373d6b903eeacc4c03d7912b2`
- `result.json`: `98064f2c7f44d4768e0e2dde698e7da1395b2ef024bd6ae0a9d9c5a52134787d`
- P3 render lifecycle marker: `ed99ef7caf87804b0bd78bec5b85d36a5935c22355d28d8fafb72018f03ef744`
- P4 render lifecycle marker: `f9900097a2964d474efaa7b23d13740bd4dd0fa8d0122fd8d32e0a70a76289b4`

Both lifecycle markers are terminal `DONE`, `ok: true`, identify their canonical `.mp4` output paths, and report render-queue removal.

## Bootstrap/cleanup hardening retained by this tranche

The preceding run 2 exposed an opaque panel-registration timeout when a proof-only cleanup module could fail during host bootstrap. This tranche repairs that infrastructure without weakening the proof boundary:

- the composite self-hosted runner explicitly clears any inherited mask-proof environment flag before launching its owned AE process and restores it afterward;
- mask and composite proof cleanup modes remain mutually exclusive;
- proof-cleanup load defects now preserve panel registration but replace proof dispatch with a fail-closed typed `M3_PROOF_CLEANUP_MODULE_LOAD_FAILED` response, so no proof mutation can proceed without its cleanup guard;
- ordinary product sessions never enter this path because neither proof environment flag is set.

## Acceptance

**P3 accepted by independent retained-artifact review for the exercised LUMA track-matte + ADD blend behavior.**

**P4 accepted for the exercised blend-mode mutation by real-AE induced-failure rollback proof plus exact post-rollback structural and visual equivalence.**

This closes the M3 composite P3/P4 tranche. P5 save/reopen/reconnect transfer remains the next separate tranche and is not implied by this acceptance. The existing composite capability records remain evidence-scoped; this document does not claim higher maturity for unexercised clear/readback behavior or for transfer durability.
