# Direct ChatGPT editing

Practice and Pro Creation use CHATGPT_PRODUCTION_WORKFLOW_V1, executed through the
single durable production queue. The normal path is:

Resume once -> ChatGPT decides -> AE batch -> inspect -> correct.

- claim_gpt_assignment is the one-call resume: it returns the retained assignment,
  queue receipts, checkpoint, raw selections, current preset notebook and AE state.
  Do not restart the assignment or repeat a tool inventory/preflight checklist.
- Submit exact operations through production-jobs with the issued worker in
  researchContext and an immutable ChatGPT editorialDecision. The gateway verifies
  the current generation, establishes/renews its claim and journals the receipt
  inside admission. Do not reread ownership before every operation.
- workflowContext, WORKFLOW_PLAN, WORKFLOW_REVIEW and per-clip READY research plans
  are optional supporting memory. They are not prerequisites for AE construction.
- Batch coherent operations across shots or the whole edit. AE_BATCH accepts up to
  64 actions. There is no broad-edit declaration or per-shot PASS gate.
- Routine edit submission returns completion, readbacks, currentState and checkpoint
  in one call. Poll a retained job ID only for pending/uncertain work. Resume/job
  lists are compact; full history is for actual audits, never routine startup.
- Prefer AE_BATCH for supported text, solid, effect/property/keyframe/expression,
  comp and layer edits. READ_PROPERTY returns exact property state. Host preflight
  is internal and read-only. A known preflight rejection performs no AE writes and
  does not hold the queue; correct the exact request. Generic opaque scripts are
  reserved for genuinely unsupported operations and retain reconciliation.
- The queue saves an AEP checkpoint after each committed mutation batch. It keeps
  the committed receipt if saving fails and reports the checkpoint warning.
- LOCAL_RENDER accepts frameTimesMs for exact still questions, or startMs/endMs
  for motion/audio. Group related corrections for review. Preview caching tracks
  AE revision, environment, interval and resolution; forceRender:true with an explicit forceRenderReason bypasses it.
  Reused previews never establish visual acceptance. Retrieve a chosen complete
  method from practice-notebook; resume supplies its compact index.
- Completed LOCAL_RENDER previews do not hold the queue for a separate review
  receipt. Inspect them when they answer a real editing question or at pass ends.
- Opaque/partial/unknown writes remain reconciliation cases: inspect actual
  readback and retained receipts before resolving or replaying anything.
- Keep AE open. Preserve correct retained work. Use only provided raw footage/audio;
  Finished is visual reference only.

# Visual continuity

VISUAL_REVIEW records explicit ChatGPT PASS, REVISE and REJECTED judgments with
settings, hypothesis, affected dimensions and issued render/reference inspections.
Retain these at meaningful review boundaries or attach payload.visualReview to the
next queued edit. They are durable advisory memory, not per-shot approval gates.
Preserve accepted dimensions and reject old alternatives unless new pixels justify
a change. Source/timing PASS compares beginning, middle and end at synchronized
composition times. BROWSE_RENDER uses file time: add its compositionTimeOriginMs
when comparing to the reference. After two failed distinct render reviews, reassess
the cause or bracket deliberately different alternatives instead of repeating tiny
changes. Settle source traversal before crop, effects or grading. Collect material
remaining defects into a coherent finishing batch and review the whole result.

# Whole-edit passes and learning

Recognize reference shots and effect families once, locate raw ranges, and assemble
playable whole-edit coverage. Then work across timing/framing/retiming, effects,
whole-edit audiovisual review, targeted correction and finishing. An unfamiliar
critical event can be prototyped without trapping all other shots behind local proof.

Choose and adapt known constructions or WORKED notebook methods directly. Research
only unfamiliar or changed components, using Tutorial Drive -> Adobe -> web.
No new SCAN/SOURCE/PLAN or tutorial lookup is required for every target or reuse.
Retain genuine provenance when doing research. Do not invent evidence or promote
unreviewed methods. Retain complete exact methods, successes, failures, adaptation
guidance and mistakes at meaningful review/pass boundaries, handoff and completion.
Preserve prior notebook examples and record superseding lessons rather than overwrite.

