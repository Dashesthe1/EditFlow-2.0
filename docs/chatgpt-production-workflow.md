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

1. Call claim_gpt_assignment once with the issued worker. Its response bundles the
   assignment, retained queue/jobs, checkpoint, selected raw ranges, notebook and AE
   state. Continue retained work; there is no tool-inventory preflight checklist.
2. Recognize effect families once and assemble playable coverage across the whole
   edit. Pass across timing/framing/retiming, then effects, whole-edit review,
   targeted corrections and finishing. No local PASS is needed to build another shot.
3. Submit exact ChatGPT AE operations in coherent batches (up to 64 AE_BATCH
   actions), with assignment/worker identity and editorialDecision. The queue
   checks ownership, retains the decision/receipt and checkpoints committed batches.
   WORKFLOW_PLAN, workflowContext and READY research plans are optional memory.
   Explicit old plan bindings remain validated when a caller supplies them.
4. Choose known constructions or adapt WORKED notebook methods directly. Research
   only unfamiliar or changed components, using Tutorial Drive -> Adobe -> web.
   SCAN/SOURCE/PLAN can retain detailed first-time learning without blocking editing.
5. Review audiovisual previews at pass boundaries. LOCAL_RENDER supports scales
   1, .25 and .125; reduced previews use isolated copies. A completed preview does
   not block the queue on another resolve receipt. Use focused full-resolution
   checks for actual temporal, edge or matte defects. Final acceptance requires
   direct review of the full-resolution whole edit.
6. Save observed successes/failures and complete reusable methods at meaningful
   review/pass boundaries, handoff and completion. Optional WORKFLOW_REVIEW and
   telemetry records support diagnosis; they are not AE permission gates.

Opaque/partial/failed writes still need readback-based reconciliation before replay.
Actual source changes, user cancellation and conflicting worker identities remain
execution constraints. A committed batch stays SUCCEEDED even if its automatic AEP
save fails; its checkpoint warning requires attention without replaying the edits.

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
