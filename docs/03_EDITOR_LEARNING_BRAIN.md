# Editor Learning Brain

## Purpose

Turn expert editing demonstrations into reusable editing judgment, executable techniques, transfer exercises, and failure-aware memory before autonomous production begins.

The system is intentionally model-agnostic. Multimodal models may extract tutorial knowledge and evaluate rendered evidence, but the stored contracts, retrieval, mastery progression, and scoring rules remain deterministic and testable.

## Learning loop

1. **Observe** — ingest a tutorial or professional reference and extract demonstrations, actions, context, inferred principles, and candidate skills.
2. **Distill** — merge repeated demonstrations into canonical skills containing WHEN, WHY, HOW, visual targets, parameter guidance, failure modes, adaptation rules, and variants.
3. **Reconstruct** — reproduce the demonstrated technique closely enough to establish a trustworthy baseline.
4. **Evaluate** — score intent match, timing, pacing, continuity, readability, motion quality, color consistency, sound sync, effect restraint, and technical integrity.
5. **Transfer** — apply the same principle to materially different footage instead of copying absolute tutorial values.
6. **Compose** — combine verified skills where their relationships and context justify it.
7. **Remember** — store successful and failed experiences with context, decisions, results, lessons, and evaluation evidence.
8. **Retrieve** — during production, retrieve a small context-relevant set of skills plus both successful and warning experiences.

## Skill maturity

Skills progress through:

- `OBSERVED`
- `RECONSTRUCTED`
- `VISUAL_MATCH_VERIFIED`
- `TRANSFER_VERIFIED`
- `OBJECT_AWARE_VERIFIED`
- `ROBUST`

A tutorial being understood does not make a skill production-ready. Transfer and varied-context evidence are required before high mastery is justified.

## Core records

`TutorialSource` identifies provenance without copying the tutorial itself.

`TutorialDemonstration` captures what the expert was trying to accomplish, the meaningful action sequence, observed visual changes, and inferred principles.

`EditingSkill` stores reusable editorial knowledge:

- domains, tags, and intents;
- prerequisites;
- when to use / when not to use;
- why the technique works;
- procedural construction steps and required capabilities;
- parameter guidance;
- visual targets;
- failure modes;
- adaptation rules;
- variants and source provenance;
- confidence and mastery.

`SkillEdge` creates a skill graph for prerequisite, variant, compatible, conflicting, and sequencing relationships.

`ExperienceRecord` stores deliberate-practice and production evidence, including failures. Negative evidence is retrieved as a warning rather than discarded.

## Retrieval

The first implementation ranks skills deterministically using current edit context, semantic token overlap, skill confidence, mastery, and amount of prior evidence. It returns relevant successful experiences and failure/mixed experiences separately.

This baseline can later be augmented by embeddings or multimodal retrieval without changing the knowledge contract.

## Evaluation

The default rubric treats these as critical gates:

- intent match;
- timing;
- readability;
- technical integrity.

A high average score cannot hide a critical failure. For example, an edit that is visually elaborate but makes the subject unreadable should still fail.

## Tutorial-corpus ingestion target

For each of the 99 tutorials, the ingestion stage should eventually produce:

1. tutorial source metadata;
2. one or more demonstrations;
3. normalized skill candidates;
4. graph relationships to existing skills;
5. reconstruction exercise;
6. transfer exercises on different footage;
7. evaluation evidence;
8. success/failure experiences;
9. mastery recommendation.

The tutorial videos themselves should remain external assets. The repository stores derived factual/procedural knowledge, evidence references, and provenance rather than vendoring copyrighted source media.

## Production integration

Before an autonomous edit operation, the editor agent should create an `EditingContext` from the current footage, audio, creative goal, and constraints, then call the knowledge retriever. The retrieved skills guide planning; warning experiences prevent repetition of known failures. After preview and critique, the result is recorded back into Experience Memory.

This makes the intended production loop:

`observe footage -> retrieve knowledge -> decide -> execute -> preview -> evaluate -> refine -> record experience`.
