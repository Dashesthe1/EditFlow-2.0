# M4 Automatic Corrective Recovery Contract

Status: **PARTIAL / STRUCTURAL / R0_READ_ONLY**
Capability ID: `tracking.repair_resume.auto_correct.plan`
Route ID: `m4.tracking.repair-auto-correct-plan.v1`

## Purpose

Compose the already accepted automatic repair trigger, repair-state model, protocol 2.4 Feature Center repair surface, and guarded tracker-analysis resume into one deterministic corrective-recovery plan.

This layer is intentionally a planner. It does not gain a new arbitrary AE write path and it does not infer correction geometry from a failure signal.

## Eligible automatic failures

V1 accepts only these persistent automatic escalation reasons:

- `TRACK_CONFIDENCE_LOW`
- `TRACK_DRIFT_RISK_HIGH`
- `IDENTITY_UNCERTAIN`

`SUBJECT_OCCLUDED` remains escalation-only. Hidden subject geometry is not considered safe authority for an automatic correction write.

## Required authority

A plan is emitted only when all of the following are exact and evidence-backed:

1. one `ESCALATE` evaluation with a retained last-good baseline;
2. the same `semanticId` in monitor evaluation and repair state;
3. an eligible persistent failure reason;
4. exact comp and layer stable IDs plus positive AE host IDs;
5. exact tracker and point indices plus composition time;
6. exact Feature Center coordinates supplied by the caller/provider;
7. normalized semantic correction evidence accepted by the repair-state model;
8. semantic-to-host mapping evidence;
9. a guarded Forward or Backward resume direction whose requested point set includes the repaired point.

The planner never substitutes nearest objects, infers identity from motion, or derives host coordinates from normalized correction geometry.

## Planned recovery sequence

The emitted plan contains exactly three protocol 2.4 operations:

1. `tracker.repair.readback` before mutation;
2. `tracker.repair.set_feature_center` with the exact supplied correction;
3. `tracker.repair.readback` after mutation.

It then emits one guarded point-analysis directive bound to the same comp host ID, layer host ID, tracker index, point index, required point set, and requested direction.

The repair state is advanced only through `ESCALATE`, `BEGIN_REPAIR`, and `RECORD_CORRECTION`. Automatic composition does **not** declare the repair complete. Fresh post-analysis tracking evidence must still pass the existing `VERIFY_REPAIR` thresholds before `RESUME` is legal.

## Failure behavior

The planner returns `null` for non-escalated evaluations, semantic mismatch, occlusion, invalid or stale correction timing, ambiguous host identity, missing mapping evidence, invalid Feature Center values, unsupported direction, or incomplete required-point binding.

Protocol 2.4 remains responsible for host revision gating, exact readback, idempotency, and transaction Undo if the correction write fails after mutation.

## Runtime registration

The planner is registered only when protocol 2.4 tracker repair is explicitly available **and** a verified protocol 2.1 point-analysis visual route is available. Protocol 2.4 alone does not expose automatic correction.

## Proof maturity

Current maturity is `STRUCTURAL`. Unit coverage proves accepted drift, low-confidence, and explicit identity-loss composition plus fail-closed occlusion, identity, mapping, timing, and point-binding cases.

Promotion to `VISUAL` requires retained warm real-AE evidence that an automatically emitted escalation trigger drives the exact protocol 2.4 correction, exact post-write readback, guarded native analysis resume, post-analysis verification, and proof-owned cleanup without saving, replacing, or restarting the user's project.
