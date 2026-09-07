# M3 Layer Controls Foundation — Protocol 1.6

## Scope

Protocol `1.6.0` adds the next Human-Parity Core tranche for deterministic layer switches and stacking order without arbitrary host-code execution.

Capabilities:

- `ae.layer.switches.set`
- `ae.layer.order.set`
- `ae.layer.controls.readback`

The switch surface is intentionally limited to layer-local controls whose structural state can be read back directly: video enablement, audio enablement, solo, lock, shy, collapse transformations/continuous rasterization where settable, layer quality, effect enablement, adjustment-layer mode, 3D-layer mode, preserve transparency, and sampling quality.

Motion blur and frame blending are intentionally **not** folded into this tranche. After Effects couples those layer switches to composition-level enablement and, for motion blur, composition shutter controls. Those remain in M3's later rendering-controls requirement so their proof can cover the complete behavior rather than a misleading layer-local toggle.

## Host behavior

- Requests use caller-owned stable object references and the existing host revision conflict guard.
- Unsupported switch writes fail closed with `LAYER_SWITCH_NOT_SUPPORTED`; they are never silently skipped.
- Locked targets are temporarily unlocked only inside the transaction when a requested mutation requires it, then restored to the requested/final lock state.
- Layer ordering uses native `moveToBeginning`, `moveToEnd`, `moveBefore`, and `moveAfter` semantics.
- Readback includes the target layer identity, supported-switch map, current switch values, index, total layer count, and immediate neighbors.
- Mutations verify structural readback before returning `APPLIED`.
- Mutation failure crosses the existing undo transaction boundary; rollback failure is surfaced explicitly.
- No arbitrary `eval` or script payload is accepted.

## Evidence posture

All protocol 1.6 capabilities enter the registry as `PARTIAL / DECLARED`. Contract and schema tests may prove the control-plane contract, but capability maturity must not advance to `TRANSFER` until the real-After-Effects P1–P5 evidence gate is accepted.

## External implementation references

The implementation was cross-checked against current Adobe documentation rather than inferred from UI behavior alone:

- Adobe, **Scripts in After Effects**: scripts use ExtendScript and can reorder composition layers. https://helpx.adobe.com/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html
- Adobe, **Managing layers in After Effects**: documents Video, Audio, Solo, Lock, Shy, Collapse Transformations/Continuously Rasterize, Quality, Effect, Adjustment Layer, and 3D Layer switches, and separately explains the composition dependencies of Frame Blend and Motion Blur. https://helpx.adobe.com/after-effects/desktop/work-with-layers/manage-layers/layers.html
- Adobe, **Selecting and arranging layers**: current layer ordering behavior and terminology. https://helpx.adobe.com/after-effects/desktop/work-with-layers/select-and-arrange-layers/selecting-arranging-layers.html

The host adapter remains the source of truth for runtime capability checks because individual layer types do not expose every switch.
