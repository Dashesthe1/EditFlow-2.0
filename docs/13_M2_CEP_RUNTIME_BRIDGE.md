# M2 CEP Runtime Bridge

EditFlow 2.0 `0.1.0-dev.4` adds the installable CEP runtime path that connects the local desktop control plane to the fixed After Effects dispatcher.

## Why this exists

The M2 command-line After Effects proofs demonstrate that the checked-in host dispatcher can execute inside real AE. They do not prove that the production CEP transport can carry the same typed requests from the desktop runtime into the host.

The CEP runtime bridge closes that gap without making the panel itself a network server.

## Runtime topology

```text
MCP / desktop runtime
        |
        v
LoopbackCepBroker (Node)
127.0.0.1 + random token
        |
        v
CEP panel polls /v1/next
        |
        v
window.__adobe_cep__.evalScript
        |
        v
EditFlow2_dispatch(serializedRequest)
        |
        v
After Effects host adapter
```

The reverse response follows the same path back to the pending desktop request.

## Security properties

### Loopback-only binding

The broker binds explicitly to `127.0.0.1`. It does not listen on LAN interfaces.

### Installation-specific authentication

`scripts/windows/install-editflow-cep.ps1` generates a fresh 32-byte cryptographic random token. The token is written only to:

- `%LOCALAPPDATA%\EditFlow2\bridge-config.json` for the desktop runtime;
- the installed CEP extension's generated `client/runtime-config.js` for the panel.

The installer does not print the token. Every broker HTTP request requires `X-EditFlow-Token`, and comparison is timing-safe.

### Fixed dispatcher only

The panel constructs exactly one type of host script call:

`EditFlow2_dispatch(<serialized request JSON>)`

The request remains data. The panel exposes no arbitrary ExtendScript/JavaScript command and does not use `eval()` or `new Function()`.

### Correlation checks

The broker verifies protocol, request ID, transaction ID, operation ID, capability ID, and command before accepting a panel response.

### Reconnect delivery

Commands are leased rather than discarded when a panel polls them. If the panel reloads and registers a new session before acknowledging a command, outstanding leases are released and the request can be delivered to the new session. The transaction layer still owns idempotency and committed-boundary semantics.

## CEP extension package

Template:

`packages/adapters/ae-cep/extension/`

The extension uses:

- CEP manifest version 12;
- host `AEFT`;
- CSXS runtime 12;
- a small status panel named **EditFlow 2.0 Bridge**;
- `host/bootstrap.jsx`, which loads the installed copies of the current EditFlow AE host scripts.

The panel is transport/status infrastructure only. It is not intended to become a parallel video editor interface.

## Windows installation

From the repository root:

```powershell
.\scripts\windows\install-editflow-cep.ps1
```

The installer:

1. creates a new local broker token;
2. installs the extension under the current user's Adobe CEP extensions directory;
3. copies the current checked-in AE host dispatcher layers into the extension;
4. writes matching desktop/panel runtime configuration;
5. enables CEP 12 `PlayerDebugMode` for the current Windows user unless `-SkipDebugMode` is supplied.

After installation, restart After Effects and open:

**Window > Extensions (Legacy) > EditFlow 2.0 Bridge**

The panel should show a local-runtime connection once the broker is running.

Uninstall helper:

```powershell
.\scripts\windows\uninstall-editflow-cep.ps1
```

The uninstall helper leaves `PlayerDebugMode` unchanged because it is a shared Adobe CEP development preference.

## Read-only CEP smoke proof

With the extension installed, After Effects running, and the EditFlow bridge panel open:

```powershell
.\scripts\windows\run-m2-cep-smoke.ps1
```

The runner builds the current TypeScript runtime, starts the loopback broker using the locally generated config, waits for the panel registration, then sends only:

- `host.probe`;
- `project.inspect`.

It writes:

`proofs/artifacts/m2-cep-smoke/result.json`

A pass proves that the actual installed CEP panel can:

1. authenticate to the desktop broker;
2. receive a typed protocol 1.1 request;
3. invoke the current fixed AE dispatcher through CEP;
4. return a correlated response to the desktop runtime;
5. expose the expected After Effects host/environment and project state.

No Adobe project mutation is performed by this smoke proof.

## Manual self-hosted route

`.github/workflows/m2-cep-smoke.yml` runs only through `workflow_dispatch` on a Windows self-hosted runner labeled `editflow-ae`.

It assumes the CEP extension is already installed and After Effects is running with the bridge panel open. A pull request cannot trigger this workflow.

## M2 relationship

M2 issue #4 still cannot close from this package alone. The final acceptance set is:

1. normal repository CI green;
2. real CEP transport smoke PASS;
3. bounded real-AE baseline proof PASS, including render evidence;
4. disposable P4/P5 rollback + stable-identity proof PASS;
5. proof artifacts inspected and tied to the exact Git commit/environment;
6. only then promote proven capability maturity and enable MCP Adobe writes.

Until those gates pass, `adobeWritesEnabled` remains false.
