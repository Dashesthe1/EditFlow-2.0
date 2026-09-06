# M2 After Effects Host Baseline — Accepted

EditFlow 2.0 `0.3.0-dev` closes M2 with the clean-room After Effects host baseline accepted on the target Windows / After Effects 2025 environment.

## Accepted baseline

The production protocol is AE adapter protocol `1.1.0` through the authenticated local CEP bridge. The fixed typed command surface covers:

- host probe and project inspection;
- project save;
- composition create/settings/remove;
- media import;
- layer create/duplicate/remove/reorder;
- exact 2D transform readback including anchor point;
- layer timing;
- effect add/remove/property writes;
- keyframe create/update/delete;
- expressions;
- precompose with stable child/replacement identity;
- render capture;
- object readback;
- transaction undo.

Arbitrary JSX/JavaScript is not a protocol operation. CEP dispatch remains a fixed `EditFlow2_dispatch(serializedRequest)` call, and the host selects only from its checked-in command table.

## Real-AE evidence

### Authenticated bounded + final baseline

GitHub Actions run `34022332767` executed on the self-hosted Windows AE workstation against After Effects `25.6.6` from accepted source commit `8d5f8ddf0143ce0e1ec33cff14269ecab8769d60`.

The run proved:

- authenticated CEP panel bootstrap and loopback broker registration;
- typed protocol 1.1 host dispatch;
- bounded P1/P2/P3 structural and visual proof;
- real render capture to `m2-proof.mp4`;
- final baseline composition/layer/effect/keyframe/media CRUD and exact readback;
- transform vector readback including anchor point/position/scale;
- cleanup back to the original project-item count.

The bounded result reports `PARTIAL_PASS` by design because that script intentionally delegates P4 failure injection and P5 save/reopen/reconnect to the dedicated disposable proof. The same workflow's final-baseline result reports `PASS`.

### Dedicated P4/P5

GitHub Actions run `34013038916` reports `PASS` for the disposable proof. It verifies:

- induced failure plus transaction rollback;
- stable identity through external rename;
- duplicate and reorder identity;
- precompose child and replacement identity;
- project save and reopen;
- dispatcher reconnect;
- stable-ID readback after reopen;
- a post-reconnect transfer operation and cleanup.

## Capability maturity policy

M2 acceptance enables real Adobe writes, but it does **not** promote every baseline primitive to `FULL`.

Per `docs/05_PROOF_AND_ACCEPTANCE.md`, `FULL` requires P5/`TRANSFER` evidence. The runtime capability registry therefore applies the accepted M2 evidence map:

- P5 stable-identity/transfer primitives are `FULL` + `TRANSFER`;
- visual-but-not-P5 primitives remain `PARTIAL` + `VISUAL`;
- rollback-proven primitives remain `PARTIAL` + `ROLLBACK` unless they also have P5;
- structural-only primitives remain `PARTIAL` + `STRUCTURAL`.

This prevents M2 closure from overstating human-parity maturity.

## Runtime state

The MCP status contract now reports:

- product version `0.3.0-dev`;
- phase `M2_ADOBE_HOST_BASELINE_ACCEPTED`;
- `adobeWritesEnabled: true`;
- authenticated CEP bridge `REAL_AE_PROVEN`;
- real-AE acceptance `P1_P5_ACCEPTED`.

The transaction/recovery guarantees remain active: committed-boundary resume, failed-mutation self-rollback, stable IDs, host revision checks, structural fingerprints, and guarded filesystem paths.

## Next milestone

M3 (`0.4.0-dev`) begins the Human-Parity Core: masks and animated Bezier geometry, track mattes, blend modes, parenting/null rigs, exact interpolation/Graph Editor controls, markers, motion blur, frame blending, and shutter controls. Each new primitive must climb the proof ladder independently; M2 acceptance is not inherited as proof for M3 capabilities.
