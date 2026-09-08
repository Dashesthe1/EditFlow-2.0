# M3 markers, motion blur, frame blending and shutter foundation

Protocol 2.0 is the final declared manipulation tranche in the M3 Human-Parity Core roadmap. It is intentionally **not** registered into the accepted ordinary runtime yet. The capability records remain `PARTIAL / DECLARED` until real-After-Effects P1-P5 evidence is accepted.

## Scope

The bounded protocol 2.0 surface exposes:

- composition and layer marker set/remove/readback;
- composition motion-blur master switch;
- composition frame-blending master switch;
- composition shutter angle and shutter phase;
- composition motion-blur Samples Per Frame and Adaptive Sample Limit;
- layer motion-blur switch;
- layer frame-blending mode: no blend, frame mix, or pixel motion.

No arbitrary ExtendScript execution, UI automation, silent approximation, or generic property escape hatch is introduced.

## Adobe host mapping

The implementation is grounded in the current After Effects scripting object model rather than guessed UI behavior:

- `CompItem.motionBlur` and `CompItem.frameBlending` are read/write composition switches.
- `CompItem.shutterAngle` is read/write in the documented range `0..720`.
- `CompItem.shutterPhase` is read/write in the documented range `-360..360`.
- `CompItem.motionBlurSamplesPerFrame` is read/write in the documented range `2..64`.
- `CompItem.motionBlurAdaptiveSampleLimit` is read/write in the documented range `16..256`.
- `AVLayer.motionBlur` is read/write.
- `AVLayer.frameBlendingType` is read/write using `FRAME_MIX`, `PIXEL_MOTION`, or `NO_FRAME_BLEND`; `AVLayer.frameBlending` itself is read-only host state.
- composition markers are stored through `CompItem.markerProperty`; layer markers through `Layer.marker`; both are keyframed `MarkerValue` properties.

Reference material consulted during design:

- After Effects Scripting Guide — CompItem: https://ae-scripting.docsforadobe.dev/item/compitem/
- After Effects Scripting Guide — MarkerValue: https://ae-scripting.docsforadobe.dev/other/markervalue/
- After Effects Scripting Guide — AVLayer / offline reference: https://ae-scripting.docsforadobe.dev/print_page/

## Protocol contract

`packages/adapters/ae-cep/src/protocol-v2_0.ts` defines seven commands:

1. `marker.set`
2. `marker.remove`
3. `marker.readback`
4. `comp.motion.set`
5. `comp.motion.readback`
6. `layer.motion.set`
7. `layer.motion.readback`

Mutations require `expectedHostProjectRevision`. Readbacks are R0. Mutations are R1 reversible and execute inside an AE undo group. The protocol transport serializes every payload as data before calling the fixed `EditFlow2_dispatch` entry point.

## Marker semantics

Marker writes preserve the exact declared fields that the AE `MarkerValue` surface exposes: comment, chapter, URL, frame target, cue-point name, duration, event-cue flag, label, protected-region flag, and string parameter pairs.

Protected regions are composition-only in this contract. A `protectedRegion: true` request against a layer marker is rejected before mutation.

Marker removal addresses an existing marker by one-based key index. Marker readback returns all marker keys, their host times, and the observed MarkerValue fields.

## Motion and shutter semantics

Composition writes are atomic at the protocol level: requested values are validated, applied, structurally read back, and restored to the prior observed state if readback differs.

Layer writes similarly cover `motionBlur` plus the exact `frameBlendingType` enum. The host additionally reports the derived read-only `frameBlending` state so proof can distinguish the requested enum from AE's observed enabled/disabled state.

## Proof ladder

The next proof work should use the same evidence discipline as the accepted protocol 1.9 tranche:

- **P1**: host-load and command-availability proof against real AE;
- **P2**: exact mutation/readback plus invalid-bound and revision-conflict rejection;
- **P3**: viewer-visible motion/frame-blending/shutter render evidence where applicable, plus marker timeline structural evidence;
- **P4**: rollback/cleanup and original-project fingerprint restoration;
- **P5**: save, reopen, broker reconnect, exact state persistence, fresh post-reconnect mutation, and a materially different transfer context.

Only after accepted P1-P5 evidence may the protocol 2.0 capabilities be promoted from `PARTIAL / DECLARED` into the accepted runtime registry.

## Required real-AE cases

The first real-AE fixture should deliberately exercise:

- a composition marker with duration, label, protected region, and parameters;
- a layer marker with distinct metadata and a removal operation;
- composition motion blur enabled with a non-default shutter angle/phase and non-default sampling values;
- a moving layer with motion blur enabled;
- footage or a precomp whose frame-blending type visibly changes between `FRAME_MIX` and `PIXEL_MOTION`;
- invalid values at every documented bound plus stale `expectedHostProjectRevision`;
- exact structural readback after save/reopen/reconnect.

This keeps the proof aligned with the M3 completion rule: successful calls alone are insufficient; EditFlow must prove exact host state, viewer-visible consequences where applicable, safe recovery, and transfer.
