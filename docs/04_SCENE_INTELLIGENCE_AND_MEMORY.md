# Scene Intelligence and Executable Memory

## 1. Scene Graph

EditFlow must reason about footage through persistent semantic entities instead of guessed coordinates.

### Entity classes

Initial ontology includes:

- `SUBJECT`, `PERSON`, `FACE`, `HEAD`, `EYE`, `HAND`, `ARM`, `LEG`, `TORSO`, `SILHOUETTE`;
- `OBJECT`, `PROP`, `VEHICLE`, `SCREEN`, `SIGN`, `WINDOW`, `SURFACE`, `PLANE`, `EDGE`;
- `FOREGROUND_REGION`, `BACKGROUND_REGION`;
- `CAMERA` and shot-level motion entities;
- extensible user/task-specific semantic classes.

### Time-varying observations

Each entity may contain:

- frame/time range and visibility;
- bounding box/polygon/mask;
- centroid and feature points;
- 2D trajectory;
- estimated depth ordering;
- velocity/acceleration;
- orientation/pose where applicable;
- occlusion relationships;
- appearance/identity embeddings or other match evidence;
- track/segmentation references;
- confidence and evidence provenance.

### Stable semantic IDs

IDs persist through the useful shot interval, for example:

- `subject:spiderman:01`;
- `bodypart:right_hand:01`;
- `feature:left_eye:01`;
- `surface:building_wall:03`.

Recipes bind to semantic roles, not absolute coordinates. Example: `attach effect center to nearest visible eye` resolves to a scene entity and then to time-varying positions.

### No-invention rule

If confidence is insufficient for a required binding, the planner must request more analysis, use an explicitly permitted weaker binding, or fail preflight. It may not fabricate geometry.

## 2. Learning Memory

Learning Memory describes professional reference evidence:

- desired look/feel;
- pacing and rhythm;
- major visual-event timing;
- framing/composition behavior;
- intensity hierarchy;
- reference frames/clips;
- perceptual attributes to preserve.

It is WHAT/WHEN authority, not a low-level execution script.

## 3. Training Memory / Recipe Graph

Training Memory is executable HOW.

Each recipe contains:

- `recipe_id`, version, provenance;
- purpose;
- semantic prerequisites;
- required scene roles;
- required capability IDs;
- layer/object hierarchy template;
- tracking/segmentation/mask operations;
- effect/plugin dependencies;
- parameter models;
- keyframe/curve templates;
- timing phase model;
- spatial relationship model;
- object-binding rules;
- adaptation bounds;
- preview checkpoints;
- structural invariants;
- visual invariants;
- known failure modes;
- diagnosis-to-repair mappings;
- transfer constraints;
- validation/reference evidence.

### Example: Foreground occlusion wipe

Conceptual recipe:

1. identify a foreground object crossing meaningful screen area;
2. obtain segmentation/roto over the transition interval;
3. refine propagation and convert to alpha/mask;
4. construct outgoing/incoming hierarchy;
5. use object alpha as matte so the cut occurs behind the object;
6. align incoming motion to outgoing object trajectory when appropriate;
7. apply velocity-dependent smear/blur only near peak motion;
8. restore a clean incoming landing;
9. preview setup, peak occlusion, reveal, and landing;
10. reject or repair mask leakage, early reveal, drift, or lingering blur.

The recipe does not hard-code Spider-Man, an exact coordinate, or one source duration. It binds semantic roles to the current Scene Graph.

## 4. Experience Memory

Experience Memory stores outcomes of actual attempts:

- recipe/version;
- footage/scene characteristics, abstracted to reusable context;
- capability route/adapters used;
- parameter ranges;
- proof results;
- viewer-visible defects;
- successful repair decisions;
- unacceptable combinations;
- confidence and transfer notes.

Experience Memory never overrides current hard constraints. It biases planning and adaptation.

## 5. Recipe compiler behavior

Compiler sequence:

1. select/synthesize recipe from creative objective and Learning Memory;
2. resolve semantic roles against Scene Graph;
3. resolve required capabilities against AE Capability Graph;
4. consult Experience Memory for context-sensitive amplitude/failure guidance;
5. instantiate layer hierarchy and operation DAG;
6. instantiate parameter/curve/timing models;
7. generate structural and visual invariants;
8. emit immutable execution plan;
9. fail before write if any required binding/capability remains unresolved.

## 6. Object-centric planning rule

The planner starts from footage geometry and editing intent:

**Preferred:** "the subject's right hand crosses the lens, so use it as a tracked foreground matte to hide the scene change."

**Rejected as a planning default:** "we need a strong transition, so add Turbulent Displace to the whole frame."

Effects are components of constructions, not substitutes for constructions.

## 7. Editor refinement loop

For every material technique:

1. **Observe** — inspect source, scene roles, motion, constraints.
2. **Construct** — execute the smallest coherent construction.
3. **Preview** — capture bounded frames/clip around critical moments.
4. **Compare** — evaluate against recipe/reference evidence.
5. **Diagnose** — identify concrete defects.
6. **Modify** — change only relevant parameters/structure.
7. **Re-preview** — verify repair.
8. **Commit** — accept the technique and store outcome evidence.

This loop runs at technique level, not only after an entire edit is finished.
