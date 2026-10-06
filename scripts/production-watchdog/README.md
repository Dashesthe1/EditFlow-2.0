# EditFlow Production Supervisor 3.3

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

Missing backend writes trigger inspection after one minute; silence alone never
revokes a chat. The actuator observes only the exact owned tab/current generation:
Stop/streaming controls prove PROCESSING; final-response controls after its own
continuation prove FINISHED. Absence of a Stop button alone is UNKNOWN. No prose,
conversation text, worker credential, network stream or editorial assessment is
sent to the supervisor. Unknown/stale/unrelated observations cannot authorize a
replacement. FINISHED or a missing owned tab must remain freshly confirmed for
one minute plus 120 seconds before handoff. Active chats can keep researching,
thinking, inspecting and editing without stage-budget, heartbeat-expiry or repeated-
request termination. Budgets and repeated requests are diagnostic warnings only.
Healthy queue heartbeats protect long operations beyond estimated wall-clock
budgets. Lost queue heartbeats require the full three-minute confirmation window
before reconciliation. Infrastructure failures trigger gateway/actuator repair;
uncertain writes and accepted receipts are retained and never blindly replayed.

Every continuation now verifies the tools actually callable in its chat through
get_mcp_surface(assignment_id, available_tools_json). A READY result proves required
tool coverage and read-only production/queue access; it does not prove write approval.
Workflow updates and research heartbeats use get_production_state /
record_production_update on MCP, retaining the current worker credential and the
same production coordinator. Missing tools or host-denied requests report
BLOCKED_CONNECTOR with the actual failing action/reason, preserve checkpoints/jobs,
and stop dependent writes; a denied request must not be repackaged through HTTP or
native scripts. Refresh the existing ChatGPT connection after MCP schema updates
and verify readiness in a fresh chat. No editing decisions move into the supervisor.

Transport health is separate from local gateway health. The supervisor performs
read-only initialize/tools-list probes on loopback MCP and the already-configured
protected public route every 15 seconds. It waits for both before ISSUE/CREATE/SEND,
repairs persistent failures with repair-transport.ps1, and retains assignments,
ownership, checkpoints and receipts during an outage. The repair script restarts
only the verified MCP process or restores the saved existing Funnel mapping; it
never stops AE/Chrome, changes credentials/authentication, claims a worker or
submits an editing operation. Stateless MCP transport avoids expired HTTP session
IDs across reconnects; production state remains in the durable backend.
Worker prompts retry only failed reads after 2/5/15 seconds, then use this bounded
transport repair and require real client READY again. Uncertain writes are
reconciled by receipt, never replayed. Missing domain materials are completed
through authorized research/proof/workflow tools under ChatGPT's judgment.
Host denial and revoked workers remain hard boundaries.

Handoff order: persist intent, revoke gateway authority, request Stop and close the
owned tab, drain accepted work, issue the next generation, create one fresh chat,
send the assignment-specific durable continuation. Retries resume the same step.
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
node --test scripts/production-watchdog/watchdog.test.js.

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
