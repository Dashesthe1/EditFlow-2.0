# Edit production authority

Practice and Pro Creation use `CHATGPT_PRODUCTION_WORKFLOW_V1` as their sole
primary workflow, executed exclusively through `DURABLE_PRODUCTION_QUEUE_V1`.

- Run connection preflight, resume the retained active assignment, claim its controller,
  and read current research plans and actual AE state before production work.
- Submit every AE edit to `POST /v1/product/gpt/assignments/{id}/production-jobs`.
  Goals, batches, transactions, corrections, baseline assembly, renders, checkpoints,
  scratch searches and native proof scripts are operations inside that worker.
- Use `GET .../production-jobs?jobId={jobId}` to resume a submitted operation. Preserve
  its receipt on timeout. Reconcile interrupted/failed writes from actual state and
  retained evidence; never replay them blindly or switch to an older endpoint.
- Direct mutation URLs and compatibility aliases are removed. A `410` response is
  final for that route. Do not restart an old service or launch a parallel controller.
- The worker owns the single AE writer, scheduling, checkpoints and execution.
  GPT supplies creative judgment and strategy changes inside that system.
- Native capability adapters, exact property writes, media preparation and rendering
  execute ChatGPT plans. Retired creative engines and their launchers are deleted.
- ChatGPT directly reviews the actual final render and decides PASS/REVISE. Retained
  historical certification data is read-only context, never an executable gate. Pro Creation
  uses its designed target and all relevant retained preset examples.
- Tutorial Drive, Adobe resources, then external sources is the research order.
  Use provided raw footage/audio; keep AE open and preserve correct retained work.
- Native adapter tests verify explicit operation execution and safety only.
  Deleted matcher/synthesis/certification labs must never be restored as fallbacks.

# Connector readiness before editing

On each new chat or changed connection, enumerate tools actually callable in that
chat. Call get_mcp_surface with the retained assignment_id and available_tools_json
containing those tool names; require connectorPreflight.status READY before
claiming, extended research or editing. Server-advertised names alone are not proof.
Resume get_production_state and get_production_jobs without resetting checkpoints.
Use record_production_update for workflow, checkpoint, telemetry and HEARTBEAT
writes with this chat's issued worker credential as claimedBy; use the three
production-job tools for AE submissions, retained receipts and reconciliation.
No credential is recovered from coordinator or supervision files.
READY checks tool coverage and production/queue reads, not host approval of writes.
After the initial accepted claim, the gateway renews the existing controller lease
on authenticated current-worker writes (including HEARTBEAT), inside its generation
admission/revoke lock. It does not acquire a missing claim, replace another owner,
or revive revoked/paused authority. Keep research/decision heartbeat discipline.
Backend failures retain their HTTP status and reason in MCP tool errors; report
them exactly. CONTROLLER_LEASE_INVALID is an ownership failure, while backend
validation failures concern the request/domain. A generic tool wrapper alone does
not prove a host rejection.
A host rejection is BLOCKED_CONNECTOR, distinct from a gateway STALE_WORKER.
Report its exact action/reason and retain assignment/jobs/checkpoints; stop dependent
writes. Never repackage a denied action, hide credentials, change permissions,
disable authentication or switch to native scripts. HTTP fallback requires its own
availability and approval; it cannot be used to retry a host-denied request.
Transient UNAVAILABLE/connection timeouts on reads require bounded recovery, not
an immediate permanent stop: retry the read after 2, 5 and 15 seconds. If necessary,
run the installed repair-transport.ps1 through Desktop Commander with this
assignment ID, then rerun read-only preflight and require READY for the same current
generation. This repairs only the known MCP process/existing protected tunnel;
it cannot claim, alter AE/coordinator/supervision or bypass auth/approval.
The supervisor checks local and public MCP initialize/tools-list before chat launch
and repairs failed transport without resetting the assignment or replaying jobs.
Never retry an uncertain write blindly; first reconcile its durable state/receipt.
For backend prerequisite/validation failures, inspect the returned contract and
complete missing scans, tutorial research, plans, issued proof or required fields
through authorized tools. ChatGPT decides the corrected submission; no invented
evidence or automatic editorial fallback is allowed. STALE_WORKER and host denial
still stop dependent writes.

