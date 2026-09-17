# M5 Mocha AE Adapter Contract

Status: **DISCOVERY + APPLY + LAUNCH + PLANAR REGION + BOUNDED PLANAR TRACKING PROVEN / REPAIR + EXPORT UNAVAILABLE**
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

## Apply/launch proof gate

The next gate is a guarded `APPLY_MOCHA_EFFECT -> LAUNCH_SESSION` development proof. It must:

1. bind an exact proof-owned comp/layer fixture while preserving the user's saved project;
2. apply only match name `mochaAECC` and verify exactly one intended effect instance;
3. launch Mocha only from that verified effect/session;
4. prove the expected Mocha-owned UI/process/window identity rather than inferring success from a click;
5. capture and safely handle any modal/error state;
6. restore the exact pre-proof project and preserve the same After Effects PID;
7. measure actual AE action-to-action latency for routine host actions.

## Accepted real-AE effect-apply proof

Accepted 2026-09-16: `M5_MOCHA_AE_APPLY_RETAINED_REAL_AE_V1` uses a separately namespaced proof-owned blank project, imports the current file-backed footage, and adds exactly one `mochaAECC` effect to one proof-owned AV layer. Exact structural readback reports display name `Mocha AE`, one effect instance, and a capped 62-node property tree.

The retained tree exposes `Launch Mocha AE` as property index `5` with match name `mochaAECC-2353`, alongside tracking/export surfaces including `Tracking Data`, corner points, center, rotation, scale, export option, and layer-export target controls. This is discovery evidence only; the proof does not infer that those properties are safely writable or clickable from scripting.

The accepted run preserved After Effects PID `16404`, restored the exact saved project at revision `126` with all seven restore checks true, and logged no script-error popup. Measured warm roundtrips were approximately 743 ms for source binding, 727 ms for isolation entry, 2042 ms for import+effect+structural readback, and 1018 ms for exact restore. All remained below the 3-second ceiling.

This proof authorizes `APPLY_MOCHA_EFFECT` development evidence only. It does not by itself authorize `LAUNCH_SESSION`, planar region creation, tracking, repair, or export.

## Accepted real-AE launch proof

Accepted 2026-09-16: `M5_MOCHA_AE_LAUNCH_RETAINED_REAL_AE_V1` recreated the proof-owned `mochaAECC` binding, activated the verified Effect Controls target, grounded the single bounded Mocha launch mark on two fresh physical-screen captures, and delivered one guarded physical click while After Effects PID `16404` remained the foreground receiver. The action launched exactly one responsive `mocha4ae_adobe.exe` session from the installed After Effects Mocha bundle; the executable path, Boris FX company identity, version `12.2.0.48`, and `Mocha AE` window title were verified before cleanup.

The proof began with no pre-existing Mocha session, detected the exact first-run `Registration` modal when present, invoked only the fixed `Register later` action, verified the unobstructed `Mocha AE` workspace, closed only the proof-owned Mocha process, restored the exact saved project at revision `126`, and preserved the same After Effects PID. The hardened retained rerun measured approximately 879 ms for source binding, 768 ms for isolation entry, 830 ms for effect application, 785 ms for Effect Controls preparation, 1197 ms for Effect Controls activation, and 1138 ms for exact restore. The maximum measured warm AE roundtrip was `1197.256 ms`, below the 3-second ceiling. Registration handling took approximately `996.543 ms` end-to-end with an `11.635 ms` UIA invoke, while guarded click-to-responsive-Mocha-window verification took approximately `5.639 s`; neither external/UI verification duration is counted as a warm AE action gap.

This proof authorizes `LAUNCH_SESSION` development evidence for the exact retained Mocha identity and guarded route. It does not authorize spline creation, planar tracking, repair, or export.

## Accepted real-AE planar-region proof

Accepted 2026-09-16: `M5_MOCHA_AE_CREATE_PLANAR_REGION_RETAINED_REAL_AE_V1` reuses the proven warm AE/Mocha launch route, clears only the exact known first-run `Thank you from Boris FX` and `Welcome to Mocha AE` prompts, verifies the final `Mocha AE` main-window identity, and selects the exact `Create X-spline Layer` control before mutation.

The retained action creates one explicit bounded four-point X-Spline region and verifies delivery stayed inside the proof-owned Mocha process. Independent UI Automation readback finds exactly one `Layer 1`. The passing run then closes only the proof-owned Mocha session, restores the exact saved AE project at revision `126`, preserves the same After Effects process, and records a maximum measured warm AE roundtrip of `1220.155 ms`. The bounded planar-region action batch itself was approximately `1628.003 ms`; click-to-responsive-Mocha-window and startup-prompt handling remain external/UI verification time, not warm AE action gaps. Closing the modified proof-owned Mocha session verifies the exact unsaved-project prompt and invokes only the exact `Don't Save` button; no force-kill was required.

This proof authorizes `CREATE_PLANAR_REGION` development evidence for the exact retained Mocha session. It does not authorize planar tracking, repair, or export.

## Accepted real-AE bounded planar-tracking proof

Accepted 2026-09-16: `M5_MOCHA_AE_PLANAR_TRACKING_RETAINED_REAL_AE_V1` reuses the proven warm AE/Mocha launch and bounded X-Spline path, moves only through the exact Mocha timeline transport identity to seed frame `1`, then invokes the exact single-frame semantic controls `Track To Next Frame` and `Track To Previous Frame`. The retained range is deliberately bounded to frames `0..2`; it does not invoke Mocha's unbounded `Track Forwards`, `Track Backwards`, or combined continuous-tracking controls.

Independent UI Automation readback verifies actual tracked-range progress rather than click delivery: after the forward solve, `Next Tracked End` resolves frame `2`; after the backward solve, `Previous Tracked End` resolves frame `0`. Exactly one proof-owned `Layer 1` remains bound throughout. The accepted run measured approximately `103.305 ms` for the exact seed transport, `551.672 ms` for the one-frame forward solve with a `31.179 ms` tracked-end readback, and `137.557 ms` for the one-frame backward solve with a `48.339 ms` tracked-end readback. Solver time is reported separately from routine warm-host action latency.

After tracking, the proof closed only the proof-owned Mocha session without force-kill, restored the exact saved project at revision `126` with `dirty=false`, and preserved After Effects PID `16404`. The maximum measured warm AE roundtrip was `1208.451 ms`, below the 3-second ceiling. Guarded click-to-responsive-Mocha verification was approximately `5.939 s` and remains external/UI verification time rather than a warm AE action gap.

This proof authorizes bounded `TRACK_FORWARD` / `TRACK_BACKWARD` development evidence only for the exact retained single-frame semantic route. It does not authorize repair or export.

## Current next gate

The next retained gate is `REPAIR_TRACK`: create or identify one explicit proof-owned tracking defect over a bounded frame range, bind the exact affected planar region and correction frame(s), perform only the intended manual correction path, independently verify the repaired planar trajectory/data, then close the proof-owned session and restore the exact saved AE project without restarting AE. `EXPORT_TRACK` / `EXPORT_ROTO` remain separately gated.