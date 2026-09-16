# M5 Roto Brush / Refine Edge Adapter Contract

Status: **DECLARED / ADAPTER REQUIRED / R4 EXTERNAL UI**
Milestone: `M5 Interactive AE Adapters (0.6.0-dev)`
Adapter build: `0.6.0-dev.2`

## Purpose

Roto Brush, Refine Edge, propagation, freeze, repair, and object-matte export are interactive After Effects subsystem workflows. They are not ordinary effect-property writes. This contract creates the semantic boundary before any production route is exposed.

## Semantic operations

The adapter contract defines these bounded operations:

- `INSPECT_SESSION` â€” read exact session identity/progress without mutation;
- `SEED_FOREGROUND` / `SEED_BACKGROUND` â€” evidence-bound normalized layer-space seed strokes;
- `PROPAGATE_FORWARD` / `PROPAGATE_BACKWARD` â€” bounded propagation over an explicit time range;
- `REFINE_EDGE` â€” evidence-bound normalized Refine Edge stroke geometry at an explicit frame time;
- `FREEZE` / `UNFREEZE` â€” explicit session freeze state changes;
- `REPAIR_STROKE` â€” evidence-bound manual correction after matte failure/drift;
- `EXPORT_MATTE` â€” explicit stable-ID export to `MASK` or `TRACK_MATTE` output.

All mutating operations require an exact target binding, an expected opaque session revision, and retained evidence IDs. Stroke geometry is normalized to layer space; the contract contains no screen coordinates or raw cursor instructions.

## Capability posture

Seven capability records are declared for inspect, seed, propagate, Refine Edge, freeze, repair, and export. Every route is a first-class `SUBSYSTEM_ADAPTER` and remains unavailable in the default production runtime while the milestone proof gates are incomplete. Development proof has now accepted both seed roles, bounded propagation in both directions, Refine Edge, guarded freeze/unfreeze, guarded manual repair, and the `TRACK_MATTE` form of structural export, but that proof status does not change the declared production capability posture. The `MASK` export form remains fail-closed and unproven.

The read-only inspect capability is `R0_READ_ONLY`. The public mutating capability declarations remain conservatively classified `R4_EXTERNAL_UI` while the production subsystem route is unregistered and `MASK` export remains unproven. Retained `TRACK_MATTE` development proof is an explicit exception at the implementation level: it uses the deterministic typed v1.1 `layer.duplicate` host route rather than cursor/UI mutation, with protocol-2.6 Roto readback before and after. A later production tranche may narrow the public export capability/risk posture only when its supported export kinds are registered explicitly.

No M5 Roto Brush capability is registered into the default desktop runtime in this tranche.

A draft read-only protocol 2.6.0 now defines bounded ADBE Samurai effect/session discovery. Its host layer walks a capped custom property tree (depth 5, 512 nodes), rejects ambiguous multiple-effect identity without an explicit effect index, and derives an opaque session revision from exact readback plus host project revision. The protocol is layered over the accepted 2.5 loader for development proof only; it is not installed or registered as a production capability yet.

## Guardrails

The implementation must fail closed on:

- missing/mismatched comp or layer identity;
- stale or missing session revision for mutation;
- missing mutation evidence;
- non-finite/out-of-range normalized stroke geometry;
- propagation ranges that are empty, reversed, or unbounded;
- inferred foreground/background/Refine Edge roles or implicit Refine Edge geometry;
- implicit export destination or unstable output identity;
- unexpected AE panels, dialogs, state, or target changes.

A future guarded UI implementation may translate semantic actions into verified visual interaction, but that UI driver is not the public semantic contract and must never accept unrestricted mouse/keyboard commands.

## Required readback/evidence before promotion

Before any route becomes available, retained real-AE evidence must establish:

1. exact session/target identity before action;
2. observable session revision or equivalent stale-state guard;
3. target-bound foreground/background seed application;
4. bounded propagation with progress evidence and clean stop state;
5. Refine Edge state/effect on the intended subject boundary;
6. freeze/unfreeze truth and refusal on unexpected state;
7. manual repair that visibly corrects a known matte defect;
8. export identity plus structural output readback;
9. popup/error detection with exact error capture and safe acknowledgement handling;
10. proof-owned cleanup or exact checkpoint restoration without closing/restarting the warm AE process;
11. transfer to materially different footage before `TRANSFER` maturity is claimed.

