# EditFlow Production Watchdog 2.5.2 / Supervisor 1.6.2

This browser controller resumes the existing nonterminal Practice assignment when a response has ended or a stall has been confirmed. It does not set a maximum chat duration. The browser cannot prove private model/backend state; it observes response events, visible assistant output, AE revisions and durable Practice evidence.

## Incident and correction

On 2026-10-01, a four-hour event-log sample contained 113 meaningful_progress_stall commands. Their average delay was 91,038 ms (range 90,008–91,999 ms). 101 commands occurred within five seconds of incoming stream traffic. Supervisor 1.5.0 ignored stream/processing activity in its 90-second useful-output timer. Extension 2.4.0 also had independent 30-second byte-silence and request-age cutoffs, classified helper streams as generations, and could open native fallback chats without confirming Stop.

Those independent replacement paths are removed. Only the supervisor can issue a per-generation, per-tab handoff permit.

## Monitoring policy

- Changes in structured response events or visible output protect ongoing processing. Keepalives and padding are excluded when the stream schema is recognized. Unrecognized traffic remains uncertainty rather than proof of a stall.
- Silence is eligible for suspicion after at least 1 minute, followed by two more minutes of confirmation. This is a tunable silence window, not a session duration limit. New processing evidence cancels suspicion. Version 2.5.2 sets the installed silence setting to 60 seconds as requested; the popup allows a minimum of 1 minute.
- Explicit failure is reconfirmed for 15 seconds while the response is idle; stale errors cannot override a live generation. Authentication and rate limits pause recovery instead of creating new chats.
- Missing observer heartbeats repair the extension only. They never authorize terminating a chat or opening native fallback chats.
- Live AE mutation/controller leases and manual Stop protect the session. Pause/Stop persist until the user starts monitoring again.
- Historical tabs and superseded network requests cannot alter the owning session's evidence.
- HTTP 200 or stream EOF alone is not completion. Completion needs a top-level generation-terminal event or a closed transport with a stable visible answer and idle UI.

## Handoff transaction

1. Prepare: re-read the active assignment, check cancellation/work leases, and save the complete orchestration checkpoint under chat-supervisor/handoffs/<permit>.checkpoint.json.
2. Stop: click the old conversation's Stop control when present. A disabled control still counts as active; a missing selector never implies success. Require at least 1.5 seconds of stable absence of Stop and positive idle composer controls, then 1.5 seconds with no active HTTP request or cloned generation stream. Already completed responses require the same positive idle and transport checks. Unknown UI or continuing streams block the handoff and pause monitoring.
3. Verify and commit: submit a structured Stop proof bound to the old URL, tab, generation and handoff permit. The supervisor issues a short-lived Stop receipt before a replacement tab may be created; a legacy `stopped: true` acknowledgement is insufficient. Recheck assignment/session identity, expiry, cancellation and leases before committing that receipt to one replacement tab.
4. Send: the continuation prompt names the existing assignment/session and preserves the original M6 workflow, raw-only media rule, connection preflight and open AE.

Failed handoffs pause with an actionable status. Native UI fallback no longer creates chats automatically. Three restarts in 15 minutes without task progress open a circuit; the controller pauses instead of repeatedly interrupting sessions.

## Validation and installation

Run node --test watchdog.test.js and node --check on the JavaScript files. Regression checks cover recorded short cutoffs, long reasoning, genuine silence, keepalives, protocol uncertainty, lost observers, tool leases, explicit failure, HTTP closure, historical tabs, cancellation, checkpoint-before-stop ordering, actual Stop clicks, disabled/ineffective/missing controls, temporary disappearance, still-running cloned streams, stale or wrong-conversation proofs, duplicate handoffs and restart storms. Tests use simulated clocks and browser/AE evidence; they do not deliberately stall or stop a live production ChatGPT generation.

The 2.5.1 correction closes a shortcut in 2.5.0: `forceStopGeneration` returned true immediately when no known Stop selector matched, and the handoff checked only HTTP requests. A protocol terminal from a second stream could also suppress the main stream's active status. The new gate checks every active stream, never silently supersedes an old stream when another starts, and no longer erases active-stream evidence because a different stream completed.

Run install.ps1 on Shadow to back up and install the files, restart only the chat supervisor and reload the unpacked extension. It leaves AE, the Practice service, the existing assignment and existing chat tabs open. Browser DOM and transport formats can change; the extension reports uncertain observation instead of assuming direct backend access. The browser must remain open and the computer awake.
