# M3 temporal-ease P3/P4 real-AE acceptance — control run 2

- Feature PR: #123 (`chatgpt/m3-temporal-ease-p3-p4-draft`)
- Accepted base on `main` at proof time: `c01cf27a3b18fe5f869f829cb6936b4f1aa8ff91`
- Exact feature source commit under proof: `2a9d50f0099278dede792ed1203e338f52dfe122`
- Real-AE control workflow commit: `436b12fa12fdb1bba382ac8990948d0a58d6ce81`
- Real-AE control/trigger commit: `b1b8542b53f49ff63689ee51bf5095a767f754f5`
- Repository CI on feature source before AE launch: run `34176886886` / success
- Pixel-verifier synthetic suite on feature source before AE launch: run `34176886859` / success
- GitHub Actions real-AE run: `34176960701`, control run 2, attempt 1 / success
- Real-AE job: `101908166885`
- Uploaded artifact: `m3-temporal-ease-p3-p4-control-proof-34176960701` / artifact id `10037617172`
- Artifact ZIP digest reported by GitHub: `sha256:e12076fce752dc2eac4b23939d40d2fd839a1d44095ce0aaad3ee4b51fd15903`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- Accepted P1/P2 source run: `34176061647`; artifact id `10037290595`; retained `result.json` SHA-256 `2c07b73f956c1e71aff94941c7aabe6159c9b04ef976048a4eb325f916be3230`

## Automated proof result

The retained `result.json` reports:

- `proofId: M3_TEMPORAL_EASE_P3_P4_REAL_AE`
- `status: VISUAL_REVIEW_REQUIRED`
- `ok: true`
- `cleanupComplete: true`
- `cleanupStrategy: PROOF_OWNED_CLOSE_WITHOUT_SAVE_NEW_PROJECT_EXACT_BASELINE_VERIFY`
- `cleanupUndoBarrierObserved: true`
- `cleanupUndoCount: 60`
- `cleanupErrors: []`
- `failureError: null`
- `P1_validation_rejection: true`
- `P2_structural_readback: true`
- `P3_visual_artifact_emitted: true`
- `P3_visual_proof: false` before independent review
- `P4_failure_injection_rollback: true`
- `P5_save_reopen_reconnect_transfer: false`

The harness intentionally cannot accept its own P3 pixels. Independent retained-artifact review below is the acceptance step.

The proof retained AE's native manual-BEZIER ease state for provenance, then established a legal deterministic protocol-1.8 writable baseline at speed `0`, incoming influence `20`, outgoing influence `20`. The visual contrast state changed only the middle Opacity key's temporal ease to speed `0`, influence `80` in/out, while preserving the three key times and values `(0,0)`, `(0.5,100)`, `(1,0)`. Restoration wrote the exact legal baseline through the public protocol.

P4 injected a proof-gated failure only after a real protocol-1.8 temporal-ease mutation had applied and passed readback verification. The failed response reported the expected proof injection, the transaction rolled back through the AE Undo boundary, fresh readback restored the exact pre-failure ease state, fingerprint, and item count, and a post-rollback recovery render was emitted.

Generic Undo cleanup reached the known asynchronous render-history barrier at its bounded 60-attempt limit. The isolated proof-owned cleanup then validated fixture ownership, closed the disposable unsaved project without saving changes, created a new project, and independently verified the exact pre-proof blank baseline.

Exact cleanup evidence:

- baseline fingerprint: `project:sha256:0a1f2ab2a77b28d4a483592a7e59b2f1614ce3012a85ef680a97ffbbd9b10440`, item count `0`, file path `null`;
- proof-owned cleanup result: `ok: true`, `error: null`, blank item count `0`;
- independent cleanup verification: the same fingerprint, item count `0`, file path `null`, status `EXACT_MATCH`, `exact: true`.

`P5_save_reopen_reconnect_transfer` remains false and is not claimed by this tranche.

