# M3 Layer Controls — P3 Visual + P4 Rollback Proof

## Accepted baseline

Protocol `1.6.0` P1/P2 evidence is already accepted on real After Effects at main commit `fc6c7954e2bd8f8e166d9b0387408142b628afc6`.

This tranche does **not** replay or broaden P1/P2. It adds only:

- P3 retained viewer-visible evidence for representative `enabled` and stacking-order behavior;
- P4 induced post-mutation host failure with immediate transaction-owned AE Undo and exact structural recovery;
- no P5 claim.

## Why this fixture is valid

The proof uses two opaque 320×320 bitmap layers:

- a blue background layer;
- a red foreground layer.

The foreground starts enabled and topmost. Because both inputs are fully opaque and fill the frame, the expected output is deliberately binary and easy to review:

1. foreground enabled + topmost → red;
2. foreground disabled → blue;
3. foreground re-enabled + topmost → red;
4. foreground moved to `END` → blue;
5. foreground moved to `BEGINNING` → red.

This avoids effects, alpha, masks, cameras, 3D intersections, blending modes, color-keying, and motion. A red/blue mismatch therefore points directly at layer visibility or stacking behavior rather than a second rendering subsystem.

## External semantic references

The fixture was chosen from documented AE behavior instead of inferred UI behavior:

- Adobe, **Managing layers in After Effects**: the Video switch controls whether a layer's visual information is rendered for previews or final output. https://helpx.adobe.com/after-effects/desktop/work-with-layers/manage-layers/layers.html
- Adobe, **Selecting and arranging layers in After Effects**: layer stacking order is the vertical Timeline arrangement and is directly related to render order. https://helpx.adobe.com/after-effects/desktop/work-with-layers/select-and-arrange-layers/selecting-arranging-layers.html
- After Effects Scripting Guide, **Layer object**: `moveToBeginning()` moves a layer to the topmost/first position and `moveToEnd()` moves it to the bottom/last position. https://ae-scripting.docsforadobe.dev/layer/layer/

The host adapter remains authoritative for actual runtime support and readback.

## P3 retained visual evidence

The real-AE harness emits four deterministic renders:

- `p3-switch-disabled-blue.avi` — foreground `enabled=false`; expected blue;
- `p3-switch-enabled-red.avi` — foreground restored to `enabled=true`; expected red;
- `p3-order-bottom-blue.avi` — foreground moved to `END`; expected blue;
- `p3-order-top-red.avi` — foreground moved to `BEGINNING`; expected red.

Before each render, protocol 1.6 structural readback must agree with the requested state. Merely emitting files does not accept P3. The result remains `VISUAL_REVIEW_REQUIRED` and `P3_visual_proof=false` until retained artifacts are independently inspected.

## P4 induced failure and rollback

P4 starts from the canonical red state: foreground enabled and topmost.

The harness sends a typed `layer.switches.set` request for `enabled=false` with the fixed readback profile `M3_LAYER_CONTROLS_P4_FAILURE_INJECTION`. The host proof hook is reachable only when the runner-owned After Effects process also inherits `EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF=1`.

The injection occurs only after:

1. the real switch mutation executes;
2. protocol 1.6 structural verification confirms `enabled=false`;
3. the existing layer-controls undo group remains open.

The injected error then enters the existing mutation catch path. That path closes the group, immediately executes AE Undo, and returns `FAILED` with the induced proof error. P4 passes only when all of the following are true:

- error code is exactly `M3_LAYER_CONTROLS_P4_INDUCED_FAILURE`;
- the response readback already shows `enabled=true` and topmost order;
- independent post-failure protocol readback exactly equals the pre-failure layer-controls snapshot;
- the observed project fingerprint exactly equals the pre-failure fingerprint;
- a retained post-rollback render is emitted and is expected to match the canonical red P3 render.

The hook accepts no code payload and is inert in ordinary execution.

## Cleanup boundary

The harness owns only its temporary imported bitmaps, temporary composition, and layers. Cleanup uses bounded transaction Undo until those project items are absent, then requires the original project item count and project fingerprint to be restored.

## Evidence maturity

Passing harness checks establish P4 structural rollback evidence and emit P3 artifacts. They do not advance P3 by themselves. P5 save/reopen/reconnect remains a separate evidence tranche.