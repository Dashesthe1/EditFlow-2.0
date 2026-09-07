# M3 managed null-rig P5 real-AE acceptance — run 2

- Feature PR: #109 (`m3-null-rigs-p5`)
- Accepted P1-P4 parent branch: `m3-null-rigs-p1-p2`
- Accepted P1-P4 parent merge under P5: `09cb3e88eaba3dfbb365f3341e8a847b0f147dc1`
- Exact implementation source under proof: `4736f4ceee6e578cda0a199137295644eeb92607`
- Repository CI before AE launch: run `34141633905` / success
- Accepted control/trigger commit: `ddfb8fb52a850c7efdaf61287bf9572c669b7408`
- Accepted GitHub Actions real-AE run: `34142031586`, run number 2
- Accepted real-AE job: `101805908584`
- Uploaded artifact: `m3-null-rig-p5-proof-34142031586` / artifact id `10026273271`
- Artifact ZIP digest: `sha256:02c752480d2c0acede60a572e40103bb0faf00a2d259f2e732c1c0279410a63d`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- Accepted P3/P4 real-AE baseline: run `34140788458`; acceptance `proofs/diagnostics/m3-null-rig-p3-p4-run1-acceptance.md`

## Preceding non-mutating control attempt

The same CI-green implementation source was first triggered by control commit `0f9b0230efbd7183736dadd30fc46ef0b4ff0539` in real-AE run `34141686583` / job `101804854931`.

That attempt timed out waiting for the initial CEP panel registration before the harness obtained a session. Its retained result had no dispatched responses, both session records were null, After Effects remained on the blank untitled project, and no proof fixture was created. Runner cleanup still returned After Effects process count to zero and uploaded the diagnostic artifact.

No implementation code changed before the accepted retry. Control commit `ddfb8fb52a850c7efdaf61287bf9572c669b7408` changed only the trigger marker to record attempt 2 and the preceding registration miss. The unchanged source then completed P5 end-to-end. This preserves the first attempt as transport/cold-start negative evidence rather than misclassifying it as a managed-null transfer failure.

## Automated proof result

The retained `result.json` reports:

- `proofId: M3_NULL_RIG_P5_REAL_AE`
- `status: ACCEPTED`
- `ok: true`
- `cleanupComplete: true`
- no failure error
- no cleanup errors
- `P5_save_reopen_reconnect_transfer: true`
- P1-P4 recorded as `accepted-baseline-not-replayed`

Every bounded P5 check is true, including:

- proof-only reopen and cleanup scripts were present and the explicit After Effects executable resolved;
- the first authenticated panel negotiated protocol 1.5 and retained protocol 1.4 and protocol 1.1 compatibility;
- the host probe resolved real Adobe After Effects;
- proof began from a blank unsaved project;
- materially different 420x220 source and 900x500 target compositions were created at 30 fps;
- one caller-stable managed true null was created before save;
- one visible child was attached through accepted protocol 1.4 preserve-transform parenting with no five-point comp-space jump;
- transforming only the invisible true null materially drove the visible child before save;
- pre-save protocol 1.5 readback reported the exact true-null identity, transform, and one-child topology;
- public protocol 1.1 `project.save` produced and read back the fixed runner-owned `.aep`;
- the saved fixture contained the expected four project items and stable layer indices;
- the proof-only reopen script reopened exactly that saved project, reloaded the protocol-1.5 dispatcher, and reported four project items;
- the loopback broker was stopped and restarted and a distinct authenticated panel session negotiated protocol 1.5 with 1.4/1.1 compatibility;
- the reopened project retained the exact saved structural fingerprint and stable layer positions;
- protocol 1.5 true-null readback after reconnect matched the pre-save semantic rig snapshot exactly;
- protocol 1.4 parenting readback after reconnect preserved the exact parent relationship and all five driven comp-space geometry points;
- post-reconnect preserve-transform detach cleared the parent relationship while preserving all five driven geometry points;
- protocol 1.5 removal of the transferred managed null applied;
- after transferred removal the project contained exactly the two core compositions, proving the reopened ownership marker was sufficient to reclaim the null's backing `SolidSource` / support ownership rather than leak it;
- readback of the removed transferred rig rejected with `NULL_RIG_NOT_FOUND`;
- a second fresh managed true null was created after reconnect, read back exactly, removed, and then rejected with `NULL_RIG_NOT_FOUND`;
- after the fresh create/readback/remove cycle the exact two-composition core structural fingerprint was restored;
- proof-only cleanup verified exactly those two core compositions plus the detached child, retained the saved `.aep`, discarded only the disposable active proof project, and restored the original blank unsaved project fingerprint and item count;
- the self-hosted runner gracefully cleaned its owned After Effects process and finished at zero After Effects processes.

## Distinct authenticated transfer session

The initial authenticated session was:

