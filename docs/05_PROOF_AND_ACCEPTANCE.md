# Proof and Acceptance

## Principle

EditFlow 2.0 does not count documentation, schema acceptance, or a successful host call as proof of professional capability. Every material capability must be proven structurally and, when it changes pixels, visually.

## Standard proof ladder

### P0 — Contract

- stable capability/recipe ID exists;
- typed schema exists;
- prerequisites, risk class, readback, rollback and visual-proof profile are declared.

### P1 — Validation

- valid request passes;
- invalid IDs/types/ranges/preconditions are rejected before AE mutation;
- missing capability and stale project revision are rejected.

### P2 — Structural apply/readback

- operation is performed in real AE;
- resulting object hierarchy/properties/keyframes are read back;
- exact declared invariants pass;
- idempotency behavior is demonstrated.

### P3 — Visual result

- bounded preview/render is produced;
- task-specific pixel/perceptual invariants pass;
- no hidden structural success with viewer-visible failure.

### P4 — Failure and recovery

- induced conflict/failure does not corrupt unrelated state;
- rollback/compensation behavior is verified;
- baseline fingerprint or declared recoverable state is restored.

### P5 — Transfer

- capability/recipe succeeds on a second materially different scene, geometry, timing, or source context;
- semantic adaptation is demonstrated rather than replaying hard-coded coordinates.

### P6 — Robustness

- repeated varied tests establish a known success envelope;
- known failure modes are encoded for planning/preflight;
- no unexplained flaky state remains.

## Capability completion

A capability may report `FULL` only after P5. Core release blockers may require P6.

## Recipe maturity

Recipes progress through:

- `OBSERVED` — tutorial/reference understood;
- `RECONSTRUCTED` — built once;
- `VISUAL_MATCH_VERIFIED` — materially matches intended technique;
- `TRANSFER_VERIFIED` — works on unrelated footage;
- `OBJECT_AWARE_VERIFIED` — adapts to different object geometry/motion;
- `ROBUST` — repeated varied success.

A recipe cannot be production-ready if any required human action maps to an unavailable or silently approximated capability.

## Proof fixture requirements

Every material capability family should have:

- a minimal deterministic synthetic fixture where useful;
- at least one real-footage fixture;
- expected structural snapshot/invariants;
- expected critical-frame checkpoints;
- a failure injection case;
- a transfer fixture;
- cleanup verification.

Fixtures must not depend on the user's active production project.

## Human-Parity Core acceptance examples

### Masks

Passing means more than creating `Mask 1`. A proof must create/edit an arbitrary Bezier path, animate it, adjust feather/expansion/opacity/mode, read the path/tangents back, use it in a compositing construction, render it, and demonstrate correction/transfer.

### Track mattes

Proof must establish arbitrary matte source selection, alpha/luma/inverted modes, correct layer relationship/readback, rendered reveal behavior, idempotency, and rollback.

### Parenting

Proof must parent/unparent while preserving declared transforms, animate parent/child relationships, read them back, test ordering/reconnect behavior, and roll back.

### Graph Editor

Proof must demonstrate exact temporal interpolation, incoming/outgoing influence/velocity, spatial tangents, hold/roving/ease behavior, readback of interpolation metadata, and rendered motion timing that distinguishes the curve from linear motion.

### Tracking/isolation

Proof must track/segment a real moving feature or object, export useful data/matte, attach a visible construction, repair an induced bad segment/track, and transfer to unrelated footage.

## Visual verification profiles

Visual checks are technique-specific and may include:

- mask edge alignment/leakage;
- track drift;
- object occlusion timing;
- transition peak/landing duration;
- subject readability;
- framing/crop stability;
- motion direction/velocity consistency;
- blur/smear persistence;
- effect localization;
- luminance/color excursions;
- artifact detection after retiming/flow/stabilization;
- clean landing and post-transition readability.

## CI versus host acceptance

Repository CI can prove schemas, planner behavior, deterministic compilation, state-machine logic, transaction simulations, and adapter unit contracts.

Real After Effects acceptance is mandatory for host behavior. A release cannot claim AE capability parity based solely on mocks.

## Release gate

A release is blocked when:

- required capability proof is below the milestone threshold;
- any required recipe silently degrades;
- structural readback disagrees with requested state;
- rollback/recovery proof fails;
- host acceptance has not been run on the target AE environment class;
- the capability registry is stale relative to installed environment/adapters.

## Evidence retention

Each proof run emits a machine-readable manifest linking:

- git commit;
- build version;
- environment fingerprint;
- AE version;
- adapter/plugin versions;
- fixture IDs;
- execution plan hash;
- structural assertions;
- visual artifacts and scores/findings;
- rollback result;
- final verdict.
