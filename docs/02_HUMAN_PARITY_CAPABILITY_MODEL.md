# Human-Parity Capability Model

## Purpose

EditFlow 2.0 needs an explicit machine-readable answer to: **Can this installed After Effects environment perform every material step required by this edit?**

The capability registry is not a marketing checklist. It is a runtime planning constraint and a release gate.

## Capability states

Every capability reports exactly one primary state:

- `FULL` — complete typed workflow is available and currently proof-verified for this environment class.
- `PARTIAL` — useful subset exists, but at least one material human workflow is missing.
- `ADAPTER_REQUIRED` — capability exists in AE/plugin, but requires a dedicated subsystem adapter not currently available/verified.
- `UI_FALLBACK` — only a guarded visual UI route is currently available and verified.
- `UNAVAILABLE` — installed environment cannot currently provide the capability through any approved route.

Separate fields record proof level, environment fingerprint, adapter version, and degradation policy.

## Proof maturity

Capability proof progresses through:

1. `DECLARED` — schema/taxonomy exists.
2. `STRUCTURAL` — operation executes and readback matches.
3. `VISUAL` — representative rendered result satisfies expected invariants.
4. `ROLLBACK` — failure/rollback or compensation behavior is proven.
5. `TRANSFER` — works on a second materially different context.
6. `ROBUST` — repeated varied-context proof with known failure envelope.

`FULL` requires at least `TRANSFER`; release-critical capability families may require `ROBUST`.

## Capability domains

The initial registry must cover all material AE workflow families below. Sub-capabilities are enumerated as stable IDs beneath these domains.

### Project and media

- project create/open/save/save-as/recovery/settings;
- project folders, labels, comments, dependencies, collect/reduce operations;
- footage import modes, image sequences, layered PSD/AI, audio, 3D;
- replace/reload/missing-footage repair;
- interpret footage: FPS, alpha, premultiplication, fields, pixel aspect, color profile;
- proxies/placeholders/pre-renders.

### Compositions and layers

- composition dimensions, PAR, FPS, duration, start, background, shutter, resolution, renderer;
- all relevant layer types;
- duplication, ordering, enable/disable, solo, shy, lock, quality;
- adjustment/guide/3D switches, motion blur, frame blending, effects switch;
- collapse transformations/continuous rasterization;
- preserve underlying transparency;
- layer styles;
- blend modes;
- track mattes and arbitrary matte-source selection.

### Transform, rigging, keyframes, Graph Editor

- 2D/3D transform properties;
- anchor point, separated dimensions;
- parent/unparent preserving transforms;
- null rigs and pick-whip-equivalent links;
- expression controls and expression debugging;
- keyframe CRUD;
- temporal interpolation: linear, hold, Bezier, auto/continuous Bezier;
- incoming/outgoing speed and influence;
- value graph;
- spatial Bezier paths and tangents;
- roving keys;
- Easy Ease variants;
- keyframe assistants;
- Motion Sketch, Wiggler, Smoother or equivalent procedural workflows.

### Timing

- layer in/out/start/stretch including reverse;
- time remapping;
- freeze frame / freeze last frame;
- frame mix / pixel motion frame blending;
- comp/layer motion blur and shutter controls.

### Masks, paths, mattes

- create/delete/duplicate/reorder masks;
- arbitrary open/closed Bezier vertices and tangents;
- mask modes;
- opacity/expansion;
- uniform and variable feather;
- animated mask paths;
- smart interpolation;
- mask references for effects;
- auto-trace;
- mask tracking and manual correction;
- alpha/luma/inverted mattes;
- channel/alpha compositing and EXR/Cryptomatte workflows.

### Tracking, stabilization, isolation

