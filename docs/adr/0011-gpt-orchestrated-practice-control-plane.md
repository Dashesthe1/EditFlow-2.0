# ADR 0011: GPT-Orchestrated Practice Control Plane

## Status

**Superseded in part by `docs/ORIGINAL_M6_WORKFLOW_RESET.md`.**

The durable assignment, cancellation, persistence, learning-memory, and proof-separation parts of this ADR remain accepted. The earlier decision that GPT itself is the governing creative edit loop is superseded for reference-driven Practice and reference-driven effect/transition work.

Under the reset, GPT owns session continuity, supervision, escalation, capability/tool invocation, and retained learning. The original M6 Visual Effects Intelligence workflow owns the governing reference-driven effect loop: dense reference evidence -> anatomy/DNA -> construction or synthesis -> local render -> semantic comparison -> bounded correction -> fidelity gate. Later systems remain supporting tools rather than alternate workflow controllers.

## Context

Practice was initially implemented as a local deterministic reconstruction loop.
That loop could analyze media, use M6 constructions, mutate After Effects, render,
compare, and retry, but it made EditFlow code the creative decision-maker.

The product requirement is different: GPT is the creative reasoner and learner.
EditFlow Brain, visual analysis, typed AE transactions, and Desktop Commander are
supporting Eyes, knowledge, Hands, and system control. Practice must preserve GPT's
entire reasoning and correction trajectory under the selected Edit Type so Pro
Creation can reuse successful development patterns and avoid known failures.

## Decision

The Practice panel creates a durable `editflow.gpt-orchestration-assignment.v1` so the same Practice work survives ChatGPT handoffs and service interruption. The assignment is the continuity/control record, not a license to replace M6 with a new free-form editing loop.

For reference-driven effects and transitions, the original M6 reference-first workflow is the governing production path. GPT supervises that path and invokes supporting Eyes/Hands/Brain capabilities, tutorial learning, tracking, roto, subject isolation, retained-truth systems, or capability development when M6 evidence requires them.
The assignment contains the mode, Edit Type, Start and Finish media, retained Edit
Type knowledge, artifact directory, and a complete GPT editing brief.
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

## Alternatives considered

- Use a separate GPT-authored free-form effects loop in place of VisualEffectsBrainV1. Rejected by the Original M6 Workflow Reset because it duplicates the reference-first M6 control loop and was producing repeated/restarted work across chats.
- Call an OpenAI model directly from the CEP panel. Rejected because credentials and
  model traffic do not belong in the AE extension trust boundary.
- Store only final recipes. Rejected because failed hypotheses, correction effects,
  efficiency, and causal lessons are necessary for transfer.
- Hard-kill every active operation on Cancel. Rejected as the sole policy because AE
  transactions require safe rollback/checkpoint handling; child-process cancellation
  remains the responsibility of the executing Eyes/Hands adapter.

## Consequences

The local M6 engine remains valuable as a tool and fallback implementation, but it is
not the governing creative decision-maker for panel-launched Practice or Pro Creation.
Assignments and learning survive chat or service process loss through atomic JSON
persistence. Edit Type revisions now include GPT learning history.

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
