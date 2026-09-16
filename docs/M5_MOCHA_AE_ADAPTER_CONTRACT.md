# M5 Mocha AE Adapter Contract

Status: **DISCOVERY PROVEN / MUTATION UNAVAILABLE**
Milestone: `M5 Interactive AE Adapters (0.6.0-dev)`

## Purpose

Mocha AE planar tracking and roto are interactive subsystem workflows, not ordinary effect-property writes. This contract defines the semantic boundary for a guarded Mocha AE adapter and the evidence required before any mutating route can be exposed.

## Semantic operations

The planned bounded operations are:

- `INSPECT_AVAILABILITY` - read exact installed plugin identity and host compatibility without mutation;
- `APPLY_MOCHA_EFFECT` - add the exact registered Mocha AE effect to one bound AV layer;
- `LAUNCH_SESSION` - open the Mocha UI for that exact layer/effect session;
- `CREATE_PLANAR_REGION` - create one explicitly described planar spline/region;
- `TRACK_FORWARD` / `TRACK_BACKWARD` - bounded planar tracking over an explicit frame range;
- `REPAIR_TRACK` - explicit manual correction of a known drift/failure;
- `EXPORT_TRACK` - export a typed AE result such as transform or corner-pin tracking data;
- `EXPORT_ROTO` - export verified Mocha roto/shape data through a stable AE-side output.

Mutating operations require exact comp/layer identity, expected session revision, bounded time/range inputs, retained evidence IDs, and post-action readback where the host exposes it.

## Guardrails

The adapter must fail closed on:

- missing or ambiguous Mocha AE plugin identity;
- target comp/layer drift;
- stale session revision;
- inferred planar geometry or unbounded track ranges;
- unexpected Mocha/AE windows, modal dialogs, or license/error state;
- export destination ambiguity;
- missing proof-owned cleanup or exact project restoration.

The public adapter must never accept unrestricted mouse coordinates, arbitrary typing, or an unbounded desktop-control request.

## Accepted real-AE discovery proof

Accepted 2026-09-16: `M5_MOCHA_AE_DISCOVERY_RETAINED_REAL_AE_V1` performs a read-only enumeration through After Effects' registered effect metadata while reusing the already-running host process.

The retained proof established:

- After Effects host `25.6.6x4` remained on PID `16404`;
- the exact installed effect is display name `Mocha AE`, match name `mochaAECC`, category `Boris FX Mocha`, version `12.2`;
- the current AV-layer effect parade reports the exact Mocha match name as addable;
- project revision and item count were unchanged across the probe;
- no mutation or cleanup action was required;
- no AE launch or restart occurred;
- the live AE discovery roundtrip was approximately `795.841 ms`.

This proof authorizes discovery/availability knowledge only. It does not authorize adding the effect, launching Mocha, drawing splines, tracking, repair, or export.

## Next proof gate

The next gate is a guarded `APPLY_MOCHA_EFFECT -> LAUNCH_SESSION` development proof. It must:

1. bind an exact proof-owned comp/layer fixture while preserving the user's saved project;
2. apply only match name `mochaAECC` and verify exactly one intended effect instance;
3. launch Mocha only from that verified effect/session;
4. prove the expected Mocha-owned UI/process/window identity rather than inferring success from a click;
5. capture and safely handle any modal/error state;
6. restore the exact pre-proof project and preserve the same After Effects PID;
7. measure actual AE action-to-action latency for routine host actions.
