# M2 Windows / Real After Effects Acceptance — Complete

M2 required the clean-room dispatcher and authenticated CEP transport to execute inside the installed Windows After Effects environment. That gate is now complete for the declared target class: Windows + After Effects 2025 (`25.6.6`) + adapter protocol `1.1.0`.

## Accepted proof set

### Authenticated bounded and final-baseline proof

Run `34022332767` on the self-hosted `editflow-ae` workstation proved the checked-in CEP extension and host bundle end-to-end.

The runner:

1. refused any pre-existing AE session;
2. installed the checked-out CEP bundle;
3. cold-launched the declared AE 2025 executable;
4. waited for a stable real AE project window;
5. delivered only the fixed repository panel bootstrap;
6. required bootstrap execution evidence;
7. required authenticated CEP registration;
8. ran the bounded real-AE proof;
9. ran the final baseline coverage proof in the same authenticated session;
10. removed temporary proof state and stopped only the isolated AE process set.

The bounded proof reports `PARTIAL_PASS` intentionally because its scope ends at P3 plus bounded cleanup. It produced a valid `m2-proof.mp4` render artifact and structural result. The final baseline result reports `PASS` and includes the remaining M2 comp/layer/effect/keyframe/media CRUD/readback coverage.

Artifact: GitHub Actions artifact `9985929435` from run `34022332767`.

### Dedicated P4/P5 disposable proof

Run `34013038916` reports `PASS` and covers the destructive/restart cases that the bounded proof intentionally excludes:

- induced failure and rollback;
- transaction undo of an earlier applied operation;
- rename-stable identity;
- layer duplicate/reorder identity;
- precompose child and replacement identity;
- save/reopen;
- dispatcher reconnect;
- stable IDs after reopen;
- post-reconnect transfer and cleanup.

Artifact: GitHub Actions artifact `9983054244`.

## Closure checklist

- [x] Bounded proof succeeds on the target AE workstation.
- [x] Render and structural result artifacts are produced and inspected.
- [x] P4 failure-injection rollback passes.
- [x] P5 rename/reorder/duplicate/precompose/save/reopen/reconnect stable identity passes.
- [x] Installed CEP transport calls the fixed host dispatcher through the authenticated local bridge.
- [x] Final M2 baseline CRUD/readback coverage passes, including transform anchor/vector readback and keyframe CRUD.
- [x] Capability registry promotion is evidence-scoped rather than blanket `FULL`.
- [x] Real Adobe writes are enabled in the MCP status contract only after the proof set is complete.

## Safety invariants retained after acceptance

M2 acceptance does not weaken the safety model:

- no generic arbitrary-code protocol route;
- typed command allowlist only;
- explicit host revision and project fingerprint checks;
- stable-ID based targeting;
- guarded filesystem paths for save/import/render;
- failed host mutations self-roll back when required;
- transaction rollback is available for grouped recovery;
- proof harnesses never attach destructive acceptance to an unowned user AE session.

## Evidence interpretation

`P1_P5_ACCEPTED` is a milestone verdict, not a claim that every individual command has P5 maturity. Individual capability records retain their own highest demonstrated maturity. `FULL` is reserved for capabilities with P5/`TRANSFER` evidence; lower-maturity baseline operations remain usable but explicitly `PARTIAL`.

With this checklist complete, issue #4 can close and development advances to M3 Human-Parity Core (`0.4.0-dev`).
