# M3 Parenting P1/P2 Real-AE Acceptance

## Acceptance boundary

**Accepted:** protocol 1.4 parenting/unparenting P1 validation/rejection and P2 structural readback on real Adobe After Effects.

This acceptance promotes the exercised parenting capabilities to **STRUCTURAL** proof maturity while keeping capability status **PARTIAL**.

This acceptance does **not** claim:

- P3 rendered visual equivalence;
- P4 induced-failure rollback proof;
- P5 save/reopen/reconnect transfer;
- complete restoration of the child's original local transform decomposition after unparenting;
- unrelated null-rig, layer-control, Graph Editor, or other M3 capability.

## Accepted source and control

- Corrected harness/source commit: `026e83dabe6e354c192f36518234f43e559048e7`
- Isolated control/trigger commit: `9b41d8eb576fa809d4aae3ede6e381160ecb483d`
- Workflow run: `34082201184`
- Run attempt: `1`
- Real-AE job: `101619497171`
- Adobe After Effects host: `25.6.6x4`, build `4`, Windows 64-bit

## Retained artifact

- Artifact: `m3-parenting-p1-p2-proof-34082201184`
- Artifact id: `10004053330`
- Artifact ZIP SHA-256: `1ebe49e3769fb02f23d2c4bcba57222017b379ee8a340fda21ad16248356d423`

Retained file SHA-256 values:

- `panel-bootstrap.log`: `465ec63b6dfe37390a2d481934f3f2512e1407da8474cb584b81ae1b18fbfb7e`
- `result.json`: `151ce52b1f6525416ec103412d3b3c18a7ea954a4939af52585ffb79eb81d6b8`
- `startup-diagnostics.log`: `1a9782a87f15691f7acb509b052ecea51f386175fb61663c906273d656dee4fe`

The retained `result.json` reports `status: PASS`, `ok: true`, `cleanupComplete: true`, P1 true, P2 true, and P3/P4/P5 false.

## Transport/session evidence

The proof registered an authenticated CEP session with:

- session id `15c55d88-6d8a-4edc-9874-b9aee2130251`;
- negotiated protocol `1.4.0`;
- supported protocols `1.4.0` and `1.1.0`;
- extension version `0.1.0-dev.4`.

The ordinary v1.1 setup path also completed a successful Adobe After Effects host probe before protocol-1.4 parenting commands were exercised.

## Fixture evidence

The proof intentionally used non-identity parent and child transforms so direct `Layer.parent` compensation could not pass trivially through an identity parent.

Normalized host transform readback before parenting:

Parent:

- anchor: `[160, 160]`
- position: `[430, 210]`
- scale: `[135, 80]`
- rotation: `27`
- opacity: `100`

Child:

- anchor: `[160, 160]`
- position: `[220, 120]`
- scale: `[75, 125]`
- rotation: `-12`
- opacity: `100`

The corrected harness uses the already-proven normalized `layer.set_transform` response readback for these setup assertions instead of relying on the older project-snapshot host-vector representation.

## P1 validation/rejection evidence

All P1 checks passed with unchanged host revision and unchanged project fingerprint across each rejected mutation:

1. Self-parenting was rejected with `PARENT_SELF_REFERENCE`.
2. A stale expected host revision was rejected with `HOST_REVISION_CONFLICT`.
3. After the child was parented, assigning the parent beneath its child was rejected with `PARENT_CYCLE`.

No rejected P1 request changed the exercised project structure.

## P2 structural/readback evidence

Initial child state:

- no parent;
- exact child stable-id readback;
- child comp-space anchor: `[220, 120]`.

After `layer.set_parent_preserve_transform`:

- command outcome: `APPLIED`;
- exact child and parent stable IDs were returned;
- project snapshot reported the exact expected parent stable ID;
- child comp-space anchor remained `[220, 120]`;
- child local transform changed substantially, demonstrating After Effects compensation rather than a trivial identity-parent pass:
  - position `[-8.86704818971589, 178.93427221044, 0]`
  - scale `[65.9749835285886, 131.573440284287, 100]`
  - Z rotation `-52.6897402246743`;
- repeating the same set-parent request returned `NO_OP` with the same exact parent identity.

After `layer.clear_parent_preserve_transform`:

- command outcome: `APPLIED`;
- exact no-parent readback was returned;
- project snapshot reported the parent cleared;
- child comp-space anchor remained `[220, 120]`;
- repeating clear returned `NO_OP`;
- final readback again reported no parent and the same `[220, 120]` comp-space anchor.

After clear, local transform decomposition was:

- position `[220, 120, 0]`
- scale `[68.3866300395667, 137.088199763256, 100]`
- Z rotation `-25.6897402246743`.

Those post-clear local scale/rotation values differ from the initial local values. That is **not** hidden by this acceptance. A rotated parent with non-uniform scale can produce transform decomposition/shear behavior even while an observed point remains fixed. Therefore P2 acceptance is limited to the proven structural relationship, exact identity/readback/idempotency, rejection behavior, and the exercised comp-space anchor preservation. P3 must independently establish rendered/multi-point visual equivalence before any broader no-jump visual claim is made.

## Cleanup evidence

The proof removed its temporary target/source compositions, restored both the exact pre-proof item count and project fingerprint, and completed with no cleanup errors. The self-hosted runner's final diagnostics confirmed zero remaining After Effects processes.

## Attempt history

An earlier control run, `34081742748`, is retained as negative/non-acceptance evidence:

- Attempt 1 failed before any panel session or project mutation with `CEP_PANEL_REGISTRATION_TIMEOUT`; no protocol responses were produced and final workstation cleanup confirmed zero After Effects processes.
- Attempt 2 registered protocol 1.4, passed the host probe, created the fixture, and restored the exact baseline during cleanup, but failed a fixture assertion before parenting commands were exercised. The assertion used the older project-snapshot representation for AE vector transforms even though both `layer.set_transform` writes returned `APPLIED`. The harness was corrected to use the existing normalized transform response readback, passed repository CI, was synced to the isolated control branch without touching the trigger marker, and was then rerun through a fresh trigger-only merge.

The earlier failures are not accepted parenting evidence and are retained to distinguish startup/harness defects from the accepted real-AE protocol behavior.

## Result

**M3 protocol 1.4 parenting P1/P2 is accepted at STRUCTURAL maturity for the exercised preserve-transform set/clear/readback behavior.**

Next proof boundary: P3 should validate multiple comp-space points/bounds and rendered output across parent/set/clear; P4 should inject a failure after a parenting mutation and prove immediate rollback; P5 should separately prove save/reopen/reconnect transfer.
