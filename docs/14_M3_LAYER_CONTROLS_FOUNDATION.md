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

The initial protocol-1.6 registry posture was deliberately `PARTIAL / DECLARED`: contract/schema tests could establish only the control-plane contract, and no capability was allowed to advance to transfer maturity until real After Effects completed the P1–P5 gate.

That gate is now complete for the three capabilities in this tranche.

Accepted evidence ladder:

- P1/P2 structural acceptance: run `34156910741`, artifact `10031293005`, record `proofs/diagnostics/m3-layer-controls-p1-p2-run7-acceptance.md`.
- P3/P4 visual + rollback acceptance: run `34159635705`, job `101858554842`, artifact `10032176111`, record `proofs/diagnostics/m3-layer-controls-p3-p4-run9-acceptance.md`.
- P5 save/reopen/reconnect transfer acceptance: run `34160617926`, job `101861547189`, artifact `10032484694`, record `proofs/diagnostics/m3-layer-controls-p5-run1-acceptance.md`.

P5 retained a distinctive multi-switch and stacking-order state through project save, After Effects reopen, dispatcher reload, broker restart, and a distinct authenticated protocol-1.6 CEP session. The post-reconnect readback matched every declared switch support/value plus exact order and neighbor identities. Native After Effects `Layer.id` values also remained stable (`38` for the front layer, `37` for its back-layer neighbor), and the new session then completed fresh switch and order writes with exact readback before proof-owned cleanup restored the blank baseline.

Accordingly, the current registry projects these three evidence-bounded capabilities to `FULL / TRANSFER`:

- `ae.layer.switches.set`
- `ae.layer.order.set`
- `ae.layer.controls.readback`

This promotion does not expand the protocol surface. Motion blur, frame blending, composition-level rendering switches, and shutter dependencies remain outside the accepted layer-controls envelope and require their own later proof tranche.

## External implementation references

The implementation and acceptance invariants were cross-checked against current documentation rather than inferred from UI behavior alone:

- Adobe, **Scripts in After Effects**: scripts use ExtendScript; Adobe documents `afterfx.exe -r <script>` as executing a script in the existing After Effects application instance. https://helpx.adobe.com/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html
- Adobe, **Managing layers in After Effects**: documents Video, Audio, Solo, Lock, Shy, Collapse Transformations/Continuously Rasterize, Quality, Effect, Adjustment Layer, and 3D Layer switches, and separately explains the composition dependencies of Frame Blend and Motion Blur. https://helpx.adobe.com/after-effects/desktop/work-with-layers/manage-layers/layers.html
- Adobe, **Selecting and arranging layers**: current layer ordering behavior and terminology. https://helpx.adobe.com/after-effects/desktop/work-with-layers/select-and-arrange-layers/selecting-arranging-layers.html
- After Effects Scripting Guide, **Layer.id**: documents the native layer ID as persistent between sessions and unchanged when a project is saved and later reloaded. https://ae-scripting.docsforadobe.dev/layer/layer/

The host adapter remains the source of truth for runtime capability checks because individual layer types do not expose every switch. Accepted proof maturity remains limited to the exact capabilities and behaviors exercised by the retained evidence.