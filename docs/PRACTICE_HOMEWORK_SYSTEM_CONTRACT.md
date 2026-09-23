# EditFlow 2.0 Practice / Homework System Contract

Status: **V1 runtime and local CEP Practice panel implemented**

## Purpose

EditFlow needs supervised editing practice, not only production tests.
A Practice session treats a finished professional edit as the answer key and raw
source media as the exercise material. The system repeatedly reconstructs the
reference, measures concrete differences, corrects decisions, and retains the
experience for later Pro Creation.

The goal is to improve editorial decision making as well as AE execution skill.

## Operating modes

EditFlow exposes two explicit modes:

1. PRACTICE - supervised reconstruction with a known finished reference.
2. PRO_CREATION - autonomous production using retained learning and experience.

V1 exposes a durable GPT assignment control plane through the local After Effects
CEP panel. Practice and Pro Creation both create a structured assignment for GPT rather
than entering a local rule-driven editing loop. Pro Creation remains blocked until its
selected Edit Type contains at least one mastered GPT Practice success path.
## Practice user surface

The stable V1 UI contract is:

- **Finish** - one professional finished edit (FINISH_REFERENCE).
- **Start** - one or more raw source videos (START_SOURCE), including full movies.
- **Proceed to do homework** - begins the supervised reconstruction session.

The JSON contract is spec/practice-session-v1.schema.json.

### Running the local panel

1. Install or refresh the extension with `scripts/windows/install-editflow-cep.ps1`.
2. Start the persistent product service with `scripts/windows/run-practice-panel.ps1`
   or `npm run practice:panel`.
3. In After Effects, open **Window > Extensions > EditFlow 2.0 Bridge**.
4. Create or select an Edit Type, choose the Finish and Start media, and proceed.

The service binds only to authenticated loopback ports. Practice remains disabled
until both the product service and the AE CEP bridge are connected. Pressing the primary
action creates a persistent GPT assignment containing the media, selected Edit Type,
retained knowledge, artifact location, and governing editing instructions. The Shadow
connector exposes assignment claim, trace recording, completion, failure, status, and
cancellation tools so GPT can orchestrate EditFlow's Eyes, Brain, AE hands, and Desktop
Commander from one control loop.

Practice learning is allocated to the selected Edit Type automatically as GPT records
events. A Practice session becomes a mastered source for Pro Creation only when GPT
completes it successfully; queued, failed, human-review, and cancelled runs cannot certify
the Edit Type.

## Non-negotiable practice sequence

A Practice session runs:

INGEST -> REFERENCE DECOMPOSITION -> SOURCE INDEX -> EXACT SCENE MATCH ->
CONTENT-LOCK BASELINE -> RECONSTRUCT -> RENDER -> COMPARE -> DIAGNOSE ->
REVISE -> RETAIN BEST -> RECORD EXPERIENCE -> HUMAN REVIEW

Effects cannot compensate for wrong editorial source selection.

## Phase 1: Reference decomposition

The Finish edit is segmented into ordered reference shots and effect/transition
windows. Each shot receives a stable ID, timing range, evidence references, and a
style fingerprint for later memory retrieval.
## Phase 2: Start-source indexing and exact scene matching

The raw Start sources are indexed before AE construction.

For every reference shot the matcher must resolve:

- source media ID;
- source in/out range;
- forward or reverse direction;
- playback-rate/time mapping;
- appearance similarity;
- temporal similarity;
- motion similarity;
- retained evidence and confidence.

A Practice reconstruction is blocked unless every reference shot has exactly one
retained source match above the configured exact-scene confidence gate.

Full-movie ingestion is an intended primary use case.

## Phase 3: Content-lock baseline

Before reconstructing effects, EditFlow builds an ordered timeline from the matched
raw cuts. This creates a source-correct baseline against which effect, transition,
timing, framing, and finish decisions can be learned independently.
## Phase 4: Supervised reconstruction loop

Each attempt receives the reference analysis, content-locked baseline, exact scene
matches, and all prior attempts.

The reconstruction adapter may use the existing EditFlow pipeline:

- Scene Understanding;
- Editor Brain;
- Editing IR;
- Recipe Compiler;
- M6 Professional Effects Intelligence;
- unknown-effect synthesis;
- tracking, roto, masks, optical flow, and adapters;
- transactional AE execution;
- render review and visual correction.