- session id: `66f17f6c-11f0-4e89-a8fb-401b402dc3d9`
- protocol: `1.5.0`
- supported proof protocols: `1.5.0`, `1.4.0`, `1.1.0`
- extension: `com.editflow2.bridge.panel` / `0.1.0-dev.5`

After project reopen and broker restart, the reconnected session was:

- session id: `4af25b7a-476f-4ad9-88e7-e2e43e972e58`
- protocol: `1.5.0`
- supported proof protocols: `1.5.0`, `1.4.0`, `1.1.0`
- extension: `com.editflow2.bridge.panel` / `0.1.0-dev.5`

The different session IDs prove fresh authenticated transport authority rather than reuse of the pre-save registration.

## Exact managed true-null transfer

Proof generation prefix: `M3_NULL_RIG_P5_1788797508337`.

Before save, the managed true null read back as:

- stable id: `M3_NULL_RIG_P5_1788797508337_RIG_MAIN`
- name: `M3_NULL_RIG_P5_1788797508337 Transfer Control`
- layer index: `1`
- `isNull: true`
- `threeDLayer: false`
- enabled
- no parent
- exact child: `M3_NULL_RIG_P5_1788797508337_CHILD_LAYER` at layer index `2`
- position: `[410, 290, 0]`
- scale: `[88, 88, 100]`
- rotation: `-19`
- opacity: `0`

After save, fixed `.aep` reopen, dispatcher reload, broker restart, and the distinct authenticated 1.5 session, protocol 1.5 reported the same stable id, name, layer index, true-null identity, child topology, and transform values exactly.

The attached child's driven five-point comp-space geometry before save was:

- top-left: `[285.529083251953, 129.52409362793]`
- top-right: `[708.95166015625, 92.4794235229492]`
- bottom-right: `[721.606689453125, 237.126892089844]`
- bottom-left: `[298.184112548828, 274.171569824219]`
- center: `[503.567901611328, 183.325500488281]`

Those five points were identical after reopen/reconnect while the child remained parented to the true null. After post-reconnect preserve-transform detach, all five points remained identical again while `hasParent` became false.

## Managed ownership transfer and fresh authority

The saved project contained four project items before reopen. After reconnect, detaching the child and removing the transferred managed null reduced the active project to exactly two items: the source and target compositions. The transferred rig could no longer be read back and rejected with `NULL_RIG_NOT_FOUND`.

That result is important for the managed-null envelope: the ownership metadata written before save survives the `.aep` round trip strongly enough for a fresh protocol-1.5 session to reclaim the true null's backing `SolidSource` / support ownership without broad project cleanup.

The proof then created a second true null under stable id `M3_NULL_RIG_P5_1788797508337_RIG_POST_RECONNECT`, read it back as `isNull: true` with no children, removed it, and proved it absent. After that fresh lifecycle, the exact two-composition core fingerprint returned unchanged.

## Reopen and cleanup markers

The retained reopen marker reports:

- `proofId: M3_NULL_RIG_P5_REOPEN`
- `ok: true`
- `dispatcherReady: true`
- `itemCount: 4`
- `hostProjectRevision: 117`
- exact fixed saved-project path

The retained cleanup marker reports:

- `proofId: M3_NULL_RIG_P5_CLEANUP`
- `ok: true`
- exact proof generation prefix
- `verifiedFinalProjectItemCount: 2`
- `blankItemCount: 0`
- retained fixed saved-project path

## Retained evidence hashes

- `m3-null-rig-p5-transfer.aep`: `d528b092bdb207d4ffbdb6edfde4b75edc1eb088911bb327028147258bededaa`
- `result.json`: `1e1679ac850813983f7a44897a4f39afbc23b545d295aaa373a3e1f26b3d3325`
- `reopen-result.json`: `f8fe333a61170865bac7a56d9402a465fff09edd3df6df6fed121f9337a53fb3`
- `cleanup-result.json`: `7b5777a4921ff084a4d16e41320e564eecff73fb4c7b9d63b641da510e321678`
- `panel-bootstrap.log`: `0ccc206f33842ac83a329bdde21aadc7f4a679120a0220d202b2c162c326e320`
- `startup-diagnostics.log`: `fd56a0a5d12b67bdc3c0a89b71782d83b172006fbe3a8761171bcf8801d7f7e4`

## Acceptance

**P5 save/reopen/reconnect transfer is accepted for the exercised managed true-null lifecycle/topology envelope on real After Effects.**

The proof establishes that a managed true null can be saved and reopened with exact stable identity, transform, child topology, and driven visible geometry; a distinct authenticated protocol-1.5 session can regain typed authority; the transferred managed null can be detached and removed with exact backing-source ownership reclamation; and a fresh post-reconnect managed-null lifecycle can execute and return the project to its exact core fingerprint.

Together with the previously accepted P1/P2 and P3/P4 evidence, this completes the managed null-rig P1-P5 proof ladder for the exercised protocol-1.5 envelope. It does not claim unrelated M3 or later Human-Parity capabilities.