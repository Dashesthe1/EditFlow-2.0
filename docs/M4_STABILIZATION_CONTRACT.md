# M4 Stabilization Contract

Status: **PARTIAL / DECLARED / R0_READ_ONLY**  
Capability ID: `ae.tracker.stabilization.solve`  
Route ID: `ae.m4.tracker.stabilization-solve.v1`

## Purpose

Provide a deterministic, fail-closed stabilization solver over the already established After Effects protocol 2.1 native tracker readback. This tranche solves the inverse motion geometry needed for stabilization without claiming that composition-space deltas are already valid After Effects property-write payloads.

Adobe's current After Effects tracking documentation describes stabilization as using tracked motion to generate the opposite motion on the tracked source layer. Position stabilization uses one track point, while Rotation and Scale use two track points; native Stabilize mode ultimately writes Anchor Point, Rotation, and/or Scale keyframes. Reference: https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/track-motion/tracking-stabilizing-motion-cs5.html

## Input contract

The solver accepts `AeTrackerReadbackV21` plus `StabilizationSolveOptionsV1`.

Defaults:

- tracker index: `1`
- primary point index: `1`
- secondary point index: `2`
- Position: enabled
- Rotation: disabled
- Scale: disabled
- reference frame: earliest usable synchronized sample

A requested `referenceTime` must match an available tracked sample after the protocol's microsecond time normalization. The solver does not interpolate missing tracker samples.

## Output contract

`StabilizationSolutionV1` contains:

- the tracker and point identities used;
- the exact tracked reference time;
- the selected stabilization components;
- deterministic time-sorted samples;
- component-wise inverse motion values;
- conservative confidence and tracker evidence IDs.

For each sample:

### Position

`counterTranslationCompPx = referencePrimaryCompPoint - currentPrimaryCompPoint`

This value is expressed in composition pixels. It means "move the tracked image content by this composition-space amount to return the primary tracked feature to its reference position." It is **not** asserted to be an After Effects Anchor Point delta for an arbitrarily transformed layer.

### Rotation

When enabled, Rotation requires a distinct secondary track point with synchronized samples.

`counterRotationDegrees = normalize(referenceAngle - currentAngle)`

The angle is measured from primary attach point to secondary attach point. The result is normalized across the +/-180 degree boundary.

### Scale

When enabled, Scale requires the same synchronized two-point geometry.

`scaleMultiplier = referenceDistance / currentDistance`

This is the component-wise reciprocal of the tracked distance change.

## Fail-closed conditions

The solver returns `null` instead of fabricating a result when any required condition is not met, including:

- no stabilization component selected;
- missing requested tracker or point;
- fewer than two usable keyed samples;
- Rotation/Scale requested with the same primary and secondary point;
- Rotation/Scale requested without at least two synchronized samples;
- missing/invalid composition-space tracker coordinates;
- zero-length reference or current two-point geometry;
- a requested reference time that is absent.

No fallback to guessed image motion or unrelated transform properties is allowed.

## Safety and transaction semantics

This capability is `R0_READ_ONLY` and requires no rollback because it performs no project write. It does not:

- press Analyze or Apply in the Tracker panel;
- invoke native Stabilize Motion;
- write Anchor Point, Rotation, or Scale;
- save or close the user project;
- change the active comp, layer, or current time.

A future application adapter must map the solved composition-space counter-motion into truthful After Effects property writes under arbitrary layer transforms and prove reversible behavior in real After Effects before promotion.

## Proof maturity and runtime registration

The solver begins at `DECLARED` maturity with deterministic unit coverage. Runtime capability registration is intentionally withheld until a retained real-After-Effects proof is captured and accepted. This prevents the product surface from advertising an unproven live-write stabilization capability.

The required promotion proof should demonstrate at minimum:

1. real native tracker readback from a live After Effects comp;
2. one-point Position stabilization geometry;
3. two-point Rotation and Scale stabilization geometry;
4. exact before/after/readback evidence for any property writes introduced later;
5. deterministic cleanup or rollback to the pre-proof state;
6. no project save/close side effect;
7. viewer-visible comparison against the intended stationary feature and, where useful, native Stabilize Motion behavior.

## Human-parity status

This tranche closes the deterministic **stabilization solving** portion of the M4 gap, but not full human parity for stabilization. Remaining work includes live property application, native-UI/native-command proof where needed, edge exposure/framing decisions, repair/resume behavior, and later semantic/segmentation-driven stabilization targets.