## Canonical render artifact correction

The proof record names requested `.avi` render paths, but the production `render.capture` path retained canonical H.264 `.mp4` media and sibling `.avi.editflow-render.json` completion markers. The original offline verifier had hard-coded AVI media input and therefore could not directly consume the actual retained production archive.

That test-infrastructure mismatch was corrected after the real-AE run without changing the Adobe mutation path, proof fixture, retained evidence bytes, or acceptance thresholds. Verifier V2 keeps the requested AVI identity, but when a canonical output exists it requires the marker and MP4 together, verifies the marker reports schema 1, `DONE`, `ok: true`, `error: null`, a positive completion time and `queueItemRemoved: true`, verifies the marker's `outputPath` basename is the exact expected MP4, and then decodes that retained MP4. It fails closed if only one member of the canonical pair exists. Legacy/synthetic AVI fixtures remain supported only when neither canonical artifact is present.

Verifier correction source: commit `2df034edb82c541c6c37d6cd0a27a26ddb79dc4a` (documentation follow-up `0749bc21da4cfa9d099b9af781de44415ee0fbde`). The corrected verifier was executed independently against the downloaded run-`34176960701` archive and the exact downloaded P1/P2 dependency bytes.

## Independent decoded-pixel review

All four retained canonical renders are H.264 MP4, 320x320, 24 fps, exactly 24 frames and one second long. FFprobe reports ordered presentation timestamps `0/24` through `23/24`; the key at exactly one second is intentionally outside this render and is not visually claimed.

Verifier V2 returned:

- `verifier: M3_TEMPORAL_EASE_P3_P4_PIXEL_SCREEN_V2`
- `status: PIXEL_CHECKS_PASSED_REVIEW_REQUIRED`
- `ok: true`
- `baseline_is_not_static: true`
- `first_key_pixels_unchanged: true`
- `middle_key_pixels_unchanged: true`
- `visible_incoming_ease: true`
- `visible_outgoing_ease: true`
- `exact_restore_all_frames: true`
- `exact_rollback_all_frames: true`

The explicit visibility threshold is mean absolute RGB-channel delta at least `3` plus at least `25%` of pixels having maximum channel delta at least `8`. Under that threshold, the changed-ease render is viewer-visible on ten frames before the middle key (`1..10`) and ten frames after it (`14..23`). Frames 0 and 12 remain pixel-exact to baseline.

At representative frame 6 (`0.25 s`):

- baseline decoded frame SHA-256: `d1fbcbc5e127e06432035cc3b94d91d4c31f164beaaa42010a5787f7f3621f0b`, mean RGB approximately `(112.75, 80.50, 147.50)`;
- influence-80 decoded frame SHA-256: `e0d683e956b575c7fd5a78af25e6c82408811d46415f14daa2355a97e9150c7d`, mean RGB approximately `(73.25, 100.75, 190.25)`.

Frame 18 (`0.75 s`) has the same respective baseline/eased signatures because the fixed fixture is temporally symmetric. The difference is large and visually obvious, while the actual keyframe images are unchanged.

Decoded RGB full-stream SHA-256 values:

- baseline: `5f62b32ab1a800fa4b9d39cdfdfc1286edb658b03db75b5793eb9ca8efe92de0`
- influence-80 ease: `8d75722a30bd9ba4c2b70f66953c6c76866ba4db7cae7929361dfe43907b53b2`
- restored baseline: `5f62b32ab1a800fa4b9d39cdfdfc1286edb658b03db75b5793eb9ca8efe92de0`
- post-rollback baseline: `5f62b32ab1a800fa4b9d39cdfdfc1286edb658b03db75b5793eb9ca8efe92de0`

Thus every decoded RGB byte of the restored-baseline stream is identical to the original baseline, and every decoded RGB byte of the post-rollback stream is also identical to the original baseline.

## Retained evidence hashes

