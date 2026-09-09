# ADR 0009 — Warm After Effects Development Harness

## Status

Accepted for development infrastructure.

## Context

EditFlow 2.0 requires real After Effects proof for material host capabilities. The early self-hosted proof harnesses intentionally used isolated cold starts and zero-AfterFX-process cleanup. That was useful while establishing trust in the host bridge, but repeating process shutdown/startup for routine validation creates avoidable latency, causes Adobe recovery/startup dialogs, and does not scale across M4–M11.

The project now needs one reusable development harness that lets ChatGPT write code, run real-AE proofs, receive machine-readable evidence, patch failures, and rerun with minimal operator involvement while preserving the existing proof and transaction standards.

## Decision

### 1. Warm AE is the default

New development proofs MUST declare an AE lifecycle requirement. The default is `REUSE_AE`.

Supported lifecycle modes are:

- `REUSE_AE` — reuse a healthy target After Effects process; launch one only when none exists; leave it running afterward.
- `REOPEN_PROJECT` — reuse the AE process but allow the proof to close/reopen its proof-owned project when project persistence is the behavior under test.
- `RECONNECT_BROKER` — reuse the AE process but allow the proof to restart/reconnect the EditFlow broker/session when connection persistence is the behavior under test.
- `RESTART_AE` — explicitly restart the target AE process because process-lifecycle behavior is under test or the proof contract requires a new process.
- `CLEAN_BOOT` — require a zero-target-process baseline before starting AE; reserved for startup/environment/bootstrap acceptance.

A proof MUST NOT close or restart AE merely as a convenient cleanup mechanism.

### 2. Project isolation replaces process isolation

For `REUSE_AE`, `REOPEN_PROJECT`, and `RECONNECT_BROKER`, fixtures MUST be proof-owned and cleanup MUST restore the declared baseline/project fingerprint. A healthy AE process remains available for the next proof.

Accepted historical proofs are not rewritten retroactively. Their retained evidence remains authoritative. Future proofs and migrated reusable proofs opt into this lifecycle contract explicitly.

### 3. Lifecycle escalation is fail-closed

If a `REUSE_AE` proof finds AE unresponsive or cannot establish a trustworthy baseline, the harness returns an infrastructure failure. It MUST NOT silently escalate to `RESTART_AE` or `CLEAN_BOOT` because doing so would change the proof contract.

Only a request that explicitly declares `RESTART_AE` or `CLEAN_BOOT` authorizes the harness to terminate the target AE process.

### 4. Guarded host supervisor

A Windows-side supervisor may inspect After Effects process/window metadata and handle narrowly allow-listed blocking dialogs. It may not expose arbitrary coordinates, arbitrary keystrokes, or unrestricted window messages.

The initial mutating allowance is limited to an AfterFX-owned recovery/startup dialog whose visible context indicates crash/recovery/repair/restore state and that contains exactly one enabled native `Continue` button. Ambiguous contexts are logged and refused.

### 5. Warm AE survives self-hosted runner job cleanup

The GitHub self-hosted runner tags processes created inside a job and performs orphan-process cleanup when that job ends. A deliberately warm After Effects process is workstation-scoped rather than job-scoped, so the harness clears `RUNNER_TRACKING_ID` only for the exact target `AfterFX.exe` launch and immediately restores the runner variable afterward.

This exception is intentionally narrow:

- only a validated target AfterFX executable launch is detached from job orphan cleanup;
- the proof runner, dialog supervisor, broker helpers, and all other child processes remain normally tracked;
- `REUSE_AE` does not gain authority to terminate or replace an existing AE process;
- an explicitly declared `RESTART_AE` or `CLEAN_BOOT` may replace AE, and the replacement becomes the next warm workstation-scoped process.

The result is a healthy AE process that may survive multiple independent GPT-triggered Actions jobs without exempting general-purpose subprocesses from runner cleanup.

### 6. One serialized real-AE lane

Real-AE mutation proofs are serialized on the self-hosted Windows acceptance workstation. Repository/schema/type/unit tests remain independent and may run in parallel on normal CI.

### 7. Machine-readable proof orchestration

Every accelerated proof run emits an orchestration result containing at least:

- proof ID;
- requested lifecycle;
- PASS / PRODUCT_FAILURE / INFRASTRUCTURE_FAILURE classification;
- start/end timestamps;
- whether AE was reused, launched, or explicitly restarted;
- target AE PID when known;
- proof exit code;
- retry count;
- artifact/result locations;
- concise failure message.

The proof itself remains responsible for structural/visual assertions, rollback evidence, cleanup evidence, and its normal proof result.

### 8. Bounded infrastructure retry only

The harness may perform at most one automatic infrastructure retry when all of the following are true:

- the request explicitly allows it;
- the proof result classifies the failure as infrastructure-related;
- no project mutation began, or the proof proves exact cleanup before retry;
- retrying does not change the declared lifecycle.

Product/assertion failures are never blindly retried.

### 9. GPT owns the loop

The intended development loop is:

`code -> fast CI -> real-AE proof -> machine result -> diagnose -> patch -> rerun -> accept -> next capability`.

Human interaction is reserved for infrastructure/authentication/licensing or other boundaries that cannot be safely automated.

## Consequences

- New M4–M11 proofs can reuse one healthy AE process across many fixtures and separate Actions jobs.
- Startup/recovery overhead is removed from routine proofs.
- Save/reopen, broker reconnect, restart, and clean-boot behavior remain provable because they are explicit lifecycle modes rather than implicit side effects.
- Existing accepted cold-start evidence remains unchanged.
- The development harness becomes long-lived infrastructure rather than milestone-specific glue.
