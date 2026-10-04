# Direct footage analysis and preset memory

ChatGPT alone chooses which provided raw footage to inspect and which ranges to edit.
It uses internet scene, dialogue, transcript and chapter clues, then requests explicit
timestamped pixels from the supplied media. Pixel receipts, source hashes, comparison
anchors, selected ranges and rationale bind decisions to the actual files. No ranked
candidate generator, scene detector or source-matching engine remains.

ChatGPT directly defines Finish duration and continuous reference shots before Practice
construction. Changed outlines require renewed footage choices. Source preparation only
extracts the chosen ranges and handles; Finish is reference-only.

The existing per-preset gptLearning record holds workedExamples and chatgptReviews alongside
earlier lessons and failures. Examples retain the problem, ordered actions/settings,
reasons/checks, observed outcome, explanation, adaptation and mistakes to avoid. History
is immutable; later lessons may explicitly supersede earlier ones. ChatGPT reads and
adapts the record, reviews actual renders and saves new evidence-backed examples.

Historical machine evidence is context only. Its generating engines and launchers are
deleted. See [current authority](chatgpt-editorial-authority.md) and
[footage selection](CHATGPT_RAW_FOOTAGE_SELECTION.md).
