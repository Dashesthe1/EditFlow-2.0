# EditFlow 2.0 Practice / Homework System Contract

Status: **V1 orchestration foundation implemented**

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

V1 implements the Practice orchestration contract. Pro Creation is represented in
the mode controller but intentionally does not execute through the homework engine.
## Practice user surface

The stable V1 UI contract is:

- **Finish** - one professional finished edit (FINISH_REFERENCE).
- **Start** - one or more raw source videos (START_SOURCE), including full movies.
- **Proceed to do homework** - begins the supervised reconstruction session.

The JSON contract is spec/practice-session-v1.schema.json.

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

## Integration boundary still open

The remaining production integration is narrower:

1. connect per-shot/reference-window decomposition to the existing M6 dense-effect evidence pipeline;
2. connect reconstruction attempts to the existing M6 VisualEffectsBrain, Recipe Compiler, and live AE transaction runner;
3. render each attempt and convert M6 semantic/reference comparisons into the aggregate Practice similarity report;
4. benchmark full-length real movies and difficult references, then tune indexing/refinement confidence gates;
5. add the shipping EditFlow visual panel/drop zones for Finish, Start, mode selection, progress, best-attempt preview, and human grading.

These are implementation/proof gaps, not reasons to weaken the Practice contract or certify an unverified reconstruction.
