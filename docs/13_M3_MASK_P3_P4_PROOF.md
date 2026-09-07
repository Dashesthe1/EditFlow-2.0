# M3 Mask/Bezier P3/P4 Proof Boundary

This tranche advances the accepted M3 mask/Bezier protocol 1.2 foundation beyond P1 validation rejection and P2 structural readback without weakening or replaying those accepted proofs.

## P3 — viewer-visible visual evidence

The real-After-Effects harness creates two deterministic 320×320 bitmap fixtures, composites them in a disposable composition, and applies an animated curved ADD mask to the foreground layer. The mask grows from a small central aperture through a medium aperture to a large rounded aperture during a one-second render.

The harness must retain:

- `p3-mask-reveal.avi` — the primary viewer-visible mask reveal;
- `p3-background.bmp` and `p3-foreground.bmp` — deterministic source fixtures;
- `p4-post-rollback.avi` — the post-rollback visual comparison artifact;
- `m3-mask-p3-p4-result.json` — structural and rollback evidence.

The harness may prove that a non-empty visual artifact was emitted, but it deliberately keeps `P3_visual_proof` false until the retained pixels are independently reviewed against the expected reveal behavior. P3 therefore cannot self-promote from artifact existence alone.

## P4 — post-mutation failure and rollback

P4 uses a proof-only host failure seam that is reachable only when both conditions are true:

1. the runner-owned After Effects process inherits `EDITFLOW_M3_MASK_P4_PROOF=1`; and
2. the typed `mask.set_properties` request carries the exact readback profile `M3_MASK_P4_FAILURE_INJECTION`.

The failure is injected only after a real mask property mutation has occurred. The existing M3 catch path must then close the undo group and execute After Effects Undo. P4 passes only when all of the following are true:

- the response is `FAILED` with code `M3_MASK_P4_INDUCED_FAILURE`;
- diagnostics report `Failed mutation self-rolled back with AE Undo.`;
- the project structural fingerprint is restored;
- exact mask structural readback is restored;
- a post-rollback render is emitted;
- disposable proof state is returned to the baseline during cleanup.

The proof hook executes no caller-supplied script text and remains inert in ordinary product execution.

## Capability and protocol boundary

This tranche does not add mask commands or broaden arbitrary host execution. Protocol remains `1.2.0`, the public mask command set remains seven typed commands, and the M3 mask adapter component build advances only to `0.4.0-dev.2` for the bounded proof instrumentation.

P5 save/reopen/reconnect transfer remains outside this tranche and must remain false until separately proven on real After Effects.