The attempt must emit a rendered artifact plus decision traces describing which cues,
constructions, and rationales produced the result.

Failed attempts are training evidence, not disposable failures.

### Capability discovery and tutorial-first research loop

Practice is not restricted to techniques already stored in EditFlow. When GPT cannot
faithfully explain or reproduce a defining reference behavior, it must open either a
`RECIPE_SKILL` gap (the AE primitives exist but the construction is not yet learned) or
an `EXECUTION_CAPABILITY` gap (EditFlow cannot yet perform a required AE operation).

For a missing or poorly understood technique, Practice records:

`CAPABILITY_GAP -> RESEARCH -> CAPABILITY_IMPLEMENTATION -> CAPABILITY_PROOF -> SKILL_COMMIT`.

The Tutorial Drive is the mandatory first research source. Before consulting Adobe
documentation or the public internet, GPT must search the available tutorial library for
the closest matching visible behavior, editing technique, transition, retiming pattern,
effect family, or beat/music workflow. The primary tutorial folders are
`Adobe Effect Tutorials` and `Adobe Effect Music + Beat Tutorials`.

A Tutorial Drive lookup is not satisfied by a folder-level glance. GPT should use the
observed reference behavior to search semantically related tutorial titles and techniques,
including useful synonyms, then inspect the best matching tutorial or tutorials to learn
both WHAT the professional construction is doing and HOW it is built in After Effects.
The retained lesson must extract transferable construction logic and adaptation rules,
not merely copy literal parameter values.

If no sufficiently relevant Tutorial Drive match exists, the RESEARCH trace must retain
the tutorial query or matching attempt and the no-match result before escalation.
Official Adobe documentation/resources and the installed Adobe feature/plugin surface
are second priority. External professional tutorials and plugin/vendor documentation are
third priority. Broader web/internet research is last.

Every newly discovered skill must therefore retain Tutorial Drive provenance as the first
RESEARCH source. Additional Adobe or external sources can supplement it when necessary.
Research establishes a hypothesis only; it cannot certify a capability without AE
readback/render evidence.

A committed learned skill must resolve its gap, be at least `AE_PROVEN`, retain the
research sources and proof evidence, and store transferable construction/adaptation
rules under the selected Edit Type. Pro Creation can then retrieve that skill without
blindly replaying literal values.

A short replay of frames that have just played forward is specifically classified as
`TEMPORAL_REWIND` / `REVERSE_PLAYBACK`. Practice must not misread this as an effect
parameter returning to baseline or as a failed construction. The proof must establish
actual source-time reversal: which source frames are replayed, the rewind duration and
rate, and whether the reference then resumes forward playback or cuts to the next shot.
Native AE Time Remap plus keyframe control is the default construction candidate; other
retiming methods may be researched and proven when the reference requires them.

## Phase 5: Similarity and anti-shortcut gates

Practice similarity is multi-dimensional:

- scene identity;
- temporal alignment;
- cut timing;
- framing;
- motion;
- effect fidelity;
- transition fidelity;
- color/finish;
- aligned pixel structure.

The weighted score is not sufficient by itself.

A passing attempt also requires:

- zero wrong scenes;
- zero unmatched scenes;
- scene identity at or above the exact-source gate;
- reference-aligned source timing and cuts;
- 100% defining effect/transition behavior coverage;
- effect and transition fidelity above the Practice target.

This preserves the M6 rule that optional decoration cannot hide missing defining
behavior.
## Target policy

Default Practice target: **0.95** weighted similarity.

Default stretch target: **0.99** weighted similarity.

The target describes aligned perceptual/editorial similarity, not byte identity.
Different encodes, resampling, source transforms, and AE rendering can prevent literal
pixel identity even when the reconstruction is editorially and visually faithful.

The engine retains the strongest attempt lexicographically: first minimize hard-gate
violations, then maximize weighted similarity.

If the configured attempt budget is exhausted below target, the strongest attempt is
returned as HUMAN_REVIEW_REQUIRED rather than falsely certified.

## Practice Learning Memory

Every session records a PracticeEpisodeV1 containing:

- style fingerprint;
- exact source matches;
- content baseline;
- all reconstruction attempts;
- decision traces;
- comparison evidence;
- the retained best attempt;
- mastery status.
Successful examples are queryable by style fingerprint and are intended to become
retrieval evidence for Pro Creation. Failed choices remain useful negative evidence.