- `result.json`: `63319df2e71c1ae09a8ae4941d82f6faf7d3e06aaa37bd8f26f566e731934630`
- `cleanup-baseline.json`: `261b53f417bb9130b75a5270b62fa368eb509682d11f1d337eb35a05909995f3`
- `cleanup-result.json`: `f394ec21184603aa8395371c2c01f264605d993f182223079cd9c9a71528e8aa`
- `cleanup-verify.json`: `b3e2915a5527405f5d107b6d4c5c9b33ecd269ff08de9e35127c5e3e7a7b5121`
- `p3-baseline.mp4`: `f7419ca21bbb9850c8b1ed5f0b0b93c64607e448a7052d04a5cb4f774950fdf1`
- `p3-zero-speed-high-influence.mp4`: `67da795208f91db8dc75594f143a8ddf95b50e51a81299462a42219bf69a6b7a`
- `p3-restored-baseline.mp4`: `a504610a391904e7d19ceed06e7b930ca4f158c18236e2de68c68c3bb9019b03`
- `p4-post-rollback-baseline.mp4`: `a37c629185f9677cde74554a3f7cf705eaeb72c7d6246f9a8f04642de2e2cf47`
- warm background source bitmap: `0bd3fe9ac254f06bf0f741029309c1cf329aa0af0721d31608b20ddcb713c073`
- cool foreground source bitmap: `6d92483f8bf4531fcf76c4e2dacf7d70c4faa4eeee5a16536b3f66882fa96516`
- `panel-bootstrap.log`: `28940915c76cc027168b9508d2b4a328fb7c2f4eaed126c38a22262268bcf4cf`
- `startup-diagnostics.log`: `e373a494eeacfe8d1a8c5b22c97172a73b63435275ee1cc5805d038618adbbfa`

Render-completion marker SHA-256 values:

- baseline: `debdd46185e945200eb8f9e4e22c7adeec1ea98cc9281480cc966ebdcafa4bf4`
- influence-80 ease: `ca9582d47ea9e6f06822dda5c5eb94510fefab4a41ead8b61df86e510e6062d9`
- restored baseline: `710802315ffb3265f3c8d942e3dd1aa7909c0fd60b6fb99ec3e5779e4ab4b46b`
- post-rollback baseline: `caa112fa4ccabd9474dc7ed024595afc917d9691790f30b408ac95927923a8ac`

## External semantic cross-check

Current After Effects documentation independently matches the proof interpretation:

- Adobe's Graph Editor/keyframe-velocity documentation explains that temporal speed and influence control the speed graph, and that influence determines how quickly the graph approaches a keyframe's speed: https://helpx.adobe.com/after-effects/using/speed.html
- The After Effects Scripting Guide documents `KeyframeEase(speed, influence)`, the writable influence range, per-dimensional temporal-ease arrays, and `Property.setTemporalEaseAtKey()`: https://ae-scripting.docsforadobe.dev/other/keyframeease/ and https://ae-scripting.docsforadobe.dev/property/property/

The retained real-AE structure and pixels, not the documentation, are the acceptance authority.

## Acceptance

**P3 is accepted by independent retained-artifact review for the exercised protocol-1.8 scalar Opacity temporal-ease envelope.** With identical keyframe times and values, changing only the middle key's legal `KeyframeEase` influence from 20 to 80 produces a strong two-sided viewer-visible timing difference while preserving the rendered key images; restoring influence 20 restores the entire decoded baseline stream exactly.

**P4 is accepted for the same exercised envelope by proof-gated post-verification failure injection, AE Undo self-rollback, exact ease-state/fingerprint/item-count restoration, and pixel-exact post-rollback visual preservation.**

This does not claim P5 transfer, spatial Graph Editor tangents, roving keys, value-graph editing, arbitrary effect-property ease, or visual proof for every multidimensional property shape. Protocol-1.8 temporal ease remains evidence-scoped and `PARTIAL`; save/reopen/reconnect transfer is the next separate gate.