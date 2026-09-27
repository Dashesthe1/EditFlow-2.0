# ADR 0011: GPT-Orchestrated Practice Control Plane

## Status

**Superseded in part by the Original M6 Workflow Reset.**

The durable assignment, persistence, cancellation, learning-memory, and proof-separation
parts of this ADR remain accepted. The later decision that GPT itself is the governing
creative reconstruction loop is superseded for reference-driven Practice and reference-
driven effects/transitions.

## Context

Practice was initially implemented as a local deterministic reconstruction loop.
That loop could analyze media, use M6 constructions, mutate After Effects, render,
compare, and retry, but it made EditFlow code the creative decision-maker.

The product still requires GPT supervision and durable learning, but the original M6
roadmap is again the governing reference-driven production workflow. GPT owns session
continuity, direct visual inspection when needed, escalation, tool/capability invocation,
and learning. EditFlow Brain/M6 owns the reference-first effect loop from dense evidence
through anatomy/DNA, construction/synthesis, local render, semantic comparison, bounded
correction, and fidelity gating. Later systems support that loop rather than replacing it.

## Decision

The Practice panel creates a durable `editflow.gpt-orchestration-assignment.v1` as
the continuity/control record across ChatGPT conversations. The assignment is not a
replacement governing edit loop. It contains the mode, Edit Type, Start and Finish media,
retained knowledge, artifact directory, and a brief that requires the original M6
reference-first workflow for reference-driven reconstruction.
The authenticated Shadow connector exposes assignment discovery, claim, learning
event recording, completion, failure, status, and cancellation operations. GPT uses
the existing EditFlow perception and AE execution surfaces while recording events in
the sequence observation, interpretation, hypothesis, plan, AE action, render,
comparison, diagnosis, correction, result, and lesson.

Each learning event is retained in the orchestration store. Transferable success,
failure-avoidance, and development-pattern fields are also distilled into the Edit
Type profile. GPT cannot certify its own Practice success: completion triggers an
independent final-render verification pass using the source matcher, content comparator,
and M6 semantic effect/transition evidence. Passing one reference creates
REFERENCE_VERIFIED knowledge; Pro Creation requires TRANSFER_VERIFIED knowledge from
a later materially different reference/source set before it can receive that Edit Type
without a Finish reference.

The UI has one cancellation lifecycle for Practice and Pro Creation. Queued work is
cancelled immediately. Running work moves to CANCEL_REQUESTED; GPT must stop at a
safe checkpoint and acknowledge cancellation. Completion after a cancellation request
resolves to CANCELLED, never mastered.

### September 2026 architecture amendment — superseded by Original M6 reset

Direct GPT observation of Finish/raw/rendered pixels remains an available inspection tool,
and the bounded working-clip/source-provenance improvements remain active. What is
superseded is the claim that GPT's free-form blueprint outranks the M6 reconstruction loop.

For reference-driven Practice, the original M6 sequence is authoritative:
scene understanding/editorial decision -> reference effect detection -> dense frame
evidence -> anatomy/DNA -> causal knowledge -> construction hypothesis -> capability
mapping/unknown synthesis -> Recipe Compiler/Virtual AE/real AE -> local render ->
reference/render fidelity comparison -> visual diagnosis -> automatic correction ->
fidelity gate -> final edit.

GPT supervises and resumes that sequence. Full-length Start video remains search-only;
exact matched ranges are still materialized into bounded cached working clips, and later
tracking/roto/mask/subject-isolation/retained-truth systems remain callable tools.

## Alternatives considered

- Use a separate GPT-authored free-form effects loop in place of the original M6
  reference-first workflow. Rejected because it duplicates the M6 control loop, weakens
  checkpoint continuity, and caused repeated/restarted work across ChatGPT handoffs.
- Call an OpenAI model directly from the CEP panel. Rejected because credentials and
  model traffic do not belong in the AE extension trust boundary.
- Store only final recipes. Rejected because failed hypotheses, correction effects,
  efficiency, and causal lessons are necessary for transfer.
- Hard-kill every active operation on Cancel. Rejected as the sole policy because AE
  transactions require safe rollback/checkpoint handling; child-process cancellation
  remains the responsibility of the executing Eyes/Hands adapter.

## Consequences

The original M6 engine/workflow is the governing reference-driven effects/transition
decision path for Practice. GPT remains the continuity owner and escalation supervisor,
while later EditFlow systems remain callable tools and proof infrastructure. Assignments
and learning survive chat or service process loss through atomic JSON persistence. Edit
Type revisions continue to include GPT learning history.

A continuously available ChatGPT worker or platform trigger is still required for
zero-message automatic claiming. Until that deployment integration exists, the panel
truthfully displays WAITING_FOR_GPT rather than pretending local rules are GPT.

## Human-parity impact

GPT can reason about unfamiliar effects, source parallelism, pacing, and correction
causally while retaining evidence across sessions. Typed AE execution and comparison
remain proof obligations; prose reasoning alone cannot certify mastery. Assignment
COMPLETED and Practice MASTERED are intentionally separate states of truth: completion
describes controller lifecycle, while retained machine evidence determines certification.

## Research priority

For unfamiliar or poorly understood reference behavior, the Tutorial Drive is the
first research surface for GPT-orchestrated Practice and Pro Creation. GPT searches the
tutorial library for the closest matching technique and learns the demonstrated
construction before consulting external sources. Official Adobe documentation/resources
and the installed Adobe feature/plugin surface are second priority. External
professional tutorials and plugin/vendor documentation follow; broader web/internet
research is last.

Tutorial research remains discovery evidence rather than proof. A learned technique is
not certified until its After Effects construction has retained readback/render evidence
and, where applicable, comparison evidence against the Finish reference.

## Safety and rollback impact

Only registered EditFlow/AE execution routes may mutate After Effects. Cancellation
is observable, durable, idempotent, and cannot race into a successful certification.
The GPT controller must check assignment state between meaningful operations.

## Proof impact

The change requires schema fixtures, store lifecycle tests, Edit Type transfer tests,
connector-surface tests, panel surface tests, and cancellation race tests.