After MCP metadata/schema changes, refresh the existing ChatGPT connection and
verify this readiness check in a fresh chat before production resumes.

# Raw footage selection authority

ChatGPT alone browses the provided raw footage and selects exact scene/shot ranges.
`CHATGPT_DIRECT` is the sole available footage-selection method for Practice chats,
not a preference that can fall back to another method or be overridden by a request.
Use the assignment's `footage-selection` contract and BROWSE / NOTE / SELECT actions.
The production raw-shot candidate generator, visual matcher and ranking are retired.
Do not run their scripts, consume their cached choices, or present ranked raw shots.
For footage discovery primarily research internet scene/dialogue/script/chapter clues,
then inspect GPT-chosen chronological/time-range contact sheets and exact raw frames.
Internet results narrow searches; actual provided raw pixels establish source identity.
Retain search coverage notes, issued pixel receipts, comparisons, ranges and rationale.
Effect/transition method research still uses Tutorial Drive, Adobe, then external sources.
No isolated legacy selector or creative-engine fallback remains in this repository.

# Production chat continuity

The supervisor verifies silence after one minute, but missing backend writes,
expired decision heartbeats, stage budgets and repeated request counts never
justify revoking a chat that is still processing. These are diagnostics only.
The browser actuator reports state from the exact owned tab/current generation;
it sends no conversation text or worker credential. PROCESSING protects the chat;
UNKNOWN/stale/unrelated observations cannot authorize replacement. FINISHED needs
actual final-response controls, not just absence of a Stop button. FINISHED or a
missing owned tab must remain confirmed for the one-minute plus two-minute window
before the supervisor revokes, explicitly stops/closes, drains and continues the
same assignment. A healthy queue heartbeat protects long jobs beyond estimated
wall-clock budgets. Lost queue heartbeats require the full confirmation window
before infrastructure reconciliation. User pause/cancel and single-writer authority
remain effective. Complete recoverable requirements through authorized tools;
never end merely because material remains to be researched or validated.

# Production chat ownership

The local Production Supervisor arms automatically for Practice and Pro Creation.
Use only the private worker credential supplied in its continuation prompt as
`claimedBy`, `researchContext.claimedBy`, or `X-EditFlow-Worker-Credential` on every
assignment write. Copy the exact assignment ID from the continuation prompt and
verify retained assignment identity before every write. The gateway rejects missing,
retired and paused workers with STALE_WORKER. A valid current worker with a wrong ID
receives HTTP 400 ASSIGNMENT_ID_MISMATCH before dispatch, controller renewal or
progress recording. Read the correct retained assignment and current generation;
ChatGPT may correct that rejected request with the same still-authorized credential.
Never reinterpret an actual STALE_WORKER response as a typo.
A `STALE_WORKER` response means stop immediately. Do not claim another identity,
read supervision keys, pause/reconfigure the supervisor, run native AE scripts or
use Desktop Commander to bypass the production queue. Only the supervisor may
revoke/issue worker generations. Resume existing receipts; accepted jobs belong
to the durable queue and can finish across a chat handoff. Only isolated automated
acceptance tests may set `productionSupervision: false`.

# Explicit user lifecycle controls

