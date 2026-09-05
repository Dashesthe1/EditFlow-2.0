# M2 Windows / Real After Effects Acceptance

M2 cannot be completed from Linux GitHub-hosted CI alone. The final host proof must execute the clean-room dispatcher inside the installed Windows After Effects environment.

## Bounded proof

Run from the repository root on the AE workstation:

```powershell
.\scripts\windows\run-m2-ae-acceptance.ps1
```

Prerequisites:

- Adobe After Effects is already running;
- the currently open project can tolerate temporary EditFlow proof objects being created and removed;
- `Edit > Preferences > Scripting & Expressions > Allow Scripts To Write Files And Access Network` is enabled;
- the repository is available locally.

The proof intentionally **does not save, replace, close, or create a project**. It records the baseline item count, creates uniquely prefixed temporary comps/layers/effects/keyframes, renders a one-second proof artifact, precomposes the test layer, inspects stable IDs, removes the temporary project items, and verifies the item count is restored.

Artifacts are written under the ignored directory:

`proofs/artifacts/m2-real-host/`

The JSON result explicitly reports P1-P5 status. A bounded pass is not equivalent to M2 completion: P4 failure-injection rollback and P5 save/reopen/reconnect remain false until their dedicated disposable-project proof is implemented and run.

## Self-hosted GitHub Actions route

A workstation registered as a GitHub Actions runner with labels:

- `self-hosted`
- `Windows`
- `editflow-ae`

can run **M2 Real After Effects Acceptance** manually through `workflow_dispatch`. The workflow uploads the proof directory as an artifact.

The workflow is intentionally not triggered by pull requests. Real AE writes must never be caused merely by opening or updating a PR.

## Safety model

The real-AE proof script loads only the repository-owned `editflow_host.jsx` and calls the same fixed `EditFlow2_dispatch` command table exercised by code CI. It does not introduce a generic scripting console or a new arbitrary-code route.

If the proof fails, its `finally` block performs best-effort direct cleanup of the uniquely identified proof project items. This cleanup is harness-only defensive code; production EditFlow writes still go through the typed adapter.

## Remaining M2 closure requirements

Before issue #4 can close:

1. run the bounded proof successfully on the target AE workstation;
2. inspect the generated render and structural result artifact;
3. add and pass a disposable-project P4 failure-injection rollback proof;
4. add and pass P5 rename/reorder/duplicate/precompose/save/reopen/reconnect stable-identity proof;
5. prove the CEP transport itself can call the installed host dispatcher in the target AE/CEP environment;
6. promote only the capabilities actually proven from `DECLARED` to the corresponding proof maturity;
7. only then enable real Adobe writes from the MCP surface.