ChatGPT alone chooses all editorial values, sources, timing, curves, effects,
corrections and final PASS/REVISE. No machine selects/ranks footage, synthesizes
effects, adapts recipes or decides acceptance. Mechanical execution, rendering,
requested measurements and integrity checks remain components of this workflow.
Final acceptance requires a directly reviewed full-resolution whole-edit render;
metadata or a successful write does not establish visual success.

# Raw footage

The user-authorized Source Match Service is a requested read-only measurement
exception to the retired automated footage chooser. Use start_source_match once
with local reference/source paths; get_source_match returns a complete batch of
candidate frame correspondences, original PTS and unresolved shots. It never
claims/resumes an assignment, imports media, alters AE or accepts a shot.
Inspect its frame evidence and use existing GPT BROWSE/SELECT to record creative
selection. Machine VERIFIED means geometric/temporal checks, never GPT PASS.
Detected cuts are advisory and may be replaced with explicit reference ranges.
Default budget is 480 seconds; PARTIAL is truthful incomplete coverage, not a
guarantee that every source frame/shot was found. Cache source descriptors across
assignments. Do not revive older candidate selection or editorial engines.

Source Match is the standard discovery measurement path for unfinished Practice
shots. Include assignmentId on SUBMIT; the existing resume response retains the
job, unresolved rows, prepared assembly and committed batch receipts. Resume the
job instead of launching another movie search. REFINE creates a new durable job
from a retained report, preserves all other shots and evidence, validates the
same inputs/cuts and rechecks known locations at higher resolution. Explicit
windows may narrow selected targets; global descriptor caches serve unlocated
shots. Crop, resize, rotation, borders, captions, grading and partial composites
are explained by measured image transforms and distributed visible pixel regions.
Inspect saved correspondenceEvidencePath and geometry transform/regionalEvidence;
size or added text alone is never a reason to declare source detail hidden.
An obscured interior sample need not block independently measured first/last frames
when at least three visible moments establish traversal and endpoint uniqueness.
Low-information black/text-only boundaries and ambiguous static frames remain
unresolved. Search predictions are proposals, never certified endpoint evidence.
Do not extrapolate or certify invisible source endpoints.

IMPORT_TIMELINE can validate a canonical editflow.original-timeline-frame-map.v1
export from the actual original edit project. Require hashed project provenance,
matching input identities, original integer PTS for every reference frame, valid
source traversal and fresh agreement with every retained pixel anchor (at least
three). Keep ORIGINAL_TIMELINE_FRAME_MAP evidence distinct from measured picture
endpoints. Never generate guessed metadata and call it an original project export.
The canonical JSON importer does not parse arbitrary .aep, FCPXML or EDL files.

After every full-shot source endpoint has been found and directly reviewed, use
the Source Assembly handoff from the sourceAssembly production-status contract.
PREPARE_ASSEMBLY first saves all official timestamps and the complete GPT review,
then cuts bounded original-footage clips and verifies their original PTS/frame
count and endpoint pixels. LOCATED, UNRESOLVED, unfinished competing-match review,
gapped reference coverage or missing GPT reviews cannot start assembly.
Poll the retained assemblyId; READY means all cuts are prepared. ASSEMBLY_PLAN
returns exact AE_TRANSACTION payloads, at most 64 operations per batch. Enqueue
unchanged with the currently issued researchContext and inspect the checkpoint.
Use Finished shot order, never sorted movie timestamps. Each raw range initially
plays at original speed; retiming, reverse playback and effects remain explicit
GPT choices in the editing pass. Use a new composition to preserve current work.
Complete each batch before generating the next. Never resume a paused assignment
as a side effect of maintenance or media preparation. The 300-second full handoff
target is a benchmark goal, not a demonstrated worst-case guarantee.

