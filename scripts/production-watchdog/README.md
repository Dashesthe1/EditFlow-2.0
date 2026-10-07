# EditFlow Production Supervisor 3.5

Practice and Pro Creation share one local supervisor and one gateway worker authority.
The supervisor starts at Windows sign-in and arms automatically when the gateway
finds an unfinished assignment. No paid API or model service is used.

The gateway persists a monotonic generation and private worker credential. All
assignment POSTs (including claim, research, queue, review, checkpoints, learning
and completion) require that credential. Public responses redact it. The gateway
serializes admission against revocation so an old request cannot cross a handoff.
Use the issued credential as claimedBy/researchContext.claimedBy, or send the
X-EditFlow-Worker-Credential header. A stale worker must stop, never reclaim.

After an initial accepted claim, every assignment POST from the current armed
worker renews its existing controller lease before dispatch, under the same lock
that serializes revocation. This includes research/decision HEARTBEATs and works
after the two-minute timestamp expires while that generation remains authorized.
Missing claims, other owners, revoked generations and paused authority never
renew. Claiming a new generation remains explicit. Backend HTTP status/reason and
payload validation errors pass through MCP as expected tool failures with worker
credentials redacted; they must not be mistaken for host permission denials.

Liveness uses four renewable signals: owned browser processing, authenticated
EditFlow activity (10 seconds), GPT decision/research heartbeat (180 seconds),
and healthy accepted queue operations (180-second heartbeat grace). A valid
signal protects the worker. Quiet stages and repeated requests remain diagnostics.
No token estimate, stage budget or absence of tool calls authorizes cancellation.

The actuator checks only the exact assignment/session/generation and owned tab.
Each poll has a one-use observation ID; replayed ACKs, cached supervisor ticks,
wrong sessions and stale observations cannot count toward confirmation. Stop,
streaming or current-turn busy controls establish PROCESSING. Expiry requires a
semantic error surface plus expiry/length-limit wording and either an unusable
composer or recovery action. Ordinary messages and historical errors are excluded.
Unusable errors require an unusable composer and a recovery action. Collapsed
identity requires a verified send receipt bound to the same conversation URL.

| Owned browser evidence, with no valid work lease | Decision |
| --- | --- |
| EXPIRED or MISSING | At least two fresh observations spanning 3 seconds |
| UNUSABLE | At least two fresh observations spanning 15 seconds |
| FINISHED | At least two fresh observations spanning 60 seconds |
| UNKNOWN, usable recognized shell and positively idle | Reinject observer, then at least three observations spanning 60 seconds |
| Unavailable observer, unrecognized shell, missing ownership or stale data | Repair/reobserve; no revocation from missing evidence |

These are confirmation times, not guaranteed end-to-end replacement times. Fresh
activity or an accepted job can defer handoff. The supervisor rechecks gateway
state immediately before revocation. Handoff remains durable revoke -> stop/close
-> drain -> issue -> create -> send, with the same assignment and accepted receipts.
Observer recovery is separate from queue/gateway interruption; failed page probes
have a two-second timeout so they cannot wedge the actuator. Read-only observation
continues while paused; a pause never authorizes automatic handoff. Service restarts
clear confirmation samples and acquire new evidence.

A working DOM observer can confirm an idle unknown chat. An unreadable/frozen
observer cannot prove that hidden reasoning stopped, and an unchanged Stop control
cannot distinguish healthy thinking from a stuck backend. Those cases remain
observer recovery/processing until positive evidence becomes available. This is a
browser-supervision limitation, not an exact ChatGPT token or backend health API.

Healthy queue heartbeats protect long operations beyond wall-clock budgets. Lost
queue heartbeats require three minutes before reconciliation. Infrastructure failures
trigger repair; uncertain writes and accepted receipts are never blindly replayed.
No conversation prose or credentials leave the observer; only booleans, reason codes,
identity fields and the owned conversation URL are retained.

Every continuation uses DIRECT_EDITING_V1 through EditFlow - Current Shadow:
claim_gpt_assignment once -> inspect retained work -> ChatGPT decides -> enqueue
exact AE_BATCH/AE_TRANSACTION -> inspect receipts/output -> correct. The claim
returns the assignment, production state/jobs, AE state, notebook, selections and
checkpoint. There is no worker tool inventory, separate preflight, ownership reread,
mandatory research heartbeat, research/workflow approval or per-shot PASS gate.
Current-worker writes validate ownership and renew claims inside admission.
ChatGPT works across whole-edit passes and chooses all editorial values. Research
is only for unfamiliar/changed methods; retained WORKED methods can be adapted
directly. Previews are non-blocking. Final completion requires direct audiovisual
review of the full-resolution final render and the completion receipt.
Browsing, research and progress reports do not end an unfinished editing turn.
Actual missing tools/host denials preserve pending jobs and checkpoints; denied
requests must not be repackaged through HTTP or native scripts.

Transport health is separate from local gateway health. The supervisor performs
read-only initialize/tools-list probes on loopback MCP and the already-configured
protected public route every 15 seconds. It waits for both before ISSUE/CREATE/SEND,
repairs persistent failures with repair-transport.ps1, and retains assignments,
ownership, checkpoints and receipts during an outage. The repair script restarts
only the verified MCP process or restores the saved existing Funnel mapping. For
network failures with healthy loopback MCP it tries socket/relay reconnects, then
refreshes only the verified saved public path and network map. The path is restored
in finally and the complete Serve configuration is checked for changes. It
never stops AE/Chrome, changes credentials/authentication, claims a worker or
submits an editing operation. Stateless MCP transport avoids expired HTTP session
IDs across reconnects; production state remains in the durable backend.
Only one repair process runs at a time, with a four-minute deadline and a cooldown.
Every repair completion logs sanitized process status and fresh MCP readback;
a successful process exit or local.ready alone cannot establish public readiness.
Worker prompts retry only failed reads after 2/5/15 seconds, then use this bounded
transport repair and resume the same assignment without a new preflight. Uncertain writes are
reconciled by receipt, never replayed. Missing editing knowledge is researched under ChatGPT's judgment.
Host denial and revoked workers remain hard boundaries.

