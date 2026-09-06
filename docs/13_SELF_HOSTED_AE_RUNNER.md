# EditFlow 2.0 self-hosted After Effects runner

The M2 real-After-Effects proof can run on a GitHub Actions self-hosted Windows runner so the control plane can trigger bounded PowerShell + AE acceptance without copying terminal output by hand.

## Security boundary

The runner is not a general remote shell. The repository workflow invokes only checked-in scripts. The real-AE workflow does **not** run on pull requests. Remote test activation is limited to the dedicated `ae-test/m2-control` branch and the `.github/ae-test-trigger/m2.txt` trigger path, plus explicit `workflow_dispatch`.

Because After Effects and CEP are desktop applications, this runner must execute in the logged-in interactive Windows session. Do not install this runner as a Windows service.

## One-time GitHub runner registration

1. In GitHub, open `Dashesthe1/EditFlow-2.0` → **Settings** → **Actions** → **Runners** → **New self-hosted runner**.
2. Choose **Windows** and **x64**.
3. Create a dedicated runner directory, for example `C:\actions-runner\editflow-ae`.
4. Run the download/extract commands GitHub displays for the current runner release.
5. Run GitHub's displayed `config.cmd` command. When prompted for additional labels, add `editflow-ae`.
6. Do **not** run `svc install` or `svc start`. Start the runner interactively with `run.cmd` while logged into the Windows desktop.
7. Leave that `run.cmd` window running while EditFlow real-AE tests are allowed to execute.

The runner already receives the standard `self-hosted` and `Windows` labels; the workflow additionally requires `editflow-ae`.

## Automated M2 test lifecycle

For a controlled `ae-test/m2-control` trigger, the workflow:

1. checks out the exact test commit;
2. verifies the runner is in an interactive Windows session;
3. refuses to touch After Effects if an AE process was already running before the proof;
4. installs the checked-out EditFlow CEP bridge;
5. launches a fresh After Effects instance;
6. relies on the CEP manifest's `AutoVisible=true` bridge lifecycle and waits for authenticated bridge registration;
7. runs `scripts/windows/run-m2-ae-acceptance.ps1`;
8. stops the isolated AE process started by the runner in `finally`;
9. uploads `proofs/artifacts/m2-real-host/` whether the proof passes or fails.

This refusal to reuse or terminate a pre-existing AE session is intentional: it prevents an automated proof from killing an unsaved user editing session or proving against stale in-memory host code.

## How ChatGPT triggers a proof

The dedicated control branch is `ae-test/m2-control`. A test trigger consists of resetting/creating that branch from the exact commit to prove and committing `.github/ae-test-trigger/m2.txt`. The branch/path filter starts the real-AE workflow on the self-hosted workstation. The proof result and artifacts can then be read back from the GitHub Actions run.

No P4/P5 proof is triggered by this M2 control branch. P4/P5 remains a separate disposable-project gate until bounded M2 acceptance passes.
