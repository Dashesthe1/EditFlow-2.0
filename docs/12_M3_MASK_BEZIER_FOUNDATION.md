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

This makes the M3 host-adapter route available at the transport layer. It does **not** promote mask capability proof maturity: all seven M3 capabilities remain `PARTIAL` + `DECLARED` until their independent real-AE proof evidence is accepted.

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

## Mask properties

The first tranche supports:

- feather;
- expansion;
- opacity;
- modes: NONE, ADD, SUBTRACT, INTERSECT, LIGHTEN, DARKEN, DIFFERENCE;
- inversion.

Structural readback returns mask identity, order, properties, current Shape, and all path keyframes.

## Identity

This first host tranche assigns an EditFlow mask stable ID using a reserved marker in the AE mask name. The marker is intentionally treated as an implementation-stage identity mechanism, not yet a P5 transfer claim. The M3 proof ladder must validate identity through reorder/duplicate/save/reopen/reconnect before mask capabilities can reach TRANSFER.

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

## Proof path

The mask tranche must independently climb:

1. P1 validation/rejection before mutation;
2. P2 structural readback for exact Shape/tangent/property values;
3. P3 visual proof of the mask-driven reveal;
4. P4 induced-failure rollback;
5. P5 transfer in a materially different construction after save/reopen/reconnect.

A dedicated bounded self-hosted Windows harness now exists for P1/P2. It cold-launches an isolated After Effects instance from a zero-AE baseline, uses the fixed repository CEP bootstrap, proves invalid tangent geometry is rejected without revision/fingerprint change, then exercises real mask create/readback, animated paths, properties, duplicate/reorder/remove and exact structural readback. Its result schema explicitly leaves P3, P4 and P5 false. This harness is implementation infrastructure only; no new real-AE proof maturity is claimed until an accepted runner artifact passes.

M2 evidence remains valid for the baseline primitives it proved, but is not inherited by these M3 capabilities.