Supervisor prompts give the current goal, identity and execution contract; they
contain no static shot-specific task backlog. The retired continuation-notes reader
is removed. Installation backs up old notes and removes the active injection files.
The one-call resume supplies current AE state, receipts, selections and notebook;
ChatGPT uses that evidence plus direct review to decide the next useful work. Later
corrections are preserved. Legacy phase labels cannot force discovery/construction
or review to repeat. A successful write is not proof of visual acceptance, and a
suitable current reviewed render can be reused without another routine render.
An already delivered chat prompt is immutable; changes apply to future handoffs
without replacing or restarting a worker for maintenance.

Handoff order: persist intent, revoke gateway authority, request Stop and close the
owned tab, drain accepted work, issue the next generation, create one fresh chat,
send the assignment-specific durable continuation. Retries resume the same step.
Send acceptance recognizes wrapped/collapsed DIRECT_EDITING_V1 continuations by
the exact assignment, session and full issued credential. A later competing
continuation cannot inherit that receipt. Extension reloads reinject the current
observer version into existing tabs. A conflicting conversation or unrelated
composer draft stops SEND retries and permits only read-only delivery verification;
it never replaces a chat or worker merely to clear the conflict. A matching receipt
automatically finishes the retained handoff without typing or issuing a generation.
Once verified, the exact tab/generation receipt keeps ownership bound even when
ChatGPT hides every prompt identity field. Visible competing continuations still
invalidate the observation, and current processing/final controls remain required.
A manual pause persists, freezes new/pending work and retains the checkpoint.
Resume reuses the same assignment. Cancellation is completed by the supervisor
after fencing, closing the owned chat and draining work, including when paused;
it no longer depends on an already-revoked worker acknowledgment.
Completion/cancellation disarms production;
the supervisor/guardian processes stay running.

The browser extension performs mechanical observation and Stop/Send actions. Its
permissions exclude webRequest and it contains no ChatGPT stream parser. It reads
its own submitted prompt to verify acceptance/current generation and browser
controls to report turn processing/completion. It makes no editing decision.
The public /health endpoint reports state without credentials. The gateway private
supervision route requires a separate local supervisor key; the actuator route is
restricted to the installed extension origin.

This guarantees one authorized EditFlow worker, not authoritative cancellation of
OpenAI backend generation. It is a trusted-local-PC system: arbitrary code with the
same Windows account can access its files. Workers must not bypass the gateway
through Desktop Commander or native AE scripts.

Install from this directory with install.ps1 after compiling the TypeScript gateway.
Tests: npm run build:test-runtime; node --test tests/production-supervision.test.mjs;
node --test scripts/production-watchdog/*.test.js.
The watchdog suite uses simulated time for 10-minute thinking/web work and a
30-minute render. The HTTP integration suite starts the real supervisor against an
isolated gateway and exercises restart during close/create, one-use observations,
observer recovery and work arriving at handoff. A real ChatGPT expiration acceptance
test still requires an actual expired owned chat; fixtures do not establish it.

Explicit user choices are available from any connected chat through the existing
`resume_or_start_practice(start_json)` tool, or authenticated
`POST /v1/product/production/user-controls`. Only act on an explicit user request.
Send `userRequested:true` and a stable `requestId` (reuse it after a timeout).

| action | required fields | effect |
| --- | --- | --- |
| START_PRACTICE | input: editTypeId, finishPath, videoPaths, audioPaths, optional practiceRole | New assignment using chosen media |
| RESTART_PRACTICE | expectedAssignmentId | Fresh assignment with the same inputs and Edit Type |
| REPLACE_CHAT | expectedAssignmentId | Fresh authorized chat, retained assignment/checkpoints |
| CANCEL | expectedAssignmentId | Safe stop, no replacement |
| RETRY | requestId | Retry a blocked intent without creating another request |
| STATUS | requestId; no userRequested flag needed | Read its durable receipt |

Example restart JSON: `{"action":"RESTART_PRACTICE","userRequested":true,"requestId":"restart-microwave-20261002","expectedAssignmentId":"gpt-assignment:..."}`.
Poll with `{"action":"STATUS","requestId":"restart-microwave-20261002"}`.
Receipts persist across both gateway and supervisor restarts. COMPLETED requires
the stopped/drained old worker, fresh IDs for restart, browser send acceptance and
a successful authorized claim by the target generation. A sent prompt alone is
PENDING. Missing connections report BLOCKED with the reason and permit explicit
RETRY. Old assignments and artifacts are retained; nothing closes AE or deletes
source media. The extension popup also offers Restart Practice from scratch,
Replace editing chat, receipt status and Retry blocked action.


### Version 3.6 continuity

The continuation prompt uses retained visual decisions and suitable cached renders.
It asks for coherent finishing batches and synchronized temporal comparisons.
Supervisor health exposes continuityMetrics with observed activity buckets and
unobserved gaps; these are diagnostics, not a reason to revoke a worker.
Installation copies and verifies continuity-metrics.js and repair-production.ps1
alongside the controller scripts. Runtime deployment must preserve state.json and
production-state.json and must not create a worker merely to load policy.
