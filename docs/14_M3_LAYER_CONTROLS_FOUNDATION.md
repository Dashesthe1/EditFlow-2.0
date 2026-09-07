# M3 Layer Switches and Quality Controls Foundation

## Scope

This document defines the protocol-1.6 foundation for M3 roadmap item 8, **complete layer switches/order controls**.

Protocol 1.6 adds typed control and exact readback for script-writable timeline switches and quality controls that are not already owned by an accepted EditFlow route. It intentionally composes with the existing accepted `ae.layer.order.set` capability rather than introducing a second order implementation.

### Layer-level controls

Generic Layer controls:

- `enabled` — Video switch / layer enabled state;
- `solo`;
- `shy`;
- `locked`.

AV-layer controls:

- `audioEnabled`;
- `adjustmentLayer`;
- `collapseTransformation` / Continuous Rasterize where After Effects reports it is settable;
- `effectsActive`;
- `guideLayer`;
- `preserveTransparency`;
- `quality` — `BEST`, `DRAFT`, or `WIREFRAME`;
- `samplingQuality` — `BILINEAR` or `BICUBIC`;
- `threeDLayer`.

Composition-level timeline control:

- `hideShyLayers` — the master Hide All Shy Layers switch.

Every layer readback also returns the current layer index. Protocol 1.6 never changes that index; reorder writes remain on the accepted `ae.layer.order.set` route.

## External host-semantics references

The contract is grounded in the current After Effects scripting object model rather than inferred from Timeline UI appearance alone:

- AVLayer reference: <https://ae-scripting.docsforadobe.dev/layer/avlayer/>
- Layer reference: <https://ae-scripting.docsforadobe.dev/layer/layer/>
- PropertyBase reference (`enabled` / `canSetEnabled`): <https://ae-scripting.docsforadobe.dev/property/propertybase/>
- CompItem reference (`hideShyLayers`): <https://ae-scripting.docsforadobe.dev/item/compitem/>
- Adobe layer-switch overview: <https://helpx.adobe.com/after-effects/using/layers.html>

Important consequences from those references:

1. A Timeline-looking switch is not automatically a writable Boolean. `frameBlending` on AVLayer is read-only; the writable semantic control is `frameBlendingType`. Frame blending is therefore excluded from protocol 1.6 and remains roadmap item 12.
2. `collapseTransformation` is writable only when `canSetCollapseTransformation` says the host can set it. Protocol 1.6 preflights that legality and rejects before mutation rather than approximating.
3. `audioEnabled` is AV-layer state and is only changed when the layer actually has audio.
4. `quality` and `samplingQuality` are typed After Effects enums, not arbitrary strings.
5. `hideShyLayers` is composition state distinct from each layer's `shy` flag, so both are required for complete shy workflow control.

## Typed protocol

Protocol version: `1.6.0`

Adapter build: `0.4.0-dev.6`

Route: `ae-cep.layer-controls.v1_6`

Commands:

- `layer.controls.set` → `ae.layer.controls.set`
- `layer.controls.readback` → `ae.layer.controls.readback`
- `comp.layer_controls.set` → `ae.comp.layer_controls.set`
- `comp.layer_controls.readback` → `ae.comp.layer_controls.readback`

All four capabilities begin `PARTIAL` + `DECLARED`. No structural maturity is claimed until independent real-After-Effects P1/P2 evidence is accepted.

## Safety and exactness rules

### Stable target identity

Every operation resolves the target composition and layer by EditFlow stable ID and/or host ID. A target must resolve inside the requested composition; no selection-based or active-layer mutation is permitted.

### Stale-state protection

Mutating commands require `expectedHostProjectRevision`. A host revision mismatch rejects before mutation.

### Lock ordering

EditFlow never silently unlocks a layer in order to change another control.

- If a layer is already locked and a patch requests any non-lock change, the same patch must explicitly request `locked:false`.
- That explicit unlock is applied first.
- A requested final `locked:true` is applied last, after every other requested control.

This preserves both user intent and transactional reachability of the requested final state.

### Legality preflight

Before opening an undo group, protocol 1.6 validates:

- recognized control names and exact value types;
- AV-only controls are not requested on non-AV layers;
- `canSetEnabled` before changing `enabled`;
- `hasAudio` before changing `audioEnabled`;
- `canSetCollapseTransformation` before changing collapse/continuous-rasterize state;
- quality and sampling-quality enum membership;
- lock-state requirements.

Unsupported or illegal writes reject without mutation. There is no UI fallback and no silent degradation.

### Idempotency and readback

If every requested value already equals exact host readback, the set command returns `NO_OP` and does not mutate After Effects.

After any applied write, the complete target state is read back and every requested field must equal the requested value. A mismatch fails the operation and invokes the AE undo boundary.

### Order preservation

Protocol 1.6 contains no `moveBefore`, `moveAfter`, `moveToBeginning`, or `moveToEnd` behavior. The layer index is read back before/after switch mutations so P1/P2 can prove switch changes do not silently reorder layers.

## Deliberate exclusions

These remain separate roadmap capabilities and are invalid protocol-1.6 control fields:

- frame blending / `frameBlendingType`;
- motion blur;
- composition motion-blur master state;
- shutter angle / shutter phase;
- markers.

Time remapping, per-character text 3D, environment-layer behavior, and other specialized animation/3D controls are also not implied by this tranche merely because After Effects exposes script properties for them.

## P1/P2 acceptance target

The first real-AE proof must start from a disposable deterministic fixture and demonstrate at minimum:

1. authenticated protocol 1.6 negotiation while accepted 1.1-1.5 remain available;
2. exact stable-ID target resolution;
3. deterministic rejection for unknown controls, AV-only controls on an incompatible layer, unavailable audio/collapse writes, locked-layer conflicts, and stale host revision;
4. exact readback for all exercised generic and AV-layer controls;
5. exact readback and mutation of `hideShyLayers`;
6. `BEST`/`DRAFT`/`WIREFRAME` and `BILINEAR`/`BICUBIC` typed enum behavior;
7. explicit unlock-first / lock-last multi-control transaction behavior;
8. idempotent repeat returning `NO_OP`;
9. layer index/order unchanged by every protocol-1.6 write;
10. proof-owned cleanup returning the disposable project to the exact baseline structural fingerprint.

P1/P2 acceptance may promote only the exercised capabilities to `STRUCTURAL`; P3 visual proof, P4 induced-failure rollback, and P5 save/reopen/reconnect transfer remain separate evidence tranches.
