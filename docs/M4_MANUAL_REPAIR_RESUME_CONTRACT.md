# M4 Manual Tracking Repair / Resume Contract

Status: **PARTIAL / DECLARED / R0_READ_ONLY**  
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

The state model is `R0_READ_ONLY`; it performs no AE project write and requires no rollback. Runtime capability registration remains withheld until real host repair execution is implemented and retained proof demonstrates:

1. an actual tracker/mask drift failure is detected;
2. repair state opens on the correct semantic subject;
3. one or more host corrections are applied with exact readback;
4. verification metrics are derived from post-repair evidence;
5. failed verification cannot resume;
6. accepted verification resumes from the intended frame without identity jump;
7. correction writes can be rolled back or cleaned up deterministically.

## Human-parity status

This closes the deterministic **manual repair/resume model** portion of the M4 roadmap. Live tracker/mask correction execution and proof remain environment-dependent host work. With the workstation offline, those writes are intentionally not claimed.