- point, two-point, four-point/perspective tracking;
- attach-point exports;
- rotation/scale tracking;
- face tracking;
- stabilization;
- Warp Stabilizer workflow;
- planar tracking and roto through Mocha AE;
- 3D Camera Tracker analysis/solve/point-plane selection/export;
- subject/object segmentation;
- Roto Brush, Refine Edge, propagation/freeze;
- manual roto correction;
- segmentation/roto export to AE masks/mattes.

### Paint, repair, deformation

- Paint Brush strokes and stroke properties;
- Clone Stamp sampling/time offsets/tracked repair;
- Eraser;
- frame-by-frame retouching;
- write-on animation;
- Content-Aware Fill;
- Puppet meshes, pins, bend/advanced pins, overlap, starch, recorded motion.

### Shapes and text

- shape-layer creation and contents hierarchy;
- Bezier and parametric paths;
- fills/strokes/gradients;
- Trim Paths, Repeater, Merge Paths, Offset Paths, Round Corners, Zig Zag, Twist, Pucker & Bloat and supported operators;
- text creation and full character/paragraph controls;
- Source Text animation;
- text animators and Range/Wiggly/Expression selectors;
- text on paths;
- per-character 3D;
- text extrusion/bevel where renderer supports it.

### Effects and plugins

- add/remove/reorder/copy effects;
- universal property schema discovery;
- effect parameter animation;
- compositing options/mask references;
- effect control points/regions;
- custom curve editors;
- `.ffx` animation presets;
- dynamic third-party effect discovery;
- dedicated adapters for complex plugin UIs;
- plugin license/error detection and safe interruption.

### Color and keying

- Keylight/chroma key sampling and matte evaluation;
- matte cleanup stack;
- Lumetri complete control surface including curves/wheels/HSL secondary;
- custom curve point creation/removal;
- project working space/display management/linearization;
- OCIO/ACES;
- HDR project/display/export configuration;
- LUT loading;
- scopes/waveform/histogram or equivalent measurable validation.

### 3D

- 3D switch and all transforms/orientation;
- cameras and point of interest;
- depth of field;
- lights and shadows;
- material options;
- extruded text/shapes;
- imported 3D models and materials;
- environment lighting/HDRI;
- supported renderer controls;
- local/world manipulation semantics;
- shadow-catcher workflows;
- Cineware/C4D integration where installed.

### Audio, markers, composition aids

- audio levels/pan/keyframes and audio effects;
- convert audio to keyframes;
- audio preview/sync evidence;
- comp/layer markers, comments, durations;
- guides/grids/rulers/snapping/safe margins;
- region of interest;
- work area.

### Reusable production and render

- Essential Properties;
- MOGRT authoring/export and replaceable media;
- JSON/CSV/data-driven animation;
- animation presets;
- Render Queue item management;
- Render Settings templates;
- Output Module format/codec/channels/alpha/color/audio;
- multiple outputs;
- bounded ranges/work-area renders;
- Media Encoder integration;
- headless/aerender where supported;
- Multi-Frame Rendering configuration.

### External/interactive surface

- approved scripts;
- CEP/UXP/extension adapters where applicable;
- custom panel controls;
- menu/context commands;
- direct viewer handle manipulation when required;
- multiple viewers/layer panels for workflows such as clone/tracking;
- undo/redo plus transaction rollback;
- copy/paste across comps/projects;
- cache/purge/preview-resolution controls.

## Capability record minimum fields

Each record must contain:

- `id` — stable namespaced ID;
- `domain`;
- `description`;
- `status`;
- `proof_maturity`;
- `routes[]` ordered by preference;
- `required_environment`;
- `input_schema_ref`;
- `output_schema_ref`;
- `readback_strategy`;
- `visual_proof_profile`;
- `rollback_strategy`;
- `risk_class`;
- `last_verified_environment_fingerprint`;
- `limitations[]`;
- `fallback_policy`.

## Planning rule

A recipe compiler resolves every `required_capability_id` before it emits an execution plan. If any requirement is unsatisfied, compilation fails with a complete missing-capability report. No operation is sent to AE.
