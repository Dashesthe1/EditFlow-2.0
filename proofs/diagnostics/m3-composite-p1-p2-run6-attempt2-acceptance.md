# M3 composite P1/P2 real-AE acceptance — run 6 attempt 2

- Foundation PR: #76 (`feature/m3-composite-v1_3-foundation`)
- Validated source commit: `4e949b7e75367ee70c790b38f400464d13a57f98`
- Control trigger merge: `b46d9e573a4a04cf679190e6a8267786cea63535`
- Trigger-only PR: #81
- GitHub Actions run: `34077728610`, attempt 2
- Real-AE job: `101607723351`
- Uploaded artifact: `m3-composite-p1-p2-proof-34077728610` / artifact id `10002742928`
- Artifact ZIP digest: `sha256:457f67ae8193c336339244786eef7eddff24b21c5214bfc2482b9f8ab0db2019`
- Host: Adobe After Effects 25.6.6 on the self-hosted Windows `editflow-ae` runner

## Failure diagnosis and repair

The preceding live-host run proved protocol 1.3 registration, all four track-matte modes, arbitrary non-adjacent matte selection without layer reordering, and all 38 documented blend modes, but its P2 clear assertion was wrong. After Effects 23+ `AVLayer.removeTrackMatte()` removes the active matte relationship while preserving the previous `trackMatteType` as dormant host state. The proof incorrectly required `NO_TRACK_MATTE` after clear.

The accepted correction keeps the host implementation unchanged and fixes the proof contract: after clear, `hasTrackMatte` must be false and `trackMatteLayer` null, while `trackMatteType` must preserve the previously selected type. Normal PR CI passed on source commit `4e949b7e75367ee70c790b38f400464d13a57f98` before the live-host rerun.

Run 6 attempt 1 did not exercise the proof because the safety preflight found an already-running After Effects process. The live session was inspected separately and was an empty, clean Untitled Project with zero items and no unsaved changes. After it was closed, the same control commit was rerun without code changes as attempt 2.

## Automated proof result

The retained `result.json` reports `ok: true`, `status: PASS`, `cleanupComplete: true`, no failure error, and no cleanup errors. Both `P1_validation_rejection` and `P2_structural_readback` are true. P3 visual proof, P4 failure-injection rollback, and P5 save/reopen/reconnect transfer remain false and are not claimed by this acceptance.

All required P1/P2 checks are true, including:

- protocol 1.3 panel negotiation with protocol 1.1 compatibility;
- live Adobe After Effects host probe;
- three AV-layer fixture with a non-adjacent matte source and spacer preserved between target and matte;
- deterministic self-matte rejection with unchanged host revision and structural fingerprint;
- deterministic stale-host-revision rejection with unchanged host revision and structural fingerprint;
- exact initial composite readback;
- ALPHA, ALPHA_INVERTED, LUMA, and LUMA_INVERTED track mattes;
- arbitrary matte source assignment without silent layer reordering;
- clear matte semantics with no active matte and preserved dormant host track-matte type;
- all 38 documented blend modes;
- restoration to NORMAL blend mode;
- exact final structural readback and preserved layer order;
- proof-only cleanup returning the project to zero items.

The authenticated CEP session id was `b3536d1a-6b6b-434a-ab2a-0878c59ea209` on protocol 1.3.0. The runner launched only its owned After Effects process set and confirmed zero After Effects processes after cleanup.

## Retained evidence hashes

- `result.json`: `f8ee599642ccd2f3ea96d8c094293e2a5f2d9dbbea498ec0cae7009941428c98`
- `panel-bootstrap.log`: `aeed177cede13a1abfd2756458e7fd1483835cd107d36d27076918e36b694cd4`
- `startup-diagnostics.log`: `c9b88034ef2c7110108edb833c41fc9e5be32397bece69cd0f5c4718d152e64c`

## Acceptance

**M3 composite P1 validation/rejection and P2 exact structural readback are accepted on real After Effects.**

The four protocol 1.3 composite capabilities (`ae.layer.track_matte.set`, `ae.layer.track_matte.clear`, `ae.layer.blend_mode.set`, and `ae.layer.composite.readback`) are promoted from DECLARED to STRUCTURAL proof maturity while remaining PARTIAL. This does not claim P3 visual, P4 rollback, or P5 transfer maturity; those remain separate follow-on proof work.
