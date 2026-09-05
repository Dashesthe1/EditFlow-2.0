# Development Roadmap

This roadmap is for the clean-room EditFlow 2.0 line. Milestone numbering is new and does not continue prior EditFlow releases.

## Milestone 0 — Greenfield Foundation (`0.1.0-dev`)

Deliverables:

- product/human-parity contract;
- architecture and module boundaries;
- capability registry schema and taxonomy;
- Scene Graph schema;
- Recipe Graph schema;
- Execution Plan schema;
- transaction/risk/recovery model;
- proof ladder and host-acceptance rules;
- ADR process and repository contribution rules;
- CI for schemas/contracts once implementation skeleton exists.

Exit gate: contracts are internally consistent and the initial machine-readable schemas validate representative examples.

## Milestone 1 — Core Runtime & Capability Registry (`0.2.0-dev`)

Build from scratch:

- core IDs/types/errors;
- environment fingerprinting;
- project/revision fingerprint model;
- capability registry engine;
- runtime capability discovery interface;
- adapter registration and route priority;
- immutable Execution Plan model;
- transaction ledger/state machine;
- simulated executor/readback test harness;
- compact MCP-facing control-plane skeleton.

Exit gate: an execution plan can be validated against capabilities and simulated state with deterministic failure/recovery behavior.

## Milestone 2 — Adobe Host Baseline (`0.3.0-dev`)

Create the first new AE host adapter; do not port the old bridge.

Baseline operations:

- project inspect/save lifecycle needed by tests;
- composition CRUD/settings;
- media import/add;
- layer CRUD/duplicate/order;
- 2D transform properties including anchor point;
- timing/in-out/start/stretch;
- effect add/remove/property access;
- keyframe CRUD;
- expressions;
- precompose;
- render/capture/readback primitives.

Exit gate: real-AE P1–P5 proof for baseline host operations and restart-safe transaction ledger.

## Milestone 3 — Human-Parity Core (`0.4.0-dev`)

Highest priority because it unlocks professional object-driven constructions:

1. masks: create/delete/duplicate/reorder;
2. arbitrary animated Bezier paths and tangents;
3. mask feather/variable feather/expansion/opacity/modes;
4. alpha/luma/inverted track mattes and arbitrary matte sources;
5. full blend modes;
6. parenting/unparenting preserving transforms;
7. null rigs and relationship primitives;
8. complete layer switches/order controls;
9. exact temporal interpolation;
10. Graph Editor speed/value controls, influence/velocity;
11. spatial Bezier paths/tangents, hold/roving/ease variants;
12. markers, motion blur, frame-blending and shutter controls.

Exit gate: construct and transfer an object/mask-driven transition whose geometry, mattes and curves are not approximated.

## Milestone 4 — Tracking & Isolation (`0.5.0-dev`)

- point tracking;
- two-point rotation/scale tracking;
- four-point/perspective tracking;
- mask tracking;
- face tracking;
- stabilization;
- semantic attach points;
- subject/object segmentation interface;
- segmentation -> mask/matte export;
- manual repair/resume model.

Exit gate: track/isolate a moving real-world object, attach a visible construction, repair drift, and transfer to unrelated footage.

## Milestone 5 — Interactive AE Adapters (`0.6.0-dev`)

Dedicated workflow adapters for:

- Roto Brush / Refine Edge / object matte;
- Mocha AE planar tracking/roto;
- 3D Camera Tracker;
- Warp Stabilizer;
- Paint / Clone Stamp / Eraser;
- Puppet;
- Content-Aware Fill.

Each adapter must expose semantic operations, progress/evidence, repair hooks, export outputs, and guarded failure behavior.

Exit gate: each adapter reaches the proof maturity required by its risk class; no capability is mislabeled as ordinary effect-property access.

## Milestone 6 — Full Creative Construction (`0.7.0-dev`)

- shape layers and full contents/operator hierarchy;
- text animators/selectors/path text/per-character 3D;
- complete effect ordering/copy/compositing options/control points;
- animation presets;
- project/footage organization, interpretation, replacement, proxies;
- color management, OCIO/ACES/HDR/LUT workflows and measurable validation;
- cameras/lights/3D layers/materials/models/environment lights;
- Essential Properties/MOGRTs/data-driven animation;
- complete Render Queue/Output Module/Media Encoder routes where available;
- audio/markers/guides/work areas and production aids.

Exit gate: capability audit covers the full standard AE creative surface with each item correctly classified.

## Milestone 7 — Dynamic Plugin & UI Fallback Architecture (`0.8.0-dev`)

- automatic ordinary-effect discovery and deep property schemas;
- plugin capability fingerprints;
- adapter SDK for complex third-party interfaces;
- representative adapters for installed complex plugins as available;
- guarded visual UI fallback runtime;
- dialog/license/error detection;
- verified fallback readback/evidence rules.

Exit gate: a newly installed ordinary effect is usable without hard-coded ChatGPT changes, and at least one custom-UI capability is safely controlled through an adapter/fallback.

## Milestone 8 — Scene Intelligence (`0.9.0-dev`)

- persistent entity ontology and IDs;
- body parts/faces/features/objects/surfaces/edges;
- trajectory/velocity/occlusion/depth relationships;
- camera-motion classification;
- segmentation/track evidence binding;
- confidence/provenance model;
- semantic query API for planner.

Exit gate: planner binds the same recipe to different scene geometry without fixed coordinates.

## Milestone 9 — Executable Training Memory & Recipe Compiler (`0.10.0-dev`)

- Learning/Training/Experience Memory stores;
- recipe validation/versioning;
- semantic prerequisites and role binding;
- capability dependency resolution;
- layer hierarchy/effect/curve/timing templates;
- adaptation bounds;
- diagnosis/repair graph;
- reference checkpoints;
- no-silent-degradation compile gate.

Exit gate: reconstruct a learned technique from recipe graph on unrelated footage with object-aware adaptation and transfer proof.

## Milestone 10 — Professional Editor Orchestration (`0.11.0-dev`)

- observe -> construct -> preview -> compare -> diagnose -> refine loop;
- bounded evidence/review budgets;
- technique-level checkpoints;
- production state machine and restart recovery;
- final render orchestration;
- Experience Memory outcome writes;
- capability-aware fallback policy requiring explicit authorization.

Exit gate: complete a multi-technique edit from raw footage with technique-level refinement and no manual intervention except capabilities explicitly classified as requiring it.

## Milestone 11 — Human-Parity Release Candidate (`1.0.0-rc`)

- full installed-environment capability audit;
- all material capabilities mapped to direct typed route, subsystem adapter, guarded UI fallback, or explicitly unavailable environment dependency;
- production recipe gate rejects every unsupported construction before writes;
- cross-project reliability and recovery tests;
- plugin/environment compatibility matrix;
- performance and bounded-review validation;
- documentation and operator diagnostics.

## `1.0.0` release contract

`1.0.0` means the architecture, capability audit, execution routes, and proof system support the stated human-parity contract for the declared target AE environment. It does not mean every conceivable third-party plugin on every machine is automatically FULL; it means EditFlow can truthfully discover, classify, adapt, or reject each material capability without silent approximation.

## Development sequencing rule

Do not jump ahead to tutorial-specific effects while a lower milestone capability needed for literal construction is missing. Build the manipulation vocabulary first, then the intelligence that composes it.
