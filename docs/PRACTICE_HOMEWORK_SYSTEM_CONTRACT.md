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

## Implemented V1 modules

- packages/practice-homework/src/contracts.ts
- packages/practice-homework/src/similarity.ts
- packages/practice-homework/src/memory.ts
- packages/practice-homework/src/engine.ts
- packages/practice-homework/src/ui-contract.ts
- spec/practice-session-v1.schema.json
- tests/practice-homework.test.mjs

The package is re-exported through @editflow/editor-brain and the MCP server module.

## Integration boundary still open

V1 deliberately separates orchestration from heavy media adapters.
The next implementation layer must connect PracticeHomeworkAdaptersV1 to real:

1. full-video shot decomposition and indexing;
2. effect-robust reference-to-source retrieval and temporal alignment;
3. AE content-baseline materialization;
4. per-shot M6 reconstruction and render comparison;
5. persistent disk-backed Practice/Experience Memory;
6. the shipping EditFlow visual panel/drop zones.

These are implementation gaps, not reasons to weaken the Practice contract.
