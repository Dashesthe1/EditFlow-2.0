# Execution Safety and Transactions

## Goal

EditFlow 2.0 must be powerful enough for human-parity editing without becoming an uncontrolled scripting shell. Every project mutation is performed through a typed, auditable, revision-aware transaction.

## State model

The executor maintains:

- project identity;
- project revision;
- structural fingerprint;
- active composition/layer/item IDs;
- adapter/capability environment fingerprint;
- transaction ID;
- operation group sequence;
- before/after snapshots for affected objects;
- proof ledger references.

Stable IDs are EditFlow identities mapped to current AE objects. Mappings are revalidated on every transaction boundary.

## Transaction lifecycle

### 1. Observe

Read current project state and the smallest complete dependency neighborhood needed by the plan.

### 2. Preflight

Reject before write if any of the following fail:

- project/revision/fingerprint mismatch;
- missing capability or adapter;
- unresolved semantic binding;
- invalid/missing stable ID;
- schema/range/type violation;
- timing outside source/comp bounds unless explicitly supported;
- cyclic dependency or invalid layer relation;
- destructive operation without declared recovery strategy;
- required proof route unavailable;
- unexpected modal/UI state for UI-fallback operations.

### 3. Plan freeze

Hash the validated execution plan and bind it to the observed project revision. Writes may not silently mutate the plan after freeze. Any adaptive refinement becomes a new explicit plan revision.

### 4. Execute atomic groups

Operations are grouped by rollback boundary. Within a group, ordering is deterministic and dependency-aware.

### 5. Readback

After each group, read the affected objects and compare against expected structural invariants. Report applied/no-op/failed explicitly for every operation.

### 6. Visual checkpoint

If the group can materially change pixels, run its declared preview/proof checkpoint when required by the plan.

### 7. Commit or recover

If structural and visual invariants pass, commit the group. If they fail, run the declared rollback/compensation route or halt in a recoverable diagnostic state.

## Idempotency

Every operation declares one of:

- `IDEMPOTENT` — repeated execution produces the same state;
- `CHECK_THEN_APPLY` — executor detects already-satisfied state;
- `NON_IDEMPOTENT` — operation requires transaction ownership and duplicate prevention.

Production orchestration must be restart-safe. A reconnect must be able to determine which plan groups were committed without guessing.

## Destructive-risk classes

- `R0_READ_ONLY` — no project mutation.
- `R1_REVERSIBLE` — direct property/keyframe changes with known previous state.
- `R2_STRUCTURAL` — layer/item/precomp/mask/effect hierarchy mutation.
- `R3_DESTRUCTIVE` — delete/replace/interpret/collect operations or workflows that can invalidate broad dependencies.
- `R4_EXTERNAL_UI` — guarded UI operations whose host state may not be completely representable through the object model.

Higher classes require progressively stronger snapshots, proof, and recovery constraints.

## Arbitrary scripting policy

The ChatGPT-facing surface never accepts arbitrary JSX/JavaScript/OS commands for execution in AE. If a capability requires scripting, an approved adapter owns the script template and exposes a typed schema. Runtime parameters are validated and escaped; the generated script is bounded to that adapter's declared behavior.

## UI fallback policy

A UI fallback transaction must:

1. identify exact application/version/window/panel;
2. verify expected pre-action pixels/control state;
3. perform only declared bounded input actions;
4. stop on unexpected dialog, focus loss, or layout ambiguity;
5. capture post-action evidence;
6. read back project state where possible;
7. mark proof confidence and limitations;
8. never chain arbitrary UI actions outside the capability adapter.

## Project drift

If the user or another process changes AE between observation and apply, EditFlow must detect revision/fingerprint drift and re-observe affected state. It must not force an operation through stale state.

## Rollback

Rollback is capability-specific:

- property/keyframe operations restore captured values;
- created objects are removed only if transaction ownership is proven;
- moved/reparented objects restore original relationships/order;
- structural operations preserve stable ID mapping in the ledger;
- irreversible external/subsystem operations use compensation or explicit recovery checkpoints.

The executor must distinguish `ROLLED_BACK`, `COMPENSATED`, and `RECOVERY_REQUIRED`.

## Proof ledger

Every transaction emits immutable evidence including:

- plan hash and revision;
- environment fingerprint;
- operation inputs (with secrets/redactions where necessary);
- per-operation outcome;
- structural readback summary;
- preview/proof artifacts;
- invariant results;
- rollback/compensation events;
- final project revision/fingerprint.

This ledger is the source for release proofs and Experience Memory outcome classification.
