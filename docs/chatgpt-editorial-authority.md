# ChatGPT editing authority and preset Practice notebook

Practice and Pro Creation use the existing durable production queue. ChatGPT is
the sole editorial decision authority. The worker executes accepted explicit plans;
it does not choose footage, parameter values, effect recipes, corrections or winners.

| Former production choice | Current production path |
| --- | --- |
| Reference cut detection and static-tail removal | GPT inspects Finish and records `DEFINE_REFERENCE` with explicit shot bounds and duration. |
| Raw-shot matching and ranking | GPT requests its own frames/contact sheets, researches internet scene clues, and records exact `SELECT` decisions. |
| Automatic audio offset, rate and arrangement | GPT chooses raw audio and supplies explicit AE timing/settings in its plan. |
| Derived baseline framing, motion and remap | `BUILD_BASELINE` executes a GPT-authored transaction; no automatic baseline generation. |
| Local EditorBrain technique selection and formula pulses | Brain and formula generator code is deleted; exact intents/keyframes are required. |
| Effect detection/anatomy and synthesized correction | GPT directly observes, designs and corrects; reference jobs return only requested pixels. |
| Tutorial compiler construction choices | Compiler implementation is deleted; GPT records directly reviewed source method steps. |
| Candidate scores and 32→8→2 elimination | Every requested candidate renders in input order; GPT sees and chooses alternatives. |
| Ranked residuals and automatic strategy changes | Status returns observations; GPT chooses the next operation. |
| Machine similarity/certification and transfer gates | Direct review of the retained final render decides PASS/REVISE. Scores are advisory. |
| Local Qwen visual decision drivers | Physically deleted, including scripts and launchers. |

Codecs, metadata, exact range extraction, file hashes, rendering, native execution,
leases and crash reconciliation remain mechanical tools. Native tracking/roto must
have GPT-chosen targets, methods and settings, no automatic backend fallback, and
direct review of the output. These tools do not supply an independent editorial plan.
The retired engines, lab launchers, compiler routes and certification UI are physically
deleted. Historical records remain readable for provenance and prior learning; no engine
is retained to execute them. Clean builds also delete stale emitted JavaScript.

## Queue contract

Every payload includes `editorialDecision` with `authority: "CHATGPT_DIRECT"`, a
unique `decisionId`, rationale, evidence references and ordered steps. Admission
retains an immutable hash of the exact payload. Changed plans need a new decision.
Queued execution revalidates that receipt after a chat handoff. Reviewed native
scripts additionally bind `scriptSha256`. Reconciliation preserves worker-issued
render identities rather than replacing them with a reviewer's supplied path.

An old READY preflight cannot bypass a GPT-defined reference outline. Selections
are bound to that outline and issued inspection receipts. Changed boundaries require
freshly reaffirmed choices; unchanged outlines preserve correct selections and AE work.

Completion requires direct comparisons for every chosen clip, seven reviewed areas
(shots, timing, audio, framing, effects, transitions, color), the exact render hash
and no unresolved issues for PASS. Practice uses a whole-edit render covering the
GPT-defined duration. A numerical score alone cannot complete an assignment.

## Existing learning record, extended

The selected Edit Type already has `gptLearning`. Its lessons, failures, skills and
history are preserved. New `workedExamples` and `chatgptReviews` extend that record;
there is no parallel per-preset learning database.

`GET /v1/product/gpt/assignments/{id}/practice-notebook` retrieves the current preset
record. `?q=...` searches full examples without ranking or choosing a recipe. New
sessions and resumed chats receive the contract and current notebook context.

`POST` takes the current `claimedBy`, a `lesson`, and `reviewEvidence`. A lesson
retains its problem, ordered actions and exact settings, reason and check for each
step, observed WORKED/FAILED/UNVERIFIED outcome, explanation, when to use it,
adaptation guidance, mistakes to avoid and evidence. WORKED/FAILED require issued
render inspections or a retained failed job for execution failure. Verified receipt
references are automatically attached to the retained example.

Save after reviewed attempts, before handoff and before completion. Completion
requires a reviewed example from the current session. Immutable lesson IDs preserve
the history; corrections use a new lesson with `supersedesLessonIds`. Writes to the
existing registry are serialized so notebook updates and ordinary learning events
cannot overwrite each other. A different preset remains separate.

This is persistent retrieval-based learning, not model-weight training or guaranteed
automatic improvement. GPT reads earlier worked solutions and failed attempts,
decides what applies, adapts the steps, tests the result and records the next lesson.

## Broad-edit declaration

Once whole-edit coverage exists, an AE mutation affecting more than
`max(3, ceil(total clip phases × 25%))` declared phases requires `globalOperation:true`.
For 20 clips the limit is 5; a 6-clip change must be deliberately declared global.
This concerns affected clip phases, not keyframe count, layers or effect count. It
protects completed regions and their retained research/proof from accidental broad
changes. ChatGPT can still plan whole-edit work. Initial baseline assembly is global.
