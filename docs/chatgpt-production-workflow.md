# ChatGPT production workflow

The six-recording study identified repeated discovery, incomplete method records,
fragile copying and slow feedback as the main workflow problems. This revision
retains explicit decisions in the existing production coordinator and complete
methods in the existing selected preset notebook. It introduces no editorial
engine, competing controller or automatic recipe application.

`CHATGPT_PRODUCTION_WORKFLOW_V1` is the only primary workflow for Practice and
Pro Creation. The queue, source preparation, research, native adapters and notebook
are its components. Older workflows, selectors and fallback launchers are removed.

## Production use

1. Read `GET /v1/product/gpt/production-workflow-contract`, the current assignment's
   `production`, `practice-notebook`, source selections, research plans and receipts.
   Reconcile the retained AE state and advance the known next action.
2. POST `WORKFLOW_PLAN` to `assignments/{id}/production` with `claimedBy` and `plan`.
   Choose scope, learning/repeat mode, output geometry/timebase, prepared raw ranges,
   handles/fps/action frames, supplied audio/offset, anchors, events, pass order,
   finishing and next action. New choices need new immutable decision IDs.
3. Establish early playable coverage and work in coherent sections/passes chosen
   by ChatGPT. Prototype unfamiliar critical behavior when useful. Keep unresolved
   issues explicit; a pass review accepts only the dimensions actually reviewed.
4. Consult retained tutorial evidence or new research. Per-clip SCAN and PLAN
   remain mandatory. `SOURCE reuseSourceId` reuses consulted evidence with new
   target adaptation; the existing Tutorial Drive -> Adobe -> web order remains.
5. Submit coherent exact operations through `production-jobs` with immutable
   `editorialDecision` and required `workflowContext`:
   `{workflowId:"CHATGPT_PRODUCTION_WORKFLOW_V1",planDecisionId,planHash,eventIds}`.
   New jobs must bind the active retained ChatGPT plan and chosen event scope.
   Before raw selections are ready, `REFERENCE_ANALYSIS` alone can use
   `{workflowId:"CHATGPT_PRODUCTION_WORKFLOW_V1",phase:"PREPARATION"}`.
   Raw browsing, research and preflight are preparation within this same workflow.
   Existing accepted queue receipts remain resumable unchanged across rollout and
   plan revisions. Only the server's loaded receipt IDs grant compatibility; client
   flags cannot request it. New jobs and final completion cannot bypass the plan.
6. Choose local preview bounds/handles and `resolutionScale` (1, .25, .125).
   Reduced previews render an isolated unpatched duplicate. Full-resolution
   checks handle flow, occlusion, matte, crop and boundary uncertainty. Final
   acceptance still requires the canonical full-resolution whole edit.
7. POST `WORKFLOW_REVIEW` with a direct ChatGPT verdict, dimensions, remaining
   issues, exact construction decision, retained render and issued inspections.
   Retain complete WORKED/FAILED/UNVERIFIED examples after observed attempts.
8. Record TELEMETRY with activity and purpose, and WORKFLOW_MILESTONE with evidence.
   Unknown gaps stay unattributed. Separate first-time learning/preparation from
   repeat production while preserving total cost and end-to-end elapsed time.

## Complete method and explicit transfer

A worked example may carry `method` (`editflow.production-method.v1`): source
fingerprints/fps/handles and traversal samples; distinct containers with geometry,
fps/time origins/2D-or-3D space/parent IDs; output anchors; property channels with
all exact keys and interpolation; effect identities/order/versions/settings;
source/reveal/matte/text-path dependencies; adaptation checks and failure symptoms.
The legacy action/settings/reason/check fields and previous examples are preserved.

`methodApplications` explicitly names a current WORKED lesson, every source,
container and effect rebinding, adaptation checks and the exact adapted method.
Mechanical validation rejects unresolved dependencies, parent cycles, duplicate
stack slots and source traversal beyond handles. It does not synthesize keyframes,
pick sources, repair binding values or declare visible success. ChatGPT constructs
the corresponding exact AE plan and reviews actual readback/playback. A structural
method change uses a new construction decision and retained lesson rather than
pretending to be an unchanged copy. Failed/unverified examples remain visible.

## Scope and evidence limits

The bundled study catalog covers all six recordings: velocity/text, masked camera
reveals, collage/selectors, Element/Roto Brush, axis-specific stabilization,
paired slides/key/wipes, custom lighting/RGB accents, repeated velocity/null motion,
the paired vertical cut, and optional selective picture enhancement. These are
UNVERIFIED research candidates with source locators and applicability checks.
They do not claim plugin/native capability parity or enter preset learning as WORKED.
Tracking, masks, rich text, geometry and enhancement need targeted local proof when
chosen by ChatGPT. Retained successful values are never universal defaults.

Prepared-source browsing and working-media caching already exist and remain the
only source path. The workflow preserves exact selections rather than repeatedly
scanning/importing whole movies. Retiming, text, audio and motion anchors remain
GPT choices; changing an event requires explicitly adapting its dependent channels.

The matched benchmark is a familiar 14–15s two-shot edit with prepared permitted
assets. Its 60-minute budget is unmeasured and advisory. Include preparation,
learning, active work, machine processing, recovery, export and full elapsed time.
Speed and fidelity are accepted only after several comparable reviewed runs.

## Maintenance

Existing assignments, notebook identity, worker fencing, durable receipts and pause
state survive rollout. Load policy by restarting only the idle local control service
after verifying no held writer/in-flight jobs. Keep AE and the CEP panel open.
Do not change supervisor generations, recover credentials, resume Practice or run
native editing scripts as part of maintenance.

The orphaned `run-practice-held-out-isolation-proof.ps1` machine-certification
launcher and unused `practice-live-proof-assertions.ts` module are deleted. Native
capability proof harnesses remain because they test exact GPT-directed execution;
they do not choose edits or provide another production workflow.
