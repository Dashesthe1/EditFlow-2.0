# Accelerated AE development harness — warm reuse acceptance

## Scope

This record accepts the development-infrastructure property that a target After Effects process launched by the accelerated harness can survive a self-hosted GitHub Actions job boundary and be reused by later independent GPT-triggered proof jobs without relaunching or restarting AE.

This is infrastructure evidence only. It does not promote a new EditFlow product capability or replace any P1–P5 capability proof.

## Pre-acceptance findings

The first runner-tracking experiment, workflow run `34295642318`, launched target After Effects PID `17084` under `REUSE_AE` but timed out before AE exposed a healthy project window. The retained orchestration result correctly classified the run as `INFRASTRUCTURE_FAILURE`, with `aeLaunched=true`, `aeRestarted=false`, no proof mutation, and no blind retry. Artifact `10083034717` has digest `sha256:d53825b2b2a415714aa7f104c5e3e17ada3a4343a43eddc3919e157c6c9a007c`.

The supervisor log from that run also established that Adobe startup/recovery surfaces may be rendered with custom `DroverLord - Window Class` children rather than native Windows `Button` controls. The permanent supervisor therefore gained a guarded Windows UI Automation fallback. The fallback still requires AfterFX process ownership, recovery-related accessible context, and exactly one enabled invokable element named `Continue`; otherwise it refuses mutation.

Importantly, PID `17084` survived the failed job boundary. That proves the harness's narrowly scoped `RUNNER_TRACKING_ID` exemption prevented GitHub runner orphan cleanup from killing the workstation-scoped AE process.

## Accepted cross-job reuse run 1

Workflow run: `34295854592`

Artifact: `10083087957`

Artifact digest: `sha256:3c825bee4c066533a641144718884dab02de4bcc8ebfcfc3b75d36840085e57a`

Observed orchestration result:

- classification: `PASS`
- lifecycle: `REUSE_AE`
- `aeReused=true`
- `aeLaunched=false`
- `aeRestarted=false`
- AE PID: `17084`
- proof exit code: `0`
- retry count: `0`
- mutation started: `false`
- cleanup complete: `true`
- stable PID: `true`

The accelerated proof step ran from `2026-09-09T00:38:27Z` to `2026-09-09T00:38:30Z`. The proof reported that the warm AE session remained healthy on the same process without mutation or shutdown.

## Accepted cross-job reuse run 2

Workflow run: `34295911372`

Artifact: `10083110123`

Artifact digest: `sha256:0115829a1c578411a9439d2d8c98c119d3ae82bae4376329f33e3582354a89ea`

Observed orchestration result:

- classification: `PASS`
- lifecycle: `REUSE_AE`
- `aeReused=true`
- `aeLaunched=false`
- `aeRestarted=false`
- AE PID: `17084`
- proof exit code: `0`
- retry count: `0`
- mutation started: `false`
- cleanup complete: `true`
- stable PID: `true`

The accelerated proof step ran from `2026-09-09T00:39:17Z` to `2026-09-09T00:39:21Z` and again preserved PID `17084`.

## Acceptance

The warm-session persistence property is accepted for the declared self-hosted Windows AE workstation:

1. the AE process can be workstation-scoped rather than Actions-job-scoped;
2. GitHub runner post-job orphan cleanup no longer forces an AE relaunch;
3. two independent successful jobs reused the exact same PID `17084`;
4. neither successful reuse job restarted AE;
5. neither successful reuse job mutated the AE project;
6. the proof runner and supervisor remain job-scoped and are cleaned normally;
7. `REUSE_AE` remains fail-closed and has no implicit authority to kill/restart an unhealthy AE process.

The UI Automation recovery-Continue route is retained as a guarded fallback but was not required to mutate UI during the two accepted reuse runs; those runs found PID `17084` healthy when they began. A future naturally occurring matching recovery dialog may supply direct real-dialog invocation evidence without deliberately crashing AE merely to exercise the fallback.
