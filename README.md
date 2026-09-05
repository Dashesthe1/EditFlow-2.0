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

EditFlow 2.0 starts a new development line. The first repository release will be `0.1.0`; previous EditFlow version numbers have no compatibility or lineage meaning here.

## Current phase

**Phase 0 — Clean-room architecture, contracts, schemas, and proof gates.**

Implementation begins only after these contracts are committed and internally consistent.

Authoritative documents live in `docs/` and machine-readable contracts live in `spec/`.
