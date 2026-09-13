# M4 Manual Tracking Repair / Resume Contract

Status: **PARTIAL / VISUAL / R0_READ_ONLY**
Capability ID: `tracking.repair_resume.state`  
Route ID: `m4.tracking.repair-resume-state.v1`

## Purpose

Provide a deterministic state model for pausing unreliable subject tracking, recording manual repair evidence, verifying the repaired track against explicit policy, and resuming only after verification succeeds.

The model aligns with existing M4 editor-brain escalation semantics rather than inventing a second failure detector. Supported triggers include invalid subject state, low tracking confidence, high drift risk, occlusion, identity uncertainty, and explicit manual repair request.

## States

- `TRACKING`
- `REPAIR_REQUIRED`
- `REPAIR_IN_PROGRESS`
- `RESUME_READY`
- `RESUMED`
- `ABORTED`

Transitions are fail-closed. Unsupported ordering returns `null` rather than silently advancing state.

## Explicit repair policy

State creation requires caller-owned normalized thresholds:

- `minResumeConfidence`
- `maxResumeDriftRisk`
- `maxResumeOcclusion`

The repair model contains no hidden threshold relaxation. A failed verification reports every violated threshold and remains `REPAIR_IN_PROGRESS`.

## Repair cycle

1. `ESCALATE` records the failure timestamp, last-good timestamp, reason, and evidence.
2. `BEGIN_REPAIR` explicitly opens the repair session.
3. One or more `RECORD_CORRECTION` events record normalized x/y/scale/confidence corrections with evidence. Corrections may repair frames between the last-good point and the detected failure.
4. `VERIFY_REPAIR` evaluates fresh track confidence, drift risk, and occlusion after the latest correction.
5. Passing verification produces `RESUME_READY`.
6. `RESUME` requires accepted verification, a non-regressing resume timestamp, and evidence.
7. `ABORT` explicitly terminates an unresolved repair session.

A resumed track can later escalate into a new repair cycle; the cycle counter increments and prior correction/verification working state is cleared while aggregate evidence history is retained.

## Evidence and identity

Every session is bound to one exact `semanticId`. Escalation, corrections, verification, resume, and abort require evidence where they materially assert state. Evidence IDs are de-duplicated into the session history.

A correction is normalized geometry/evidence, not a direct After Effects property write. This separation prevents a repair-state transition from pretending that host tracker features or mask vertices were actually moved.

## Safety and proof maturity

The state model itself remains `R0_READ_ONLY`; host repair writes are separate reversible protocol 2.4 operations. Runtime registration is now permitted only when protocol 2.4 repair routes and a verified native point-analysis driver are both explicitly available. Retained real-AE proof currently demonstrates:

1. a deterministic point-tracker fixture contains a deliberately incorrect repair-frame Feature Center;
2. the exact comp/layer/tracker/point binding survives correction and visual resume;
3. protocol 2.4 applies the correction with exact key readback, idempotency, and stale-revision rejection;
4. protocol 2.1 independently verifies the corrected frame and newly generated post-repair sample;
5. the state-model tests continue to prove that failed verification cannot resume;
6. guarded native Analyze Forward resumes from the repaired frame and produces a new sample within 0.15 px of known ground truth;
7. induced post-write failure restores the exact Feature Center keys and the owned proof fixture cleans up to the baseline project item count.

## Human-parity status

The deterministic repair/resume model is now connected to a retained real-AE **point-tracker Feature Center repair + Analyze Forward resume** path. Human-parity remains partial: Backward repair/resume, mask-point repair, automatic drift/identity-loss detection, occlusion recovery, and generalized semantic correction-to-host mapping still require separate retained proofs.
