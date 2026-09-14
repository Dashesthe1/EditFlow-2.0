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

Current product milestone version: **`0.5.0-dev`**.

## Current phase

**M4 — Tracking & Isolation: in progress.**

M3 — Human-Parity Core is accepted. Its authenticated real-AE protocol stack spans 1.2 through 2.0 and covers literal mask/Bezier geometry, compositing and arbitrary track mattes, parenting/null/layer controls, exact temporal interpolation/ease, manual spatial Graph Editor tangents, and marker/motion controls. The M3 exit gate passed with an integrated object/mask-driven transition whose curved mask geometry, matte relationship, temporal easing and spatial trajectory were structurally exact and viewer-visible rather than approximated. The construction survived save/reopen and a distinct authenticated CEP reconnect, then transferred exactly to materially different footage. Routine integrated P3 execution remained below the 30-second warm-AE target; the full save/reopen/reconnect/two-fixture P5 chain is recorded as a bounded lifecycle exception.

M2 — Adobe Host Baseline remains the proven real-AE foundation: authenticated CEP protocol 1.1 transport, bounded render/readback, rollback/recovery, stable identity through save/reopen/reconnect, and final baseline CRUD/readback all passed on the declared Windows / After Effects 2025 environment.

M4 now advances through point tracking, two-point rotation/scale tracking, four-point and perspective tracking, mask tracking, face tracking, stabilization, semantic attach points, subject/object segmentation, segmentation-to-mask/matte export/materialization, and manual repair/resume. Retained real-AE evidence now covers point tracking, guarded native analysis, two-point transform derivation, four-point perspective/homography derivation, native Position stabilization, protocol 2.4 Feature Center repair followed by guarded Analyze Forward and Analyze Backward resume with independent protocol 2.1 verification, and deterministic segmentation-raster materialization through exact media import, 2D crop alignment, target timing, LUMA track-matte binding, structural readback, induced failure rollback/reapply, pixel-validated visual isolation, retained render emission, and full warm-project baseline cleanup. The materialization proof passes repeatably in the persistent warm AE process without restarting After Effects. A fail-closed local SAM 3.1 segmentation-provider foundation enforces exact source/provenance binding, explicit SAM 3.1 checkpoint selection, and byte-verified mask artifacts; the configured SAM 3 environment now has the `sam3` package plus CUDA/BF16 support, but no Hugging Face token or local SAM checkpoint is available, so checkpoint-backed live SAM 3.1 inference and provider promotion remain unclaimed. Automatic confidence/drift/occlusion/explicit-identity escalation is now structurally modeled and runtime-gated alongside the accepted repair/resume surface. Exact mask-point repair is now runtime-registered with retained warm real-AE evidence for static-path vertex correction through protocol 1.2: exact post-write readback, typed Undo restoration, exact reapply, pixel-validated viewer-visible correction, and full proof-owned baseline cleanup all pass without restarting After Effects. Tangent-only and animated exact-key mask repair remain structurally tested rather than live-proven. Automatic corrective recovery is now visually promoted for every V1-eligible automatic failure reason—persistent low tracking confidence, persistent drift, and explicit identity-confidence loss—on independently retained Analyze Forward routes: the automatic monitor reaches ESCALATE, the composer emits the exact protocol 2.4 Feature Center correction, guarded native analysis resumes, protocol 2.1 independently verifies the new sample, repair thresholds pass, and state reaches RESUMED with proof-owned cleanup in the same warm After Effects process. All three eligible automatic-correction reasons—persistent low tracking confidence, persistent drift, and explicit identity-confidence loss—now also have independently retained Analyze Backward proofs using the same exact correction/readback/verification gates; occlusion remains escalation-only. Deterministic temporal segmentation sequence materialization is now also retained in the same warm AE process: native protocol 2.5 sequence import, exact 12 fps / frame-count timing, LUMA matte binding, frame-to-frame moving-mask pixel evidence, structural readback, and full proof-owned baseline restoration all pass without restarting After Effects. Materially different-footage segmentation transfer is now retained in the warm After Effects process against real Spider-Man footage: the same five-operation sequence-matte contract preserves the source item, passes exact structural readback, moves the visible matte across three timed checkpoints, matches revealed pixels to same-timestamp source baselines, and restores the proof-owned project baseline. Save/reopen/reconnect segmentation transfer is now retained in the same AE process with a distinct authenticated CEP session, exact post-reopen structural readback, fresh post-reconnect matte mutation/readback, visual checkpoint stability, and restoration of the saved user-project baseline. The guarded production segmentation runtime gate is now implemented fail-closed: it registers nothing unless exact checkpoint-backed live SAM 3.1 transfer evidence passes. Live checkpoint-backed SAM 3.1 provider proof—and therefore production segmentation activation—remains open M4 work. Development continues on the persistent warm After Effects process so routine proof cycles stay around 30 seconds or faster wherever the operation itself allows it.

Authoritative documents live in `docs/`, machine-readable contracts live in `spec/`, and accepted proof manifests live in `proofs/manifests/` and `proofs/diagnostics/`.
