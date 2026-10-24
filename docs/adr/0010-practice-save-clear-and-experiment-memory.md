# ADR 0010: Practice experiment memory and Save & Clear checkpoints

**Status:** Draft — integration pending against the active New Shadow Practice/Supervisor branch. This GitHub repository is an earlier EditFlow development line; changes here do not deploy the live feature.

## Decision

Implement two complementary mechanisms:

1. **Automatic experiment journal**: append a durable, ordered event immediately after every Practice plan/execution/render/measurement, whether accepted, rejected, failed, or rolled back. Store shot ID, raw/Finished source alignment, ordered AE effect `matchName` values, parameters, keyframes, layer order, operation receipt, evidence renders, error metrics, explanation, and the next candidate. Copy rendered comparison evidence to an app-owned content-addressed vault **when the experiment happens**, not only when the user later saves. Retries with the same attempt ID must not duplicate history.
2. **Save & Clear**: an explicit new action beside Delete. Freeze/drain the sole AE writer; persist verified copies of the actual AE project, raw footage/audio, Finished reference, Source Match evidence, shot statuses and gaps, masks/proxies/render evidence, experiment journal, accepted and rejected effect plans, operation receipts, session stage, Supervisor state, and dependency/environment manifest. Only after a verified checkpoint is committed may the live adapter remove that assignment's AE work and temporary files. **Never remove user originals or the saved vault.**

## UI and Supervisor

- Active Practice: **Save & Clear** action with save progress, storage estimate, verification result, then cleanup; disable concurrent writes/double-click.
- A new **Saved Practices** screen: Inspect, Resume, and separately Delete Saved Data (confirmed).
- Lifecycle: ACTIVE → QUIESCING → SAVING → VERIFIED → CLEARING → SAVED.
- Failure states: SAVE_FAILED (do not clear), SAVED_CLEAR_FAILED (checkpoint retained, cleanup uncertain), RESTORE_BLOCKED (snapshot retained).
- Saved assignments do not auto-relaunch. Resume takes a fresh authorized worker lease after verification; live Practice continues at the saved current shot with all previous attempts visible.
- Record every experiment even before Save, including unsuccessful effect stacks and their numerical outcomes. Cancel must not erase already archived experiments.

## Recovery invariants

- Save the actual `.aep` plus dependency and media data; a GPT summary or external source pathname alone is insufficient.
- Versioned manifest with SHA-256 content hashes, immutable source-backed shot ranges, AE/project version, original comp and render settings, accepted shot list, unresolved shot gaps, and idempotent operation/job IDs.
- Local object store lives outside scratch/session cleanup and deduplicates identical assets.
- Verify all bytes, including render evidence referred to by experiment events, before allowing cleanup.
- Only the single authorized AE production owner may pause jobs, save/open AE, or clear session-owned workspace; no arbitrary filesystem delete based on a chat command.
- Resume materializes to a **new** workspace, relinks backed-up media, reopens AE, verifies effect stack/timeline readback, reconciles Source Match and worker job receipts, and resumes without replaying committed writes. Missing media, plugin, font or mismatched AE version blocks and explains recovery rather than silently changing effects.
- Preserve source media, render comparisons, masks and experiment history until an explicit saved-data deletion.
- Support partial shots, unresolved frames, unsatisfied attempts, failed effects and interrupted work. No invented footage or implied completion.

## Prototype and evidence

A standalone Node checkpoint-vault prototype and 8 passing local unit tests were prepared in this change's accompanying conversation artifact. The prototype implements per-attempt journal fsync, immediate rendered-evidence archiving, content-addressed media/project backup, verify-before-clear gating, fail-safe behavior on cleanup errors, corruption detection, and byte-identical re-materialization into a new workspace.

**Not completed:** installation to New Shadow, live UI button wiring, AE project readback/reopen, Supervisor stage transitions, Source Match resume integration, production acceptance tests.

## Acceptance criteria before production

1. A failed effect attempt survives Cancel, Windows restart, and the removal of the original preview file.
2. Save & Clear captures a half-finished edit, all source/reference media and meaningful effects/attempt evidence; clearing occurs only after independent archive verification.
3. Resume restores exact source ranges, accepted AE layer/effect stacks, settings, keyframes, selected shot, gaps, job state, and learned failures without double execution.
4. Fault injection for disk-full, corrupted media, interrupted archive, AE busy, missing plugin, and stale project preserves the saved checkpoint and never clears prematurely.
5. Checkpoint reopens and renders correctly in a disposable live AE Practice assignment, including a second cold restart.
