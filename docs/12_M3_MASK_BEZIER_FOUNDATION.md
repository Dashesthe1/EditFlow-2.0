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

The authenticated CEP broker and panel now support explicit multi-protocol negotiation. A dual-capability panel advertises `1.2.0` and `1.1.0`; the broker selects the highest mutual protocol for the session while preserving the protocol version of each individual request and response. M2 commands therefore remain `1.1.0`, M3 mask commands remain `1.2.0`, and a legacy 1.1-only panel cannot lease M3 traffic.

This makes the M3 host-adapter route available at the transport layer. It does **not** promote mask capability proof maturity: all seven M3 capabilities remain `PARTIAL` + `DECLARED` until their independent real-AE proof ladder begins.

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
- explicit protocol negotiation with per-request protocol correlation;
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

The next bounded step after transport regression is real-AE P1/P2 evidence on the self-hosted Windows runner. M2 evidence remains valid for the baseline primitives it proved, but is not inherited by these M3 capabilities.
