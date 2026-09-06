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

Current product milestone version: **`0.4.0-dev`**.

## Current phase

**M3 — Human-Parity Core: in progress.**

M2 — Adobe Host Baseline is accepted and remains the proven real-AE foundation: authenticated CEP protocol 1.1 transport, bounded render/readback, rollback/recovery, stable identity through save/reopen/reconnect, and final baseline CRUD/readback all passed on the declared Windows / After Effects 2025 environment.

The first M3 tranche is the dependency chain required for literal object-driven constructions: typed mask CRUD, arbitrary open/closed Bezier geometry, exact vertices and in/out tangents, animated mask paths, variable-feather Shape data, mask feather/expansion/opacity/modes/inversion, and structural mask readback. These protocol 1.2 capabilities remain **DECLARED and unroutable** until authenticated broker negotiation for 1.2 is implemented and proven; M2 evidence is not inherited.

After the mask/Bezier tranche is transport-proven, M3 continues through track mattes, blend modes, parenting/null rigs, relevant layer switches, exact temporal/spatial interpolation and Graph Editor controls, markers, motion blur, frame blending, and shutter controls. The milestone closes only after the real object/mask-driven reveal construction is Object-Aware Verified and every required M3 capability reaches at least TRANSFER maturity.

Authoritative documents live in `docs/`, machine-readable contracts live in `spec/`, and accepted proof manifests live in `proofs/manifests/`.
