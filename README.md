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

## Core architecture

1. **Scene Understanding Graph** — what exists in the footage, where it is, how it moves, and how it occludes other objects.
2. **Edit Memory / Recipe Graph** — what a professional technique requires and how it is constructed.
3. **AE Capability Graph** — what the installed After Effects environment can actually do right now.
4. **Edit Compiler / Planner** — maps recipe + scene + capabilities into an exact execution plan.
5. **Transactional Adobe Executor** — validates, executes, reads back, previews, verifies, and rolls back.

Cross-cutting systems provide dynamic plugin discovery, subsystem adapters, UI fallback, proof infrastructure, project-state safety, and production orchestration.

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

**M5 — Interactive AE Adapters: in progress.**

M4 — Tracking & Isolation is accepted. Commit `a55c0ac` closes the M4 exit gate with bounded live-AE isolation, evidence-backed semantic attachment, visible drift repair/resume, transfer across materially different retained SAM 3.1 fixtures, warm-process reuse, and exact project-baseline restoration.

M5 currently advances through Roto Brush / Refine Edge and the remaining interactive AE subsystem adapters. Retained real-AE evidence covers foreground and background Roto Brush seeds, bounded forward/backward propagation, warm-AE isolation/restore, Refine Edge stroke readback, guarded FREEZE -> FROZEN -> UNFREEZE -> UNFROZEN state truth, visible native manual repair of a known matte defect, stable structural TRACK_MATTE export with exact native Roto preservation, transfer across materially different footage, and exact popup-fault capture plus safe same-process recovery. The next M5 gate is production registration.

M3 — Human-Parity Core remains accepted as the prior human-parity manipulation baseline.

M2 — Adobe Host Baseline remains accepted as the authenticated CEP, readback, rollback/recovery, stable-identity, and baseline CRUD foundation.

Authoritative documents live in `docs/`, machine-readable contracts live in `spec/`, and accepted proof manifests live in `proofs/manifests/` and `proofs/diagnostics/`.