Speed claims, if made, must measure actual AE action-to-action latency. Routine warm actions should remain under the project-wide 3-second ceiling and target sub-second execution when the subsystem permits it.

## Current boundary

## Guarded seed and propagation controllers

The `REFINE_EDGE` semantic boundary is explicit and retained real-AE execution is now accepted for development proof: a request binds one finite non-negative `atTime` plus a normalized `RotoBrushStrokeV1` whose role is exactly `REFINE_EDGE`. The contract does not accept an abstract amount-only payload because that would leave the UI layer to invent where the user intended to paint. This proof acceptance does not register the Refine Edge route into the production runtime.

`GuardedRotoBrushSeedControllerV1` performs an exact protocol-2.6 pre-readback, derives both an opaque session revision and an effect-only fingerprint, validates the semantic stroke, invokes at most one verified vision+cursor seed action, then performs one exact post-readback. Success requires the same comp/layer identity, exactly one `ADBE Samurai` effect, a non-truncated property tree, and a changed effect-only fingerprint. A host-project revision change by itself cannot count as Roto Brush success. Both `SEED_FOREGROUND` and `SEED_BACKGROUND` have now passed retained real-AE proof through the same guarded controller. Background seeding is a modifier-held subtract stroke (`Alt` during the guarded drag) against an already seeded native Roto session.

`GuardedRotoBrushPropagationControllerV1` adds bounded `PROPAGATE_FORWARD` and `PROPAGATE_BACKWARD` operations over explicit frame-aligned ranges of at most 12 frames. It binds the exact comp/layer, opaque session revision, effect fingerprint, effect-match count, range, direction, and evidence IDs before any visual action. The proof-only EditGPT driver normalizes to Selection, grounds one safe point inside the already verified Layer image to acquire keyboard focus, and then issues the local frame-step batch without another semantic roundtrip between steps. On Windows the accepted Hands route is `Ctrl+Right` for forward and `Ctrl+Left` for backward. The exact post-action protocol-2.6 readback is authoritative for endpoint time; pixel motion is retained only as advisory evidence. Pure propagation must preserve the effect-only fingerprint while reaching the exact bounded endpoint.

The accepted retained forward proof advanced three frames from `0.5005005005` to `0.6256256256`; the accepted retained backward proof moved three frames from `0.5005005005` to `0.3753753754`. Propagation action-to-action gaps were approximately 92-94 ms. Including the seed bootstrap, the maximum measured warm AE action gap was 266.9 ms forward and 274.3 ms backward. Typed protocol-2.6 readback roundtrips were approximately 0.71-0.83 s. Both directions therefore satisfy the project-wide 3-second ceiling and the sub-second warm-action target.

These controllers and visual drivers remain proof-only and are not registered in the default desktop runtime. Refine Edge, guarded freeze/unfreeze, guarded manual repair, and structural `TRACK_MATTE` export now have retained development proof; `MASK` conversion, transfer, explicit popup fault injection, and production route registration remain unproven.

## Proof isolation preflight

Before the development protocol 2.6 loader or any guarded interactive action may run, the M5 proof gate must observe exactly one responsive warm AE process and a project that is unsaved, contains zero project items, reports dirty === false, and exposes a valid positive project revision. Saved, nonempty, dirty, or dirty-state-unavailable projects are refused. The preflight itself is read-only and does not load EditFlow host modules, create a project, close a project, save, clean, or issue UI actions.

The preflight itself remains intentionally read-only. Retained isolated real-AE proofs have now passed for foreground seed, background seed, three-frame forward propagation, three-frame backward propagation, Refine Edge, guarded freeze/unfreeze, guarded manual repair, and structural `TRACK_MATTE` export. `MASK` conversion, transfer, explicit popup fault injection, and production route registration remain outside this proven tranche.

## Proof-only EditGPT seed driver

