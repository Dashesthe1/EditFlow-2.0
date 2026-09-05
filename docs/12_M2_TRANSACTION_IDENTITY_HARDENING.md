# M2 Transaction and Stable-Identity Hardening

EditFlow 2.0 `0.1.0-dev.3` hardens the clean-room M2 After Effects adapter before any MCP-facing Adobe writes are enabled.

## Status

- Control-plane implementation: code-complete candidate.
- Normal GitHub CI: required before merge.
- Real After Effects acceptance: still required.
- MCP Adobe writes: **disabled**.
- M2 issue #4: **open until the real-host gates pass**.

## Protocol layering

The known-green protocol 1.0 host implementation remains intact. The current host loader composes three checked-in layers:

1. `editflow_host.jsx` — fixed v1.0 command-handler baseline;
2. `editflow_host_hardening.jsx` — protocol 1.1 compatibility, transaction Undo, and precompose replacement identity;
3. `editflow_host_atomicity.jsx` — self-rollback of a failed host mutation if the failed operation changed AE state.

`editflow_host_current.jsx` is the only current-loader entrypoint used by the real-host proof scripts.

This structure lets the v1.0 baseline remain independently reviewable and regression-testable while the v1.1 safety changes are isolated.

## Async transaction execution

The M1 synchronous executor remains unchanged for deterministic simulator tests. M2 adds `AsyncTransactionExecutor` for real asynchronous host adapters.

The async executor preserves the M1 contract:

- frozen execution-plan hash;
- capability and exact-route preflight;
- dependency ordering;
- rollback-boundary grouping;
- committed-boundary ledger recovery;
- no replay of already committed non-idempotent work;
- explicit `ROLLED_BACK` vs `RECOVERY_REQUIRED` state.

Only operations whose host response is `APPLIED` count toward transaction rollback. A host operation returning `FAILED` is expected to be internally atomic.

## Host-operation atomicity

Each ordinary AE mutation is already executed inside its own After Effects undo group by the v1.0 dispatcher. The v1.1 atomicity wrapper observes the project revision before delegation. If the delegated command returns `FAILED` but the AE project revision changed, the wrapper immediately invokes the fixed internal Undo route before returning the failure to the transaction executor.

This prevents the transaction layer from receiving an apparently failed operation that secretly left partial AE mutations behind.

The generic MCP surface does not expose Undo or arbitrary menu commands. `transaction.undo_last` is an internal adapter command used only by the transaction host.

## Revision versus structural fingerprint

After Effects project revision is a monotonic race detector. It is not the definition of project content and can advance during an Undo that restores the prior structure.

Therefore:

- pre-dispatch and committed-boundary resume require exact revision plus structural/environment fingerprints;
- rollback verification requires the same structural project fingerprint, environment fingerprint, and project identity, while allowing the revision to be newer.

The structural fingerprint intentionally excludes active-item selection and project revision. It includes the project path, project items, stable IDs, compositions, layer hierarchy/order, source relationships, timing, transforms, and relevant switches currently represented by the M2 object model.

## Capability/command binding

Protocol 1.1 execution-plan operations encode:

- the declared capability ID;
- the fixed adapter command;
- typed payload data.

The AE transaction host owns the mapping between capability and command. If a plan declares `ae.comp.create` while carrying `comp.remove`, execution is rejected before an AE mutation is sent.

There is still no operation for caller-supplied ExtendScript/JavaScript. Protocol 1.1 has a JSON Schema and a hostile `execute.arbitrary_jsx` negative fixture in CI.

## Stable precompose topology

Protocol 1.1 requires two identities for precompose:

- `stableId` — the new child composition;
- `replacementStableId` — the replacement layer created in the parent composition.

After the underlying precompose succeeds, the v1.1 layer finds the replacement parent layer by the new child composition source, assigns the declared stable ID, and returns it in structural readback.

This closes an important identity hole: a precompose is not considered fully identified merely because its child composition has an EditFlow ID.

## Real After Effects proof paths

### Bounded P1-P3/P4-cleanup proof

`proofs/ae/m2-real-host-proof.jsx`

Runner:

```powershell
.\scripts\windows\run-m2-ae-acceptance.ps1
```

This proof can run inside an existing project because it does not save, close, or replace that project. It creates uniquely identified temporary objects, exercises the real AE baseline, renders a proof artifact, verifies precompose child/replacement IDs, then removes its temporary project items.

It does **not** claim transaction failure-injection rollback or save/reopen identity.

### Disposable P4/P5 proof

`proofs/ae/m2-disposable-p4-p5-proof.jsx`

Runner:

```powershell
.\scripts\windows\run-m2-ae-p4-p5.ps1
```

This proof is intentionally destructive to its own disposable project. The AE script itself refuses before any adapter mutation unless the current project is:

- unsaved; and
- contains zero project items.

It then proves:

- identity survives external rename;
- layer duplication gets a distinct stable ID;
- identity survives reorder;
- precompose child and replacement-layer identities are both stable;
- an injected failed transaction group rolls back earlier applied work;
- IDs survive save/reopen;
- the current dispatcher can be reloaded to simulate reconnect;
- a post-reconnect transfer operation succeeds;
- the disposable project is closed without preserving later proof mutations and AE is left with a new blank project.

## GitHub Actions safety

Both real-AE workflows are manual `workflow_dispatch` jobs requiring a self-hosted Windows runner labeled `editflow-ae`. They do not run on pull requests.

Normal pull-request CI only performs schema validation, TypeScript checking, simulator/fake-host tests, and static safety assertions. A PR update alone can never trigger real After Effects writes.

## M2 exit gate

M2 must remain open and `adobeWritesEnabled` must remain false until all of the following are true on the target workstation:

1. bounded real-AE proof passes and its render/JSON artifacts are inspected;
2. disposable P4/P5 proof passes;
3. CEP transport smoke proves the installed panel/runtime can invoke the current dispatcher, not only the command-line proof route;
4. stable identity is confirmed across rename, reorder, duplicate, precompose child/replacement, save/reopen, and reconnect;
5. failure injection proves both failed-operation atomicity and transaction-group rollback;
6. only capabilities supported by evidence are promoted from `DECLARED` to the corresponding proof maturity;
7. the release proof manifest is tied to the exact Git commit and AE environment fingerprint.

Only after those gates may the MCP surface enable real Adobe writes and M2 issue #4 close.
