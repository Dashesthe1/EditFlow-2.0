# EditFlow 2.0

EditFlow 2.0 is a clean-room rebuild of EditFlow as a human-parity AI control plane for Adobe After Effects.

## Clean-room rule

This repository does **not** continue the previous EditFlow implementation. Prior source code, release numbering, partial implementations, runtime state, and architectural assumptions are not a baseline here.

Allowed inputs from earlier work are limited to requirements, lessons learned, acceptance criteria, and creative-workflow knowledge. Every implementation decision must be re-derived and verified in this repository.

## Mission

> If a skilled human can materially manipulate an edit in the installed After Effects environment, EditFlow 2.0 must have a verified path to perform the equivalent operation directly, through a typed subsystem adapter, or through a guarded UI fallback.

The product must let ChatGPT:

- understand footage as persistent semantic objects rather than anonymous pixels;
- reason about editing goals and learned techniques;
- determine whether the installed AE environment can reproduce every required construction step;
- compile those decisions into exact, validated Adobe operations;
- execute against the real After Effects project;
- observe short previews and project readback;
- diagnose and refine viewer-visible defects;
- prove the final result structurally and visually;
- preserve reusable Learning, Training, and Experience Memory.

## Practice: Source Match and raw assembly only

Proceed to do homework preserves the selected Finished edit, raw files and Edit Type.
The Supervisor delivers the first ChatGPT session a scoped instruction before any
matching starts. EditFlow Source Match Service alone analyzes footage and saves exact
source timestamps for every shot. ChatGPT coordinates tool calls and reports status;
it does not inspect footage, select ranges or approve shot matches.

Every full shot range must be verified and durably saved before any AE import. Missing
or ambiguous endpoints block assembly. The service extracts raw ranges at original
speed and assembles them in Finished order in AE, saves an AEP checkpoint, then stops.
There are no effects, retiming, rendering, research, learning, mastery or follow-on
editing processes. Pro Creation retains an empty UI session. Input media is preserved.

See [Practice process](docs/practice-source-workflow.md) and [operator policy](AGENTS.md).
`npm run build:test-runtime` clears emitted JavaScript before compiling.

## Human-parity completion rule

A capability is not complete because an API call succeeds. It is complete only when EditFlow can:

1. express the operation semantically;
2. preflight all requirements;
3. perform the operation in the real AE project;
4. read back the resulting structure and values;
5. verify the viewer-visible result when applicable;
6. recover or roll back safely;
7. reproduce the capability in a second materially different test context.

A recipe may never silently replace a missing capability with a weaker blur, transform, or full-frame approximation. Missing capability requirements must be surfaced before production.

## Fresh versioning

EditFlow 2.0 starts a new development line. Previous EditFlow version numbers have no compatibility or lineage meaning here.

Current product milestone version: **`0.6.0-dev`**.

## Permanent milestone test path

All M# development testing uses the Incremental Proof Engine through `scripts/windows/invoke-editflow-ae-proof.ps1`. `INCREMENTAL_FIRST` is the default and may reuse only content-addressed PASS evidence whose declared dependencies still match. Individual `run-m*.ps1` scripts are proof implementations, not alternate top-level test paths. `FULL_ACCEPTANCE` explicitly bypasses reuse and runs the complete acceptance chain. See `docs/adr/0010-incremental-proof-engine.md`.

## Current phase

**Practice uses Source Match then raw assembly only. Pro Creation remains empty.**

M4 — Tracking & Isolation is accepted. Commit `a55c0ac` closes the M4 exit gate with bounded live-AE isolation, evidence-backed semantic attachment, visible drift repair/resume, transfer across materially different retained SAM 3.1 fixtures, warm-process reuse, and exact project-baseline restoration.

M5 Roto Brush / Refine Edge has completed its guarded production-registration gate. Retained real-AE evidence covers foreground and background seeds, bounded forward/backward propagation, warm-AE isolation/restore, Refine Edge, guarded FREEZE -> FROZEN -> UNFREEZE -> UNFROZEN state truth, visible native manual repair, stable structural TRACK_MATTE export with exact native Roto preservation, transfer across materially different footage, and exact popup-fault capture plus safe same-process recovery. The default desktop runtime remains fail-closed; supplying the digest-bound retained M5 evidence registers only the proven seven-capability envelope, while MASK conversion remains unavailable.

M5 Mocha AE has entered guarded adapter development. Retained real-AE evidence now covers read-only discovery, exact proof-owned application of one `Mocha AE` / `mochaAECC` effect, capped structural readback, and guarded `Launch Mocha AE` activation into one verified Boris FX `Mocha AE` process/window, fixed first-run `Register later` handling, and exact same-process project restoration. The accepted tree binds `Launch Mocha AE` to `mochaAECC-2353`; retained real-AE evidence now also covers one explicit bounded X-Spline planar region with exact Mocha tool identity, one independently verified `Layer 1`, fixed startup-prompt handling, same-process restore, and a 1220.155 ms maximum warm AE roundtrip. Bounded planar tracking is now also accepted: the retained gate seeds exact frame `1`, uses only the exact single-frame `Track To Next Frame` / `Track To Previous Frame` controls, independently verifies tracked endpoints `2` and `0` through `Next Tracked End` / `Previous Tracked End`, restores revision `126` cleanly on the same AE PID, records a `1208.451 ms` maximum warm AE roundtrip, and reports a `551.672 ms` maximum one-frame Mocha solve separately. Repair and export remain unavailable pending independent proofs.

M3 — Human-Parity Core remains accepted as the prior human-parity manipulation baseline.

M2 — Adobe Host Baseline remains accepted as the authenticated CEP, readback, rollback/recovery, stable-identity, and baseline CRUD foundation.

Authoritative documents live in `docs/`, machine-readable contracts live in `spec/`, and accepted proof manifests live in `proofs/manifests/` and `proofs/diagnostics/`.
