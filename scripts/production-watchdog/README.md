# EditFlow Production Watchdog 2.5.0 / Supervisor 1.6.0

This browser controller resumes the existing nonterminal Practice assignment when a response has ended or a stall has been confirmed. It does not set a maximum chat duration. The browser cannot prove private model/backend state; it observes response events, visible assistant output, AE revisions and durable Practice evidence.

## Incident and correction

On 2026-10-01, a four-hour event-log sample contained 113 meaningful_progress_stall commands. Their average delay was 91,038 ms (range 90,008–91,999 ms). 101 commands occurred within five seconds of incoming stream traffic. Supervisor 1.5.0 ignored stream/processing activity in its 90-second useful-output timer. Extension 2.4.0 also had independent 30-second byte-silence and request-age cutoffs, classified helper streams as generations, and could open native fallback chats without confirming Stop.

Those independent replacement paths are removed. Only the supervisor can issue a per-generation, per-tab handoff permit.

## Monitoring policy

- Changes in structured response events or visible output protect ongoing processing. Keepalives and padding are excluded when the stream schema is recognized. Unrecognized traffic remains uncertainty rather than proof of a stall.
- Silence is eligible for suspicion after at least 10 minutes, followed by two more minutes of confirmation. This is a tunable silence window, not a session duration limit. New processing evidence cancels suspicion.
- Explicit failure is reconfirmed for 15 seconds while the response is idle; stale errors cannot override a live generation. Authentication and rate limits pause recovery instead of creating new chats.
- Missing observer heartbeats repair the extension only. They never authorize terminating a chat or opening native fallback chats.
- Live AE mutation/controller leases and manual Stop protect the session. Pause/Stop persist until the user starts monitoring again.
- Historical tabs and superseded network requests cannot alter the owning session's evidence.
- HTTP 200 or stream EOF alone is not completion. Completion needs a top-level generation-terminal event or a closed transport with a stable visible answer and idle UI.

## Handoff transaction

1. Prepare: re-read the active assignment, check cancellation/work leases, and save the complete orchestration checkpoint under chat-supervisor/handoffs/<permit>.checkpoint.json.
2. Stop: the extension requires positive acknowledgement from the old page and quiescence of the old generation transport.
3. Commit: recheck assignment identity, generation identity, expiry, cancellation and leases; bind a single replacement tab to that permit.
4. Send: the continuation prompt names the existing assignment/session and preserves the original M6 workflow, raw-only media rule, connection preflight and open AE.

Failed handoffs pause with an actionable status. Native UI fallback no longer creates chats automatically. Three restarts in 15 minutes without task progress open a circuit; the controller pauses instead of repeatedly interrupting sessions.

## Validation and installation

Run node --test watchdog.test.js (25 regression checks) and node --check on the JavaScript files. The tests cover recorded short cutoffs, long reasoning, genuine silence, keepalives, protocol uncertainty, lost observers, tool leases, explicit failure, HTTP closure, historical tabs, cancellation, checkpoint-before-stop ordering, verified Stop, duplicate handoffs and restart storms. Tests use simulated clocks and browser/AE evidence; they do not run a real stalled ChatGPT generation.

Run install.ps1 on Shadow to back up and install the files, restart only the chat supervisor and reload the unpacked extension. It leaves AE, the Practice service, the existing assignment and existing chat tabs open. Browser DOM and transport formats can change; the extension reports uncertain observation instead of assuming direct backend access. The browser must remain open and the computer awake.