`EditGptRotoBrushSeedVisualDriverV1` wraps a fixed EditGPT Eyes/Hands sidecar for `SEED_FOREGROUND` and `SEED_BACKGROUND` development proof. It correlates the exact comp/layer binding, session revision, effect-match count, time, stroke geometry, tool identity, role, and retained evidence IDs. The fixture opens the exact target with AE's native `layer.openInViewer()` route; the sidecar verifies that Layer viewer, grounds only the displayed source-image pixels (excluding empty padding), safely maximizes and rebinds the verified Layer viewer when the image is too small, maps normalized layer-space stroke points only inside that verified canvas, then selects the native Roto Brush tool through the warm CEP proof route before one guarded drag. Foreground uses the unmodified drag; background uses the same verified path with the `Alt` modifier held for the subtract gesture. Exact Roto identity is not inferred from the toolbar icon: protocol-2.6 post-readback must establish the intended native `ADBE Samurai` effect/stroke change. Post-action modal errors are inspected; only an unambiguous single OK/Close acknowledgement may be dismissed, with the visible error text retained in the refusal detail. Actual AE action-to-action latency is returned as evidence.

The visual driver advertises both proven seed roles but remains unregistered in the default desktop runtime. With structural `TRACK_MATTE` export now accepted for development proof, production promotion still requires materially different-footage transfer, popup-fault handling, and production registration. `MASK` conversion remains an unsupported export variant rather than an implied fallback.

## Retained real-AE foreground seed proof

Accepted 2026-09-15: `M5_ROTO_BRUSH_FOREGROUND_SEED_RETAINED_REAL_AE_V1` runs inside the same warm After Effects process and restores the exact saved user project in `finally`. The accepted proof used a proof-owned 3840x1600 real-video fixture, observed zero Roto effects before the action, created exactly one native `ADBE Samurai` / `Roto Brush & Refine Edge` effect, retained one `Foreground 1` stroke, and changed both the session revision and effect-only fingerprint without a truncated property tree.

The run retained visual evidence for Layer-viewer binding, Selection normalization, tool-family toolbar-state change, the guarded foreground drag, and the final seeded frame. Warm AE action-to-action gaps measured 260.0 ms and 271.2 ms; protocol-2.6 readback roundtrips measured 704.7 ms and 791.6 ms. The wrapper then restored the original clean project with the same item count, project revision, active item, and After Effects PID. This proof establishes foreground seeding only; the subsequent retained sections independently establish background seeding and bounded propagation.

## Retained real-AE background seed proof

Accepted 2026-09-15: `M5_ROTO_BRUSH_BACKGROUND_SEED_RETAINED_REAL_AE_V1` reuses the accepted foreground seed to establish one native Roto session, then applies a guarded `SEED_BACKGROUND` subtract stroke with the `Alt` modifier held only during the verified drag. Protocol-2.6 readback retained both `Foreground 1` and `Background 1` native stroke structure, exact target identity, and a non-truncated property tree. The background action gaps were approximately 266.6 ms and 265.4 ms; the proof remained in the same warm AE process and restored the exact user project afterward.

## Retained real-AE bounded propagation proof

Accepted 2026-09-15: `M5_ROTO_BRUSH_PROPAGATION_FORWARD_RETAINED_REAL_AE_V1` and `M5_ROTO_BRUSH_PROPAGATION_BACKWARD_RETAINED_REAL_AE_V1` prove symmetric bounded propagation from the same real-video fixture and warm AE process. Each proof first creates one exact foreground seed, acquires Layer-viewer keyboard focus through a safe Selection-tool canvas click, and executes a three-action local batch using `Ctrl+Right` or `Ctrl+Left`. Protocol-2.6 post-readback proves the exact three-frame endpoint, the same target, one non-truncated `ADBE Samurai` effect, and an unchanged effect-only fingerprint during pure propagation.

Forward propagation measured 92.06 ms and 93.47 ms between the three local frame-step actions; backward measured 93.53 ms and 93.11 ms. The respective whole-proof maximum warm-action gaps were 266.86 ms and 274.30 ms. Both wrappers restored the original saved clean project in `finally` without closing or restarting the After Effects process.
## Retained real-AE Refine Edge proof

