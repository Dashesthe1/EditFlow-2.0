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

## Production architecture

Practice and Pro Creation use one durable production queue. ChatGPT directly inspects
provided footage, chooses exact ranges, cuts, audio, effects, transitions, property values
and corrections, and reviews the actual final AE render. Native adapters execute explicit
operations with revision checks, readback, rollback and retained receipts.

The old footage matcher/ranker, Editor Brain, M6 synthesis/correction/fidelity engines,
tutorial/recipe compilers, formula curve generators, automatic tracking repair and local
Qwen visual drivers have been deleted with their launchers and certification controls.
Historical evidence and preset learning data remain readable, with no executable fallback.
The selected preset notebook retains worked and failed examples, ordered settings, reasons,
checks and mistakes to avoid. See [current policy](docs/chatgpt-editorial-authority.md).

`globalOperation:true` declares a deliberate broad change after whole-edit coverage.
Without it, an AE mutation may affect at most max(3, ceil(clip phases × 25%)) declared
phases. This protects completed work; ChatGPT still chooses when a global change is needed.

`npm run build:test-runtime` clears emitted JavaScript before compiling, so retired code
cannot remain available through a stale build.

## Source Match measurements

The user-authorized Source Match Service is the current read-only movie-copy
measurement path. It does not choose an edit, import footage or write AE.
v1.6 checks altered shots using measured SIFT/ORB frame maps, distributed pixel
regions, denser reference samples near boundaries, independent spatial gradients
and signed changing pixels across a sequence. Original author projects are not
required for movie-section origin verification. Fresh origin evidence is retained
in `originVerifications`, `originSummary` and per-shot `origin-evidence.json`.

Movie-section origin and exact source trims are separate claims. CONFIRMED origin
requires multiple fresh mapped frames, independent edge/change witnesses and a
completed competing-location review; it never inserts a source timestamp beneath
an unobserved black/occluded endpoint. Existing full-range gates and direct GPT
review still control cutting and AE assembly. See
[validation](scripts/source-match/BENCHMARK.md) and [operator policy](AGENTS.md).

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

**ChatGPT direct editorial authority is the current production workflow.**

M4 — Tracking & Isolation is accepted. Commit `a55c0ac` closes the M4 exit gate with bounded live-AE isolation, evidence-backed semantic attachment, visible drift repair/resume, transfer across materially different retained SAM 3.1 fixtures, warm-process reuse, and exact project-baseline restoration.

M5 Roto Brush / Refine Edge has completed its guarded production-registration gate. Retained real-AE evidence covers foreground and background seeds, bounded forward/backward propagation, warm-AE isolation/restore, Refine Edge, guarded FREEZE -> FROZEN -> UNFREEZE -> UNFROZEN state truth, visible native manual repair, stable structural TRACK_MATTE export with exact native Roto preservation, transfer across materially different footage, and exact popup-fault capture plus safe same-process recovery. The default desktop runtime remains fail-closed; supplying the digest-bound retained M5 evidence registers only the proven seven-capability envelope, while MASK conversion remains unavailable.

M5 Mocha AE has entered guarded adapter development. Retained real-AE evidence now covers read-only discovery, exact proof-owned application of one `Mocha AE` / `mochaAECC` effect, capped structural readback, and guarded `Launch Mocha AE` activation into one verified Boris FX `Mocha AE` process/window, fixed first-run `Register later` handling, and exact same-process project restoration. The accepted tree binds `Launch Mocha AE` to `mochaAECC-2353`; retained real-AE evidence now also covers one explicit bounded X-Spline planar region with exact Mocha tool identity, one independently verified `Layer 1`, fixed startup-prompt handling, same-process restore, and a 1220.155 ms maximum warm AE roundtrip. Bounded planar tracking is now also accepted: the retained gate seeds exact frame `1`, uses only the exact single-frame `Track To Next Frame` / `Track To Previous Frame` controls, independently verifies tracked endpoints `2` and `0` through `Next Tracked End` / `Previous Tracked End`, restores revision `126` cleanly on the same AE PID, records a `1208.451 ms` maximum warm AE roundtrip, and reports a `551.672 ms` maximum one-frame Mocha solve separately. Repair and export remain unavailable pending independent proofs.

M3 — Human-Parity Core remains accepted as the prior human-parity manipulation baseline.

M2 — Adobe Host Baseline remains accepted as the authenticated CEP, readback, rollback/recovery, stable-identity, and baseline CRUD foundation.

Authoritative documents live in `docs/`, machine-readable contracts live in `spec/`, and accepted proof manifests live in `proofs/manifests/` and `proofs/diagnostics/`.
