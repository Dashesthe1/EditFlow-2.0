# M2 After Effects Host Adapter Candidate

EditFlow 2.0 `0.1.0-dev.2` introduces the first clean-room After Effects host-adapter implementation candidate.

## Implemented in repository CI

- versioned AE adapter protocol `1.0.0`;
- fixed 21-command allowlist; arbitrary JSX/JavaScript is not a protocol operation;
- CEP `evalScript` transport that can invoke only `EditFlow2_dispatch(serializedRequest)`;
- audited ExtendScript dispatcher with a fixed command-handler table and no dynamic code evaluator;
- control-plane project/environment fingerprint preflight;
- immediate AE host-revision check before host mutations;
- structural project/composition/layer readback;
- stable-ID metadata for project items/layers created by EditFlow;
- baseline commands for project save, comp CRUD/settings, import, layer add/duplicate/remove/reorder, transforms/timing, effects, keyframes, expressions, precompose, render capture, and object readback;
- filesystem allowlist policy for explicit save/import/render paths;
- desktop-host session bootstrap that merges live AE adapter declarations into the M1 capability registry;
- JSON Schema request-envelope validation and security fixtures;
- fake-host protocol, stale-state, readback, and injection-safety tests.

## Still gated

**Real After Effects acceptance is not yet claimed.** The MCP status remains `adobeWritesEnabled: false` and reports `realAeAcceptance: PENDING` until the Windows AE workstation proves the adapter end-to-end.

M2 issue #4 remains open until the real-host proof ladder passes:

1. P1 typed request validation;
2. P2 structural readback in actual AE;
3. P3 visual proof for pixel-changing operations;
4. P4 rollback/recovery/failure injection;
5. P5 transfer/restart/save-reopen validation.

Stable identity must specifically survive rename, layer reorder, duplicate, precompose, save/reopen, and reconnect before M2 can be closed.

## Security invariant

The adapter accepts **data parameters only**. The only CEP script constructed by the TypeScript transport is the fixed dispatcher invocation. The AE-side host script selects a handler from its own command table. Payload strings are never treated as ExtendScript source.

## Fingerprint policy

The M2 project fingerprint includes structural editing state but excludes incidental active-item selection, avoiding stale-plan rejection merely because the user clicks a different viewer/comp. Environment fingerprints exclude project-open state and describe the adapter/AE/OS environment instead.
