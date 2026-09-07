# M3 mask/Bezier P3/P4 real-AE acceptance — run 5

- PR: #73 (`feature/m3-mask-p3-p4-proof`)
- Source commit under proof: `c7c572c269bc4055e2144c2c14f35a0750affef8`
- Isolated control trigger: `d96427a8d9b5733bf51f9f8bb86ba4fb4ac92711`
- GitHub Actions run: `34073726432`
- Real-AE job: `101595753404`
- Uploaded artifact: `m3-mask-p3-p4-proof-34073726432` / artifact id `10001336890`
- Host: Adobe After Effects 25.6.6 on the self-hosted Windows `editflow-ae` runner

## Automated proof result

The retained `result.json` reports `ok: true`, `status: VISUAL_REVIEW_REQUIRED`, `cleanupComplete: true`, no failure error, and no cleanup errors.

All required automated checks are true:

- authenticated panel negotiation selected protocol 1.2 while retaining 1.1 compatibility;
- deterministic fixture media, comp, layer order, mask creation, and animated path structural readback passed;
- P3 emitted a non-empty canonical After Effects render artifact;
- the exact proof-only P4 post-mutation failure was reported;
- the host reported `Failed mutation self-rolled back with AE Undo.`;
- the pre-failure structural project fingerprint was restored;
- exact mask state/readback was restored;
- the post-rollback recovery render was emitted;
- proof-gated disposable-project cleanup removed every temporary item, restored item count, and restored the original blank structural fingerprint.

The harness correctly leaves `P3_visual_proof: false` because it is not allowed to self-accept its own render. `P5_save_reopen_reconnect_transfer` also remains false and unclaimed by this tranche.

## Independent retained-artifact review

The successful-run artifacts were reviewed independently of the proof harness after upload.

`p3-mask-reveal.mp4` is H.264, 320x320, 24 fps, one second, 24 frames. Representative beginning/middle/end frames show the expected bright cyan/red checker foreground revealed through a rounded central ADD mask over the dark checker background. The aperture grows monotonically from small to medium to large, the center remains foreground-visible, the corners remain background-visible, and there is no full-frame foreground leak, black/transparent hole, or inverted reveal.

The post-rollback render is visually equivalent to the pre-failure P3 render. More strongly, decoded `framemd5` output is identical for all 24 frames:

- `p3.framemd5` SHA-256: `191a2436e302a85a669f1ed0416d2bc03cb9be30903e92bbfbe966dd5da6e56c`
- `p4.framemd5` SHA-256: `191a2436e302a85a669f1ed0416d2bc03cb9be30903e92bbfbe966dd5da6e56c`

The MP4 container hashes differ, which is expected for two separately encoded outputs, but the decoded frame sequence is exact.

Additional retained hashes from the successful run:

- `p3-mask-reveal.mp4`: `b12bc29ac756c4d7a5923842b336963fb250cb38998c9d17a03db61251732325`
- `p4-post-rollback.mp4`: `f50d9c4d20cb71e9e90e7de65216f5b739d5bff7e780d9a3e34475e532de1c70`
- `result.json`: `5b559ccf1861791c75bcd0e771755427bb810ea9b74e3fbd88a266e14bfe4b1b`

Both lifecycle markers are terminal `DONE`, `ok: true`, identify the canonical `.mp4` output path, and report `queueItemRemoved: true`.

## Acceptance

**P3 accepted by independent retained-artifact review.**

**P4 accepted by real-AE induced-failure rollback proof plus exact post-rollback visual equivalence.**

This closes the M3 mask/Bezier P3/P4 tranche. P5 save/reopen/reconnect transfer remains the next separate tranche and is not implied by this acceptance.
