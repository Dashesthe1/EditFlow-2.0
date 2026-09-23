# ADR 0011: GPT-Orchestrated Practice Control Plane

## Status

Accepted.

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

The Practice panel creates a durable editflow.gpt-orchestration-assignment.v1
rather than starting the deterministic Practice engine as the governing loop.
The assignment contains the mode, Edit Type, Start and Finish media, retained Edit
Type knowledge, artifact directory, and a complete GPT editing brief.
The authenticated Shadow connector exposes assignment discovery, claim, learning
event recording, completion, failure, status, and cancellation operations. GPT uses
the existing EditFlow perception and AE execution surfaces while recording events in
the sequence observation, interpretation, hypothesis, plan, AE action, render,
comparison, diagnosis, correction, result, and lesson.

Each learning event is retained in the orchestration store. Transferable success,
failure-avoidance, and development-pattern fields are also distilled into the Edit
Type profile. Pro Creation requires a mastered GPT Practice session and receives the
same retained knowledge without a Finish reference.

The UI has one cancellation lifecycle for Practice and Pro Creation. Queued work is
cancelled immediately. Running work moves to CANCEL_REQUESTED; GPT must stop at a
safe checkpoint and acknowledge cancellation. Completion after a cancellation request
resolves to CANCELLED, never mastered.

## Alternatives considered

- Continue expanding VisualEffectsBrainV1 into the primary editor. Rejected because
  it replaces the required GPT reasoning and learning loop.
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
remain proof obligations; prose reasoning alone cannot certify mastery.

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
