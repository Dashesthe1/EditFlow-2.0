# Architecture

## Architectural principles

1. **After Effects is the execution host.** EditFlow does not reimplement AE as a parallel editor.
2. **Semantic intent is separated from host primitives.** ChatGPT should usually reason in scene objects and editing constructions, not raw property paths.
3. **Every mutation is typed, validated, revision-aware, and verifiable.**
4. **Capability discovery is dynamic.** The installed AE environment and plugins define what is actually available.
5. **Interactive subsystems are modeled as workflows, not mistaken for ordinary effect parameters.**
6. **Visual verification is part of execution, not an optional final review.**
7. **No silent degradation.** Missing capabilities are surfaced before production.
8. **The architecture must scale to human parity without exposing thousands of low-level ChatGPT tools.**

## System layers

### A. Scene Understanding Graph

Produces persistent semantic entities across time:

- subjects, faces, eyes, hands, limbs, silhouettes;
- objects, surfaces, planes, foreground edges, background regions;
- screen-space and world/depth estimates;
- trajectories, velocity, acceleration, orientation, visibility;
- occlusion relationships and object intersections;
- camera motion and shot-level motion classification;
- masks/segmentations/tracks when available;
- confidence and provenance for every observation.

Entities use stable IDs and time-varying observations. The graph must support partial knowledge and confidence rather than inventing certainty.

### B. Edit Memory / Recipe Graph

Stores editing knowledge as executable constructions rather than prose summaries. A recipe contains:

- purpose and intended perceptual result;
- semantic prerequisites;
- required capability IDs;
- target bindings such as `foreground_hand`, `eye`, `wall_plane`;
- layer/precomp hierarchy;
- tracking/segmentation/mask requirements;
- effect stack and ordering;
- parameter models and allowed adaptation ranges;
- keyframe/curve templates;
- timing phases;
- spatial relationships;
- preview checkpoints;
- failure conditions;
- repair strategies;
- transfer constraints and validation rules.

### C. AE Capability Graph

Represents the installed environment as machine-readable capabilities with status and route information.

Each capability records:

- stable capability ID;
- domain and operation family;
- status: `FULL`, `PARTIAL`, `ADAPTER_REQUIRED`, `UI_FALLBACK`, `UNAVAILABLE`;
- available execution routes;
- version/plugin prerequisites;
- typed input/output schemas;
- preconditions and destructive-risk class;
- readback method;
- visual-proof requirements;
- rollback/recovery support;
- proof level and last verified environment fingerprint.

The registry is generated from static known capabilities plus runtime discovery of AE, installed effects, plugins, scripts/extensions, renderers, and adapter availability.

### D. Edit Compiler / Planner

Inputs:

- creative objective;
- Learning Memory evidence;
- selected Training recipe(s);
- Scene Graph;
- Experience Memory;
- AE Capability Graph;
- current AE project state and fingerprint;
- production constraints.

Outputs an immutable `ExecutionPlan` containing:

- semantic decisions and rationale references;
- object bindings;
- operation DAG;
- exact typed host operations;
- dependency order;
- state preconditions;
- preview checkpoints;
- expected structural and visual invariants;
- rollback boundaries;
- capability proof requirements.

The compiler rejects any plan whose required capabilities are not satisfiable under the configured fallback policy.

### E. Transactional Adobe Executor

Responsibilities:

1. capture project revision/fingerprint;
2. validate plan and dependencies;
3. acquire appropriate write lease/transaction;
4. execute atomic operation groups;
5. read back affected state after each group;
6. render/capture bounded preview evidence at checkpoints;
7. compare actual state with expected invariants;
8. roll back, compensate, or halt on structural conflict;
9. preserve stable IDs across transactions where possible;
10. emit a complete execution/proof ledger.

## Supporting subsystems

### Capability Discovery

Inventories:

- AE version/build and host features;
- scripting/object-model affordances;
- installed native effects;
- installed third-party effects/plugins;
- available extensions/panels;
- renderers and output routes;
- adapter versions;
- UI-fallback accessibility.

### Universal AE Object Model

A typed intermediate representation for project objects:

- project items, folders, footage, comps;
- layers and all switches;
- properties and property groups;
- effects and effect instances;
- masks and paths;
- keyframes and interpolation metadata;
- shape contents;
- text contents/animators/selectors;
- parent/matte relationships;
- cameras, lights, 3D properties/materials;
- markers and work areas;
- render queue/output settings.

This object model decouples ChatGPT-facing semantics from specific Adobe execution routes.

### Interactive Subsystem Adapters

First-class workflow adapters for systems whose useful behavior cannot be represented as ordinary property writes:

- Point/Mask/Face Tracker;
- Mocha AE;
- Roto Brush / Refine Edge / object matte;
- 3D Camera Tracker;
- Warp Stabilizer;
- Paint / Clone Stamp / Eraser;
- Puppet;
- Content-Aware Fill;
- plugin-specific custom UIs.

Each adapter exposes semantic operations, progress/evidence, repair hooks, and export-to-object-model outputs.

### Guarded UI Fallback

Only for material functions not reachable through deeper APIs. It must:

- verify the exact AE window/panel/context before input;
- use bounded, declarative UI actions;
- capture before/after visual evidence;
- read project state after the action when possible;
- stop on unexpected dialogs/state;
- never become an unrestricted mouse/keyboard shell.

### Visual Verification Engine

Evaluates preview frames/clips for task-specific defects: matte leakage, drift, occlusion timing, readability, framing, curve timing, landing cleanliness, color consistency, artifacting, etc. Visual checks are linked to recipe-specific expected invariants.

### Production Orchestrator

Runs the editor loop:

`observe -> decide -> preflight -> construct -> preview -> compare -> diagnose -> refine -> verify -> render -> record experience`

The orchestrator manages bounded review budgets and avoids redundant analysis once evidence remains valid.

## API surface philosophy

ChatGPT should not receive a separate top-level tool for every mask vertex or shape operator. The public control surface is semantic and compact; internally, recipes compile to granular host operations.

Examples:

- `create_tracked_subject_matte(subject_id, range)` may compile to segmentation, mask creation, path keyframes, feather/expansion, readback, and preview proof.
- `build_foreground_occlusion_transition(outgoing, incoming, occluder_id, range)` may compile to object isolation, layer hierarchy, matte relationships, motion alignment, selective blur/smear, curve construction, and landing cleanup.

## Repository module boundaries

The planned implementation is a monorepo with these logical packages (language/runtime decisions are documented in ADRs before code is added):

- `core-contracts` — IDs, schemas, common types, errors.
- `capability-registry` — static taxonomy + runtime discovery merge.
- `scene-graph` — semantic scene model and evidence interfaces.
- `recipe-graph` — Training Memory representation and validation.
- `planner` — semantic binding and execution-plan compiler.
- `executor` — transactions, operation scheduling, readback, rollback.
- `ae-object-model` — universal typed AE representation.
- `adapters/*` — Adobe subsystems and plugin integrations.
- `visual-proof` — previews, comparisons, task-specific validators.
- `memory` — Learning/Training/Experience stores and provenance.
- `orchestrator` — production state machine.
- `mcp-surface` — compact ChatGPT-facing control plane.
- `proofs` — reproducible host acceptance tests.

No package may bypass validation and mutate AE directly except through an approved adapter registered with the executor.
