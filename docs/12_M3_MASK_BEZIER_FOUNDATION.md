# M3 Mask / Bezier Foundation

M3 begins the Human-Parity Core at the lowest dependency needed for literal object-driven reveals: precise mask geometry.

## Protocol boundary

The accepted M2 Adobe baseline remains protocol `1.1.0`. M3 introduces a separate host command tranche, protocol `1.2.0`, so new human-parity primitives cannot inherit M2 proof maturity by accident.

Initial typed commands:

- `mask.create` -> `ae.mask.create`
- `mask.remove` -> `ae.mask.remove`
- `mask.duplicate` -> `ae.mask.duplicate`
- `mask.reorder` -> `ae.mask.order.set`
- `mask.set_path` -> `ae.mask.path.set`
- `mask.set_properties` -> `ae.mask.properties.set`
- `mask.readback` -> `ae.mask.readback`

The authenticated CEP panel advertises `1.2.0` and `1.1.0`, while every broker instance explicitly narrows the protocol tranches its current runtime is authorized to serve. Existing M2 harnesses default to `1.1.0` only. The bounded M3 mask harness explicitly opts into `[1.2.0, 1.1.0]`, so M2 setup/cleanup commands remain `1.1.0`, M3 mask commands remain `1.2.0`, and exact per-request protocol correlation is preserved.

This makes the M3 host-adapter route available at the transport layer without inheriting any M2 proof. Real-AE run `34045287361`, artifact `9992921389`, accepted against source commit `8a1c499ac26344e2199fa2fa816d4565769c312c`, independently passed the bounded M3 P1/P2 scope. All seven M3 mask capabilities are therefore `PARTIAL` + `STRUCTURAL`. They remain below visual, rollback, transfer, and robustness maturity.

## Geometry contract

A mask Shape is explicit data:

- `closed`;
- ordered 2D vertices;
- one incoming tangent per vertex;
- one outgoing tangent per vertex;
- optional variable-feather arrays (`segLocs`, `relSegLocs`, `radii`, `interps`, `tensions`, `types`, `relCornerAngles`).

Vertices and tangent arrays must have identical lengths. The host validates this before mutation. Variable-feather arrays must also have identical lengths.

`mask.set_path` accepts exactly one of:

- one static Shape; or
- strictly time-ordered Shape keyframes.

A static write refuses to silently erase existing path animation. Animated replacement is explicit.

The accepted P1/P2 run exercised exact static and animated Bezier vertices/tangents and path key times/shapes. Variable-feather arrays remain part of the typed/host contract but were not independently exercised in that acceptance run, so no separate variable-feather proof claim is made yet.

## Mask properties

The first tranche supports:

- feather;
- expansion;
- opacity;
- modes: NONE, ADD, SUBTRACT, INTERSECT, LIGHTEN, DARKEN, DIFFERENCE;
- inversion.

Structural readback returns mask identity, order, properties, current Shape, and all path keyframes. The accepted P2 run verified the exercised feather, expansion, opacity, mode, inversion, identity, order, static path, and animated path values through real-AE readback.

## Identity

This first host tranche assigns an EditFlow mask stable ID using a reserved marker in the AE mask name. P2 now proves stable identity through create/readback, duplicate, reorder, and removal inside one bounded real-AE session. That is not a P5 transfer claim. Save/reopen/reconnect identity and materially different transfer fixtures remain required before mask capabilities can reach `TRANSFER`.

## Safety

- no arbitrary JSX protocol operation;
- fixed command allowlist only;
- authenticated loopback-only broker transport;
- explicit per-runtime protocol authorization plus session negotiation and per-request correlation;
- unsupported protocols rejected before host mutation;
- host project revision required for mutations;
- full payload validation before writes;
- AE undo group around each mutation;
- failed mutations self-rollback with AE Undo when revision changed;
- `fallbackPolicy: FORBID` for the tranche.

The accepted P1 case proved one representative pre-mutation rejection: malformed tangent-array lengths produced `MASK_TANGENT_LENGTH_MISMATCH` with unchanged host revision and unchanged structural project fingerprint. Dedicated induced-host-failure rollback remains a separate P4 requirement.

## Accepted P1/P2 evidence

The bounded self-hosted Windows proof is now accepted for structural maturity:

- source commit: `8a1c499ac26344e2199fa2fa816d4565769c312c`;
- GitHub Actions run: `34045287361`;
- retained artifact ID: `9992921389`;
- host: Adobe After Effects `25.6.6x4` on Windows;
- negotiated mask protocol: `1.2.0` with `1.1.0` retained for M2 setup/cleanup;
- result: `ok: true`, `cleanupComplete: true`;
- P1 validation/rejection: pass;
- P2 structural apply/readback: pass;
- P3 visual proof: false;
- P4 failure-injection rollback: false;
- P5 save/reopen/reconnect transfer: false.

P2 exercised real mask create/readback, animated paths, properties, duplicate, reorder, final readback, and removal with exact declared invariants for the tested data. The bounded run did not independently exercise repeat/idempotency semantics for every mask command; that remains an explicit limitation for broader recipe closure rather than an implied robustness claim.

The machine-readable acceptance record is `proofs/manifests/m3-mask-p1-p2.json`.

## Remaining proof path

The mask tranche must continue climbing independently:

1. P1 validation/rejection before mutation — accepted for the bounded representative case;
2. P2 structural readback for the exercised Shape/tangent/property values — accepted at `STRUCTURAL` maturity;
3. P3 visual proof of a mask-driven compositing construction;
4. P4 induced-failure rollback and recovery;
5. P5 transfer in a materially different construction after save/reopen/reconnect;
6. P6 varied robustness and encoded failure-envelope proof where required.

`FULL` remains forbidden until P5. M2 evidence remains valid only for the baseline primitives it independently proved and is not inherited by these M3 capabilities.
