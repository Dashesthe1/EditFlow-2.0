# M3 parenting P3/P4 real-AE acceptance — run 7

- Feature PR: #92 (`feature/m3-parenting-p3-p4-proof`)
- Exact real-AE control commit under proof: `53b04b6df320c124039d7d4e069e77259fd5c7ae`
- Run-7 trigger-only PR: #99
- Run-7 trigger head: `4bd90d5e785c3d563653e7231c057b46d4ed14c3`
- Real-AE control trigger merge: `53b04b6df320c124039d7d4e069e77259fd5c7ae`
- GitHub Actions run: `34084958343`, attempt 1
- Real-AE job: `101627103099`
- Uploaded artifact: `m3-parenting-p3-p4-proof-34084958343` / artifact id `10004899768`
- Artifact ZIP digest: `sha256:642aaf073122affc797fc753815f17632c7ff0ea28cd91d383da1c8f887e134c`
- Host: Adobe After Effects 25.6.6x4, build 4, on the self-hosted Windows `editflow-ae` runner
- Accepted P1/P2 baseline on main: merge `baadb5907c735bb8bfa179e88a2d6d5eff22f95d`; accepted source `026e83dabe6e354c192f36518234f43e559048e7`; run `34082201184`, attempt 1; artifact `10004053330`
- Evidence-integrity sync back to the feature branch: PR #100 / merge `b3cceefa2e209587b7c56deba127a0b91fefc784`

## Automated proof result

The retained `result.json` reports `ok: true`, `status: VISUAL_REVIEW_REQUIRED`, `cleanupComplete: true`, no failure error, and no cleanup errors. The harness intentionally leaves `P3_visual_proof: false` so it cannot accept its own render.

Every required automated check is true:

- authenticated CEP negotiation selected parenting protocol 1.4 while retaining protocol 1.1 compatibility;
- host probe resolved real Adobe After Effects;
- deterministic asymmetric multicolor bitmap media was imported into the disposable real-AE fixture;
- initial five-point comp-space source geometry was available;
- exact preserve-transform set-parent readback passed;
- all five comp-space geometry points were preserved by parenting within the proof tolerance;
- the protocol-1.1 checked state was refreshed after the protocol-1.4 parent mutation before render;
- the parented real-AE render was emitted;
- exact preserve-transform clear-parent readback passed;
- all five comp-space geometry points were preserved by unparenting within the proof tolerance;
- the protocol-1.1 checked state was refreshed again before the cleared render;
- initial, parented, and cleared render artifacts were all emitted;
- the exact proof-gated post-mutation P4 failure reported `M3_PARENTING_P4_INDUCED_FAILURE`;
- the host reported `Failed parenting mutation self-rolled back with AE Undo.`;
- failure-response parenting state and five-point geometry were restored;
- a fresh post-failure project observation restored the exact pre-failure structural fingerprint;
- a fresh parenting readback restored exact parenting state and five-point geometry;
- the post-rollback recovery render was emitted;
- proof-owned cleanup removed all temporary items, restored item count, and restored the original blank project fingerprint without broad harness fallback Undo.

`P5_save_reopen_reconnect_transfer` remains false and is not claimed by this tranche.

## Independent retained-artifact review

The successful Run-7 artifact was downloaded and reviewed independently of the harness after upload.

The four retained proof renders are H.264, 640x360, 24 fps, one frame each (`0.041667 s`):

- `p3-initial.mp4`
- `p3-parented.mp4`
- `p3-cleared.mp4`
- `p4-post-rollback.mp4`

The initial render is visibly nontrivial: an asymmetric multicolor source rectangle is rotated and transformed against black, with red/green/blue/yellow quadrants and a white separator. This excludes a blank-frame equivalence false positive.

All four decoded RGB24 frames are byte-for-byte identical. The decoded-pixel SHA-256 is the same for every state:

- decoded RGB24 frame hash: `0f66cf0b6a6518e05b9821f505e82660b197bc869cf7ce7d2b60db354cea4cc7`

