# Tutorial-Driven Learning Roadmap

Effective 2026-09-17, professional tutorials become the demand signal for new EditFlow creative capability work.
This track overlays the existing M0-M11 roadmap; it does not renumber or invalidate previously accepted milestones.

## Core rule

A tutorial is not stored as a list of clicks. It is compiled into:

1. **WHAT** — the intended visible editing result.
2. **WHEN / WHY** — the scene conditions that justify the technique.
3. **HOW** — reusable semantic construction steps.
4. **ACCESS** — the exact EditFlow / After Effects capabilities required by those steps.
5. **PROOF** — evidence that the skill was reconstructed and transferred to unrelated footage.

The tutorial pipeline is:

`upload -> analyzer -> analysis packet -> lesson compiler -> capability discovery -> reconstruction -> transfer -> training memory`

## Track T1 — Tutorial ingestion contract

- Accept one tutorial upload at a time.
- Preserve source lineage for the video, transcript, project file, source media, and reference render when supplied.
- Extract time-bounded steps, intent, observable result, capability requirements, adaptation variables, and validation criteria.
- Reject malformed or source-mismatched analysis before it can affect training memory.
## Track T2 — Tutorial-driven capability discovery

For every required capability, compare the lesson against the live Capability Registry and classify it as:

- `READY` — an available route exists at sufficient proof maturity.
- `PARTIAL` — usable, but support or preferred routing is incomplete.
- `PROOF_REQUIRED` — the route exists, but accepted evidence is below the tutorial requirement.
- `ADAPTER_REQUIRED` — the capability is registered but has no usable runtime route.
- `UNAVAILABLE` — explicitly unavailable in the current environment.
- `UNREGISTERED` — the tutorial exposed a capability EditFlow does not yet model.

Only non-ready tutorial requirements enter the development queue. Optional gaps remain non-blocking.
A requirement defaults to needing `FULL` capability support. It may explicitly set `minimumSupportStatus: PARTIAL`
only when the tutorial uses a bounded subset already covered by the capability's accepted evidence and limitations.
Proof maturity remains an independent gate; accepting partial support never promotes the capability globally.
This replaces broad speculative AE-surface expansion as the default sequencing method.

## Track T3 — Skill reconstruction

- Build the technique from semantic operations rather than memorized coordinates or clicks.
- Use the Fast AE Control Path and existing adapters whenever they satisfy the lesson requirements.
- Add only the missing capability routes required to complete the current lesson.
- Capture structural and visual evidence against the tutorial result.

A skill starts in `OBSERVED`. A successful same-technique reconstruction promotes it to `RECONSTRUCTED`.

## Track T4 — Transfer verification

Apply the learned skill to materially different footage and adapt scene-dependent parameters from evidence.
Successful transfer promotes the skill to `TRANSFER_VERIFIED`. Repeated cross-condition success can promote it to `ROBUST`.
## Track T5 — Executable training memory

Persist only verified skills. Each record should retain prerequisites, required capabilities, semantic topology, timing/curve models,
adaptation variables, validation criteria, failure modes, reference evidence, and proof state.
Later tutorials should strengthen or extend matching skills rather than create duplicate opaque presets.

## Track T6 — Autonomous composition

Scene Understanding identifies editing opportunities, Training Memory supplies candidate techniques, the Capability Registry preflights access,
and the planner compiles a bounded execution plan. The editor then executes, previews, diagnoses, and refines at meaningful checkpoints.

## Current implementation checkpoint

The `@editflow/tutorial-learning` package establishes the T1/T2 foundation:

- typed tutorial upload and analyzer contracts;
- validated tutorial lesson compilation;
- merged per-skill capability requirements;
- source-lineage enforcement;
- capability discovery against the existing registry;
- tutorial-generated development queues;
- `OBSERVED -> RECONSTRUCTED -> TRANSFER_VERIFIED -> ROBUST` promotion rules;
- JSON Schema fixtures for normalized tutorial analysis packets.

The next implementation step is the first real tutorial analyzer adapter, followed immediately by one reconstruction + transfer proof.