This is the bridge between M6 capability development and improved editorial judgment.

## Implemented modules

The orchestration foundation is implemented together with the first concrete media and AE adapters:

- packages/practice-homework/src/contracts.ts
- packages/practice-homework/src/similarity.ts
- packages/practice-homework/src/memory.ts
- packages/practice-homework/src/persistent-memory.ts
- packages/practice-homework/src/engine.ts
- packages/practice-homework/src/ui-contract.ts
- packages/practice-homework/src/local-media.ts
- packages/practice-homework/src/ae-baseline.ts
- scripts/practice/practice-media-match.py
- spec/practice-session-v1.schema.json
- tests/practice-homework.test.mjs
- tests/practice-homework-media-baseline.test.mjs

The package is re-exported through @editflow/editor-brain and the MCP server module.

### Concrete media layer

The Practice media matcher now performs real full-video indexing and reference-to-source retrieval. It uses cached effect-resistant frame fingerprints for coarse search, SIFT/RANSAC feature evidence for refinement, forward/reverse and playback-rate hypotheses, and a local temporal fit for source in/out recovery. Artifacts are provenance-keyed to the analyzer implementation and become stale when that implementation changes. Source indexes are cacheable so a full movie does not need to be rescanned for every homework session.

A retained synthetic proof uses a treated/re-encoded three-shot reference built from a longer source. The current matcher recovers all three source scenes, including the reversed middle shot, above the default 0.95 retained-confidence gate. This proves the mechanism; it is not yet a substitute for long real-movie benchmarks.

### Concrete AE baseline layer

The baseline compiler lowers matched source ranges through EditFlow's existing typed AE commands: media.import, comp.create, layer.add_media, and layer.set_timing. It carries the reference edit's resolution, frame rate, and duration into the baseline composition and maps forward/reverse source ranges to deterministic startTime, inPoint, outPoint, and stretch values. Negative stretch is used for reverse playback through the already-supported AE timing primitive.

### Persistent homework memory

Practice episodes can now be stored in a disk-backed JSON memory with atomic replacement, session deduplication, and reload into PracticeLearningMemoryV1. Full attempt histories, including failures, therefore survive process or chat restarts and can later become retrieval evidence for Pro Creation.

## GPT orchestration and cancellation

The durable orchestration store retains assignments and learning events independently of
the chat process. GPT records the meaningful trajectory as:

OBSERVATION -> INTERPRETATION -> HYPOTHESIS -> PLAN -> AE_ACTION -> RENDER ->
COMPARISON -> DIAGNOSIS -> CORRECTION -> RESULT -> LESSON.

When the attempt exposes a missing technique or execution surface, the trajectory branches through:

CAPABILITY_GAP -> RESEARCH -> CAPABILITY_IMPLEMENTATION -> CAPABILITY_PROOF -> SKILL_COMMIT,

then returns to the normal render/compare/correction loop. Research provenance, resolved gaps,
and AE-proven learned skills are retained with the selected Edit Type.

Reusable successes, failure-avoidance lessons, and development patterns are distilled into
the selected Edit Type while the event history remains available as evidence. Pro Creation
loads that knowledge but must adapt it to the new footage rather than replaying literal values.

Practice and Pro Creation expose the same Cancel control. Cancellation is immediate while an
assignment is queued. After GPT has begun work it becomes a cooperative safe-stop request:
GPT checks state between meaningful operations, stops starting new work, restores or retains
the last safe AE checkpoint, and acknowledges cancellation. A cancellation request wins over
a simultaneous success completion, so cancelled work cannot be certified as mastered.

## Integration boundary still open

1. deploy a continuously available authenticated ChatGPT worker/trigger that claims new
   assignments without requiring a user message in an existing chat;
2. broaden GPT-facing Eyes and Hands tools beyond the current Shadow connector surface;
3. benchmark full-length real movies and difficult references, then tune indexing evidence;
4. add best-attempt playback, richer human grading, and restart recovery to the CEP panel.

The assignment queue, connector control surface, Edit Type learning trace, Pro Creation
mastery gate, and Practice/Pro Creation cancellation lifecycle are implemented. The remaining
items are deployment and proof gaps; the local deterministic M6 loop is retained as GPT's
toolkit and is no longer the governing creative decision-maker.