Direct pixel-difference comparison between the initial frame and each of parented, cleared, and post-rollback frames produced an empty difference bounding box. FFmpeg PSNR comparison reports zero MSE and infinite PSNR for each comparison.

This is viewer-visible proof that, for the exercised direct-parent envelope, setting the parent does not move or distort the visible child, clearing the parent does not move or distort it, and the induced P4 failure restores the same visible result.

Container/file hashes are retained separately because independently encoded MP4 containers need not match even when decoded pixels do:

- `p3-initial.mp4`: `c58a6dda898f86e0377458de4ea4f316d984db8f584483a88c126e9976d45f9b`
- `p3-parented.mp4`: `916ee640fb411ecad6cff4d052b85da7107eee403134d35a0b683a1b16afa8f9`
- `p3-cleared.mp4`: `180fb73cdc4399f1fdf0921e5886dac3c4b6cc5893400321c4e251d06cb3d471`
- `p4-post-rollback.mp4`: `9d1574a95bd4eb48f5a6e1c7b596f8977a2dbb1b1fe60bc16ecedcc9f561e071`
- `result.json`: `cc107f47c5308f6b577ae419ac3c811ef2fe6f8ecb7db966586d2a9981873d86`

Render lifecycle marker SHA-256 values:

- initial: `7e63597226a877976d8da36e34559983a10a31f301a70a0dd21cf1616ac76394`
- parented: `fc6e55cffd637a8a65f9141b03807bef46b3c92629d419a5c039b4ad35977c97`
- cleared: `2e1649feceba23504f7ad133bb4d9be121e6d0140e15c91e76f4e6ae30b17e4a`
- post-rollback: `09ad3c035c17276180a68cbc1a3b4b9c801ee348d3f0a61e040e830d1c6dc0bd`

Every lifecycle marker is terminal `DONE`, `ok: true`, names its canonical `.mp4` output, has `error: null`, and reports `queueItemRemoved: true`.

## Real-AE hardening retained by this tranche

The earlier runs produced useful negative evidence and the final branch keeps the corresponding safeguards:

- Run 1 showed that a rotated non-uniformly-scaled parent can require shear that a normal AVLayer local Transform cannot represent. Protocol 1.4 therefore validates multi-point comp-space geometry after direct parenting and fails closed with rollback if the visible geometry drifts instead of returning a false `APPLIED` result.
- The accepted P3 fixture deliberately exercises a nontrivial but representable parent transform: translation, rotation, and uniform parent scale, while the child itself has non-uniform scale and rotation.
- Cross-protocol project revision/fingerprint safety is preserved: after each protocol-1.4 mutation, the harness performs a fresh protocol-1.1 observation before any checked render operation rather than bypassing stale-state protection.
- Successful-run disposal is owned by the proof-only cleanup layer. The Node harness verifies baseline restoration and does not issue broad fallback Undo after a proof failure.
- The self-hosted wrapper performs the full repository `npm run check` gate before installing CEP files or launching After Effects, so connector-authored ref updates cannot bypass repository validation.
- Run 6's one-off CEP registration timeout exercised no parenting traffic; Run 7 was a controlled no-source-change retry and registered successfully. A repeated registration failure would have been treated as launcher reliability evidence rather than hidden by repeated retries.

## Acceptance

**P3 is accepted by independent retained-artifact review for the exercised preserve-transform set/clear parenting envelope.** Five-point structural geometry is preserved and the initial, parented, and cleared decoded real-AE pixels are exact.

**P4 is accepted for the exercised set-parent mutation by real-AE post-mutation failure injection, AE Undo self-rollback, exact fingerprint/readback/geometry restoration, and exact decoded post-rollback visual equivalence.**

This closes the M3 parenting P3/P4 tranche without over-claiming the known direct-transform representation boundary. Parenting remains evidence-scoped and `PARTIAL`; P5 save/reopen/reconnect transfer is the next separate tranche and is not implied by this acceptance.