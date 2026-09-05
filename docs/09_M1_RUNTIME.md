# M1 Core Runtime

This document records the implemented scope of EditFlow 2.0 `0.1.0-dev.1`.

## Implemented

- deterministic canonical SHA-256 fingerprints for project, environment, and frozen plans;
- typed capability registry with static taxonomy plus adapter declarations;
- deterministic route ordering: native typed -> host adapter -> subsystem adapter -> plugin adapter -> guarded UI;
- capability and exact-route preflight;
- immutable plan hashing/freeze after cross-reference validation;
- project revision, project fingerprint, and environment fingerprint drift rejection;
- operation dependency validation and cycle rejection;
- rollback-boundary validation and contiguous atomic grouping;
- in-memory transaction proof ledger with export/import for restart simulation;
- deterministic committed-boundary resume;
- duplicate prevention for already committed groups, including non-idempotent operations;
- snapshot rollback for a failed simulated atomic group;
- simulated project host and M1 behavioral acceptance tests;
- MCP status diagnostics reporting M1 runtime readiness.

## Deliberately not implemented yet

There are **no After Effects writes in M1**. All static AE capabilities remain `ADAPTER_REQUIRED` until the new M2 host adapter registers real typed routes and proves them.

M1 recovery proves exact resume from committed transaction boundaries. Recovery from a process crash in the middle of a host-side atomic group will be completed with the durable host snapshot/lease implementation as the M2 adapter is introduced; M1 already defines and tests rollback within a live execution attempt.

## M1 safety invariant

A plan cannot execute merely because After Effects conceptually supports an action. The capability must be registered for the current environment, the exact selected route must be available, the plan must match the observed project/environment fingerprints, and its dependency/rollback graph must validate before execution.
