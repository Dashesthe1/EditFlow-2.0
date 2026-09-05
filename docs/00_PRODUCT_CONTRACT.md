# Product Contract

## 1. Product identity

EditFlow 2.0 is a greenfield AI control plane for professional Adobe After Effects editing. After Effects remains the authoritative execution host. EditFlow provides perception, planning, typed control, verification, memory, and safe recovery.

## 2. Clean-room boundary

The old EditFlow codebase is not a dependency, migration target, or compatibility contract. This repository may use prior work only as evidence of requirements and failure modes. No implementation is copied merely because it existed before.

## 3. Primary outcome

ChatGPT must be able to construct edits with the same material manipulation vocabulary available to a skilled human editor in the installed AE environment.

Human parity does not require mimicking mouse movement when a deeper programmatic route exists. It requires equivalent creative control and verifiable results.

## 4. Required behavioral contract

For every production request, EditFlow must:

1. inspect project, footage, installed capabilities, plugins, and current project fingerprint;
2. understand relevant scene objects and motion;
3. select or synthesize an editing construction based on creative intent and available evidence;
4. preflight every required capability before writing;
5. produce an explicit, deterministic execution plan;
6. validate the entire plan against schemas, IDs, ranges, dependencies, project revision, and capability availability;
7. execute only through approved adapters/primitives;
8. read the AE project back after writes;
9. preview material visual constructions at bounded intervals;
10. diagnose viewer-visible defects and perform evidence-driven refinement;
11. commit experience only after outcome classification;
12. render through the real production host and verify completion.

## 5. No-silent-degradation rule

If a recipe requires a capability that is unavailable, EditFlow must report the exact missing capability and stop or request an explicit fallback policy. It may not silently replace object-aware editing with a weaker full-frame approximation.

## 6. Human-parity scope

The target includes material editing actions across:

- project lifecycle and organization;
- footage interpretation, replacement, proxies, and dependencies;
- compositions and renderers;
- every relevant layer type and layer switch;
- transforms, anchor points, parenting, constraints, and ordering;
- keyframes, temporal/spatial interpolation, Graph Editor behavior, assistants, and expressions;
- masks, arbitrary Bezier paths, variable feather, mask modes, animation, and tracking;
- track mattes, channels, blend modes, and compositing relationships;
- tracking, stabilization, face tracking, planar tracking, 3D tracking, and manual repair;
- Roto Brush, Refine Edge, object/subject segmentation, and animated matte generation;
- Paint, Clone Stamp, Eraser, Content-Aware Fill, and frame repair;
- Puppet and deformation workflows;
- shape layers and the complete shape operator hierarchy;
- text, text animators/selectors, path text, and per-character 3D;
- effects, effect ordering, compositing options, custom controls, presets, and dynamic plugin schemas;
- color correction, color management, OCIO/ACES, HDR, LUTs, and measurement;
- 3D layers, cameras, lights, models, materials, environment lights, and supported renderers;
- audio, markers, guides, work areas, and timing primitives;
- Essential Properties, MOGRTs, data-driven animation, and animation presets;
- Render Queue, Output Modules, Media Encoder/headless routes where supported;
- scripts, extensions, custom panels, menu commands, and UI-only functions through controlled adapters/fallbacks.

## 7. Parity route hierarchy

For each material AE action, prefer the deepest reliable route:

1. native typed object-model primitive;
2. typed Adobe scripting/host adapter;
3. dedicated subsystem adapter;
4. dynamic plugin adapter;
5. guarded visual UI fallback.

The UI fallback is a last resort, never the primary architecture.

## 8. Memory contract

EditFlow maintains three distinct memory authorities:

- **Learning Memory**: WHAT the final edit should feel/look like and WHEN important events occur.
- **Training Memory**: HOW to construct the technique as an executable recipe graph.
- **Experience Memory**: WHAT happened when a construction was attempted before, including failures, successful ranges, defects, and context.

These may influence planning, but capability preflight and current scene evidence always remain authoritative for execution feasibility.

## 9. Production-ready definition

A feature, adapter, recipe, or release is production-ready only after it passes the proof system defined in `docs/05_PROOF_AND_ACCEPTANCE.md`.
