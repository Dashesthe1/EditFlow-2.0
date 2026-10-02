# ADR 0011: GPT-Orchestrated Practice Control Plane

## Status

**Superseded by the Primary Edit Production System architecture (October 2, 2026).**

The durable assignment, persistence, cancellation, learning-memory, and proof-separation
parts of this ADR remain accepted. The current authority is one production system for
Practice and Pro Creation: durable assignment -> production coordinator/job queue ->
single AE writer -> persistent warm CEP runtime -> After Effects -> render/readback ->
retained evidence. M6 remains an integrated Practice reference-fidelity engine, not a
separate governing controller.

## Context

Practice was initially implemented as a local deterministic reconstruction loop.
That loop could analyze media, use M6 constructions, mutate After Effects, render,
compare, and retry, but it made EditFlow code the creative decision-maker.

The product still requires GPT supervision and durable learning. The current primary
production system owns scheduling, continuity, batching, checkpoints, and AE execution.
GPT owns creative judgment and escalation inside that system. For Practice, EditFlow
Brain/M6 supplies the integrated reference-fidelity loop from dense evidence through
anatomy/DNA, construction/synthesis, local render, semantic comparison, bounded correction,
and fidelity gating. For Pro Creation, the same production system operates without a
Finish answer key and uses TRANSFER_VERIFIED Edit Type knowledge plus actual render review.

## Decision

The Practice panel creates a durable `editflow.gpt-orchestration-assignment.v1` as
the continuity/control record across ChatGPT conversations. Together with the production
coordinator/job queue, single AE writer, and warm CEP runtime, it is the primary production
path. The assignment contains the mode, Edit Type, Start and Finish media, retained
knowledge, artifact directory, and the mode-specific production brief.
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

### October 2026 architecture amendment — Primary Edit Production System

Direct GPT inspection, bounded working clips, exact provenance, M6 fidelity analysis,
Edit Type knowledge, tutorial compilation, transactional AE control, persistent warm
execution, and proof infrastructure are now integrated under one production controller.

For Practice, M6 provides the reference-fidelity sub-loop when needed:
reference effect detection -> dense frame evidence -> anatomy/DNA -> causal knowledge ->
construction/synthesis -> real AE -> local render -> reference/render comparison ->
visual diagnosis -> bounded correction -> fidelity gate. The primary production system
owns the whole-edit schedule, durable jobs, checkpoints, and AE writer.

For Pro Creation, the same primary system operates without a Finish answer key using
TRANSFER_VERIFIED knowledge, the source media, the chosen editorial target, and actual
render review. No legacy or parallel whole-edit controller is authorized.

## Alternatives considered

- Use any separate whole-edit controller beside the primary production system.
  Rejected because duplicate controllers weaken checkpoint continuity, repeat work across
  ChatGPT handoffs, and create competing AE mutation authority.
- Call an OpenAI model directly from the CEP panel. Rejected because credentials and
  model traffic do not belong in the AE extension trust boundary.
- Store only final recipes. Rejected because failed hypotheses, correction effects,
  efficiency, and causal lessons are necessary for transfer.
- Hard-kill every active operation on Cancel. Rejected as the sole policy because AE
  transactions require safe rollback/checkpoint handling; child-process cancellation
  remains the responsibility of the executing Eyes/Hands adapter.

## Consequences

The Primary Edit Production System is the only production controller for Practice and
Pro Creation. GPT supplies creative judgment and escalation inside it; M6 supplies
Practice reference-fidelity analysis/synthesis when needed; later EditFlow capabilities
remain integrated tools and proof infrastructure. Assignments, jobs, checkpoints, and
learning survive chat or service process loss through durable persistence. Edit Type
revisions continue to include GPT learning history.

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