Accepted 2026-09-15: `M5_ROTO_BRUSH_REFINE_EDGE_RETAINED_REAL_AE_V1` reuses the guarded foreground-seed bootstrap, applies one normalized `REFINE_EDGE` stroke to the exact bound Layer viewer, and requires protocol-2.6 native readback to increase the retained Refine Edge stroke count from zero to one without changing target identity or truncating the `ADBE Samurai` property tree. The accepted proof kept one warm AE process, restored the exact user project, and measured a maximum warm action gap of approximately 243.5 ms.

## Retained real-AE Freeze/Unfreeze proof

Accepted 2026-09-16: `M5_ROTO_BRUSH_FREEZE_STATE_DISCOVERY_RETAINED_REAL_AE_V1` starts from a verified visible `UNFROZEN` Roto Brush state, requires immediate native Freeze-processing acknowledgement after the guarded click, waits for visible `FROZEN` truth, then reuses the same verified control coordinate for `UNFREEZE` and requires visible `UNFROZEN` truth. The accepted run observed native `Freezing N of 74` progress, reached `FROZEN` after approximately 104.9 seconds, returned to `UNFROZEN` in approximately 4.5 seconds, and restored the exact pre-freeze native effect readback plus the original project. The same After Effects process identity was preserved throughout. The proof-only warm Roto/Refine setup measured a maximum AE action gap of approximately 243.3 ms and all measured routine actions were sub-second.

## Retained real-AE Repair Stroke proof

Accepted 2026-09-16: `M5_ROTO_BRUSH_REPAIR_STROKE_RETAINED_REAL_AE_V1` reuses the guarded native Roto bootstrap, establishes a visibly observed background subtract defect on the exact bound Layer viewer, then applies a same-path foreground `REPAIR_STROKE`. Acceptance requires a visible correction, an increased native foreground repair-role stroke count, a changed effect fingerprint from the defect baseline, exact target identity, and non-truncated protocol-2.6 readback. The retained run observed a defect-region changed fraction of approximately 0.00412 against the unchanged 0.002 proof threshold, preserved one warm After Effects process, restored the exact user project in `finally`, and measured a maximum AE action-to-action gap of approximately 254.8 ms; every measured warm action gap was sub-second.

## Retained real-AE TRACK_MATTE Export proof

Accepted 2026-09-16: `M5_ROTO_BRUSH_TRACK_MATTE_EXPORT_RETAINED_REAL_AE_V1` reuses one guarded foreground-seed bootstrap, binds the exact non-truncated native `ADBE Samurai` fingerprint, and exports a proof-owned layer with stable ID `M5_ROTO_TRACK_MATTE_001` through the typed v1.1 `layer.duplicate` host route. Acceptance requires one unique output stable ID, a distinct output host ID, exact source/media/timing/parent/transform/switch structure, and protocol-2.6 output readback whose native Roto effect fingerprint is byte-for-byte equivalent to the isolated source fingerprint. The retained run preserved the same warm After Effects process, restored the exact user project, measured a typed duplicate roundtrip of approximately 203.4 ms, and measured a maximum warm AE action gap of approximately 261.6 ms; every measured action/dispatch was sub-second. The `MASK` export kind remains fail-closed until an actual conversion route is proven.

## Warm-AE proof isolation roundtrip

Interactive M5 proof may enter a blank project only through a bounded same-process isolation roundtrip. Entry is allowed only from one responsive warm After Effects process with a saved, clean user project whose exact file path, item count, project revision, and active item identity have been retained before the project is closed with `DO_NOT_SAVE_CHANGES`. The runner then creates one blank unsaved project and delegates authorization to the existing read-only M5 Roto Brush preflight.

Restore is mandatory in `finally`. The retained repair and TRACK_MATTE export runners recover any surviving valid isolation state before attempting a new entry, so a prior interrupted proof cannot silently discard its restore checkpoint. The export runner additionally verifies the scheduled restore remains stable before clearing the isolation-state checkpoint. It may discard only an empty unsaved project or an unsaved project whose every item is explicitly proof-owned with the `EF2_M5_ROTO_` prefix. Any unexpected saved project or foreign unsaved item fails closed. The exact original project must reopen with its original item count, clean state, and active item, while the After Effects process identity remains unchanged. This isolation contract does not itself prove Roto Brush mutation or production readiness; it establishes the reversible environment used by the accepted protocol-2.6 + guarded visual seed and bounded-propagation proofs.
