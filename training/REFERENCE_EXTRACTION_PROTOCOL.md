# Professional Reference Extraction Protocol

Tutorials teach executable HOW. Finished professional references primarily teach WHAT GOOD LOOKS LIKE, WHEN to make a decision, and WHY the decision works.

Do not reverse-engineer a reference into a list of effects. Analyze it as an editorial system.

## Required passes

### 1. Structure

Segment the edit into functional phases such as setup, anticipation, build, escalation, climax, release, or reset. Record energy and major changes in pacing, framing, sound, and effect density.

### 2. Shot selection

Record why a shot appears useful at its exact position:

- subject/action value;
- expression or story information;
- motion direction;
- continuity relationship;
- contrast with neighboring shots;
- setup/payoff relationship.

### 3. Pacing and rhythm

Record:

- shot-duration pattern;
- acceleration/deceleration of cutting;
- held moments;
- whether cuts follow every beat or only selected phrase/accent points;
- timing of anticipation and release.

### 4. Sound relationship

Record meaningful synchronization between picture and:

- dialogue;
- beat/transient;
- phrase boundary;
- impact sound;
- silence;
- music build/drop;
- sound-design event.

Do not infer audio events that cannot actually be heard or measured.

### 5. Visual hierarchy and composition

Record what the viewer is expected to notice first, how the subject stays readable, how framing changes, and how motion directs attention.

### 6. Effect density and restraint

Record both effects that are present and moments where the editor deliberately stays simple. A professional reference is evidence for when NOT to add treatment as much as when to add it.

### 7. Reusable principles

Distill observations into principles that can transfer to unrelated footage. A principle should answer:

- when to apply it;
- when not to apply it;
- why it works;
- visible/audible positive signals;
- failure signals;
- source provenance and confidence.

Good principle: `preserve_subject_readability_under_effect_density`.

Bad principle: `use effect X at 4.2 seconds`.

## Evidence discipline

Separate observations from inference. If an exact construction or effect is not visible, do not invent it. Professional-reference extraction is about editorial judgment and finished-result evidence; implementation details belong in tutorial skills unless directly verified.

## Output

Write one JSON analysis per professional reference to `training/reference-extractions/` using `_template.json`.

Compile the taste corpus with:

```bash
npm run build:editor-taste
```

Generated snapshots are intentionally ignored by Git; source analyses and provenance remain reviewable.
