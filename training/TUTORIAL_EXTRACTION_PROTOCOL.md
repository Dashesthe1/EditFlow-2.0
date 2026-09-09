# Tutorial Extraction Protocol

Use this protocol when converting an editing tutorial or reference video into Editor Learning Brain data.

## Objective

Do not create a transcript summary. Extract reusable editorial competence.

For each meaningful technique, capture four distinct layers:

1. **WHAT happened** — visible construction and timing.
2. **HOW it was built** — tools, operations, parameter changes, ordering, curves, masks, tracking, layer structure, and timing phases.
3. **WHY it works** — viewer-facing editorial or motion-design principle.
4. **WHEN it transfers** — conditions where the technique should or should not be used, plus adaptation rules for different footage.

## Observation pass

Inspect the complete demonstration, including audio. Record:

- source and result states;
- meaningful timeline ranges and sync points;
- shot/subject/camera motion;
- layer hierarchy when visible;
- effects and controls when visible;
- masks, mattes, paths, tracking, keyframes, graph shapes, time remapping, blending, color, typography, and audio relationships;
- editor commentary explaining intent;
- before/after comparisons;
- signs of what the editor corrects or rejects.

Ignore incidental UI navigation unless it is required to reproduce the technique.

## Skill distillation rules

A skill must represent a reusable technique rather than a tutorial title.

Good skill: `impact_speed_ramp`

Bad skill: `tutorial_17_effect`

Every skill should answer:

- What editorial problem does this solve?
- What evidence says this is the right context?
- What are the prerequisites?
- What is the minimum construction needed to reproduce it?
- Which values are fixed versus footage-dependent?
- What visible invariants define success?
- What common mistakes make the result cheap, unreadable, mistimed, or technically wrong?
- How should it adapt to different motion, framing, duration, subjects, music, and aspect ratios?

## Parameter handling

Do not overfit to absolute tutorial values. Store exact values when they are part of the demonstrated construction, but explain whether they are:

- fixed;
- proportional to frame size;
- proportional to clip duration;
- aligned to a motion event;
- aligned to an audio event;
- subject-position dependent;
- intended only as a starting range.

## Principles versus procedure

Keep `whyItWorks`, `whenToUse`, `whenNotToUse`, `visualTargets`, `failureModes`, and `adaptationRules` separate from `procedure`.

This is critical. The system must learn judgment, not merely button sequences.

## Demonstration actions

Each meaningful action should include:

- action intent;
- target;
- known parameters;
- expected visible change;
- timestamp when useful.

If a value is not visible or cannot be established confidently, do not invent it. Preserve uncertainty in the natural-language guidance and lower skill confidence as appropriate.

## Initial mastery

Tutorial-derived skills begin at `OBSERVED` even when the tutorial is understood perfectly.

Only real execution evidence may advance mastery:

- `RECONSTRUCTED` — successfully rebuilt once;
- `VISUAL_MATCH_VERIFIED` — reconstruction satisfies strong visual evidence;
- `TRANSFER_VERIFIED` — works on materially different footage;
- `OBJECT_AWARE_VERIFIED` — adapts successfully to different subject geometry/motion;
- `ROBUST` — repeated high-quality results across varied contexts.

## Practice after extraction

For each important skill:

1. reconstruct the demonstrated example;
2. preview and evaluate it;
3. correct technique-level defects;
4. transfer it to at least two materially different contexts;
5. record successes and failures as Experience Memory;
6. promote mastery only from evidence.

## Evaluation

The default critic scores:

- intent match;
- timing;
- pacing;
- continuity;
- readability;
- motion quality;
- color consistency;
- sound sync;
- effect restraint;
- technical integrity.

Intent match, timing, readability, and technical integrity are critical gates. A complicated edit that fails one of those gates should not pass because its average score is high.

## Output

Write one JSON extraction per tutorial to `training/tutorial-extractions/`, following `_template.json`. The corpus compiler ignores files beginning with `_`.

Run:

```bash
npm run build:editor-knowledge
```

The generated knowledge snapshot is written to `training/generated/editor-knowledge.json` by default.