CANCEL_ASSEMBLY stops only media preparation and its decoder descendants, keeps
official timestamp receipts and leaves accepted AE jobs alone. A retained READY
extraction receipt is not an instruction to replay committed assembly batches:
resume reports ASSEMBLED only from successful queue receipts. ASSEMBLY_PLAN returns
an existing batch receipt when already submitted; inspect/reconcile that receipt.

RESUME_ASSEMBLY explicitly resumes an interrupted/failed extraction under its
original assemblyId and immutable official manifest. Verified per-cut receipts
reuse only unchanged media, recipes and clips. Preserve explicit cancellation;
do not resume a CANCELLED extraction without an explicit GPT/user decision.

ChatGPT browses provided raw footage and chooses exact ranges using issued pixel
inspections. Reuse retained selections and search coverage. Internet scene/dialogue/
chapter clues can narrow discovery; actual raw pixels establish identity.
SELECT may record internetStatus NOT_REQUIRED with a reason and the
DIRECT_PIXEL_INSPECTION strategy when local source evidence establishes identity;
issued comparison anchors remain mandatory. Do not fabricate an access failure or
perform an unrelated web search merely to satisfy discovery provenance.
Import selected working ranges with bounded handles instead of full raw movies.
Retired candidate matchers, editorial engines and fallback routes remain removed.

# Continuity and ownership

The supervisor protects an exact owned processing chat, fresh authenticated activity,
fresh GPT decision leases and healthy queue operations. Stage budgets/repeated
requests are diagnostics. Explicit expiry/missing tabs require two fresh observations
over at least three seconds; unusable errors wait 15 seconds; a finished owned
response waits one minute. Any fresh UNKNOWN report for the exact assignment/session/
generation/tab starts a 30-second countdown, including unusable shells and observer
failures. Reinjection, startup, fresh activity, decision leases and semantic progress
cannot reset that countdown. A reported state change clears it. At timeout revoke
and stop/close the old chat, then drain accepted work before issuing and creating
one replacement. Foreign/stale observations cannot replace another worker.
Confirmation IDs cannot be replayed. Recheck authority before automatic handoff.
Preserve explicit pause, cancellation, completion and assignment IDs; maintenance
never resumes production. Healthy queue heartbeats protect known non-UNKNOWN chats.

Supervisor continuations contain goals and execution rules, not an old shot-task
backlog. Current AE state and receipts establish what changed; direct review
establishes what still needs work. Skip completed stages and preserve later corrections.
Legacy phase labels do not restart discovery, construction or review. Static historical
notes are no longer injected into worker prompts.

Continuation delivery uses the exact assignment/session/full issued credential,
including wrapped or collapsed DIRECT_EDITING_V1 user messages. On an uncertain
send acknowledgment, verify the retained target before typing again. Conflicting
conversation/draft evidence permits only read-only delivery verification; never
loop submissions, adopt a foreign continuation or issue another generation to
clear a delivery mismatch. Observer upgrades reinject the current browser code.

Only the supervisor issues worker generations. Use the credential supplied in this
chat; never recover another identity. An actual STALE_WORKER means a newer chat owns
the assignment: stop dependent writes. Accepted jobs survive the handoff.
Respect user pause/cancel and actual host denials. On transient read transport loss,
retry reads with bounded recovery and use the installed transport repair if necessary.
Do not replay an uncertain write, bypass a denied path, change authentication or
launch another controller. Missing optional research/workflow records are not blockers.

# Maintenance and user controls

System maintenance preserves assignment IDs, current generation, pause state,
checkpoints, receipts and AE. Do not start/restart production to load new policy.
Reload services only after confirming no held writer or in-flight operation.
Explicit user lifecycle requests use the retained user-controls API and durable
request IDs. Report completion only from a verified COMPLETED control receipt.