Any ordinary connected chat may fulfill an explicit user request to start Practice,
restart Practice from scratch, replace the editing chat, or cancel production.
These are user controls, not worker/AE writes: use `resume_or_start_practice` with
`start_json` containing `action`, `userRequested:true`, and one stable `requestId`.
Read the returned `userControls.contract` for the full schema or use authenticated
`POST /v1/product/production/user-controls`; no worker credential or supervisor key
is needed. Restart/replace/cancel require the expected current assignment ID.
`RESTART_PRACTICE` makes a fresh assignment using the selected assignment's raw
video, raw audio, Finish reference and Edit Type. `REPLACE_CHAT` keeps its assignment
and checkpoints. `START_PRACTICE` takes chosen inputs under `input`.
Poll `action:STATUS` using that request ID. Report COMPLETED only when the durable
receipt says COMPLETED and includes verified target IDs/generation; QUEUED,
LAUNCHING and prompt delivery are PENDING. Report BLOCKED/FAILED with the reason.
Never autonomously invent a restart, replacement or cancellation request. Workers
must still stop immediately on STALE_WORKER; these user controls do not authorize
AE edits, controller claims, credential recovery or native-script bypasses.


# All editorial decisions and Practice memory

`CHATGPT_DIRECT_EDITORIAL_AUTHORITY_V1` is the exclusive production policy.
ChatGPT chooses all reference cuts/duration, audio, timing, framing, effects,
transitions, exact keyframes/constructions, corrections and final acceptance.
Require an immutable editorialDecision on every queue job. Do not invoke formula
pulses, automatic baseline/effect synthesis, automatic correction, candidate
ranking/pruning, local-Qwen decision drivers or machine final-certification paths.
Native measurement/tracking/roto may execute only GPT-chosen targets, methods and
settings, with no automatic fallback and with direct review of the output.
Mechanical rendering, explicit-plan execution, metadata and integrity checks remain.
Read the selected preset's existing `gptLearning` notebook on start and resume.
Integrate workedExamples into that record; retain previous lessons and skills.
Save ordered actions/settings/reasons/checks, observed successes and failures,
adaptation guidance, mistakes and issued render/job evidence after reviewed attempts,
before handoff and completion. Preserve prior examples; supersede with a new entry.
Never automatically select/apply a saved technique or claim universal proficiency.

# Six-study production workflow

`CHATGPT_PRODUCTION_WORKFLOW_V1` is mandatory for both Practice and Pro Creation.
The existing coordinator, queue, native adapters, source preparation and notebook
are components of this workflow. No older workflow, selector or fallback remains.
Every new production job must include workflowContext with workflowId equal to
CHATGPT_PRODUCTION_WORKFLOW_V1 and the active retained planDecisionId, planHash and
eventIds. Before source selection is complete, REFERENCE_ANALYSIS alone can use
phase PREPARATION with this same workflowId. Preparation does not authorize AE edits.
Pre-rollout accepted receipts can finish unchanged; they cannot admit new legacy work.
Read the production workflow contract, current workflow decisions, prepared raw
selections, research plans and receipts on resume. ChatGPT chooses pass order,
bounded source shortlist, action/music anchors, every method/settings/curve,
scope-specific finishing, review dimensions and next action. No machine may
select, rank, prune, adapt or apply an editorial method, or decide acceptance.
Record explicit WORKFLOW_PLAN and WORKFLOW_REVIEW state in the current coordinator.
Retain complete methods in existing workedExamples, including source/parent/effect
identities, fps/time origins, full curves, stack order and dependency bindings.
For reuse choose a current WORKED example explicitly; record all rebinding and
the exact adapted method. Retain FAILED/UNVERIFIED context without promotion.
Reuse retained tutorial evidence with a new per-target plan and applicability
checks; Tutorial Drive -> Adobe -> web remains the research order.
Use local audiovisual previews for local defects, focused full-resolution checks
for temporal/edge/matte issues, and a full-resolution whole-edit final review.
Low-resolution previews use isolated copies and cannot certify the final edit.
Separate active work, machine waits and idle; record preparation/learning,
production/review/export/recovery, milestones and full elapsed time. Unknown gaps
remain unattributed. The 60-minute familiar two-shot benchmark is an unmeasured
engineering target and must never force a PASS or narrow creative possibilities.
Bundled tutorial candidates remain UNVERIFIED until locally constructed and
reviewed by ChatGPT. Keep AE open and preserve the supervisor's current state during
system maintenance; do not resume/restart production merely to load new policy.
