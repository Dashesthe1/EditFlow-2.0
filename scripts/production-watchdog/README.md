# EditFlow Production Watchdog 2.6.4 / Supervisor 1.7.4

The controller monitors the owning live Practice chat and resumes the same durable assignment between conversations. There is no maximum chat duration. It stays armed through observation, Stop verification, checkpoint handoff, continuation sending and recovery until the durable assignment is COMPLETED or explicitly cancelled. Explicit user Pause/Stop remains available.

## October 1 correction

The 19:31 incident displayed "Stream cache expired" and idle composer controls while the backend was still renewing its controller reservation and generating editing artifacts. Idle-answer handoffs raced those renewals and Stop confirmation was rejected. Reloading that same owning page restored the live Stop control and current response. Version 2.6.4 confirms the rendered error for 15 seconds, then permits one validated reload of that response when there is no live transport, Stop control, recent work, manual Stop or AE mutation lease. A controller reservation remains a barrier to replacement but cannot block this observation repair. Failed reloads retry without pausing. Successful reloads are persisted and bounded per assignment/conversation/response; fresh activity or scope changes revoke queued repairs. Completion also checks for newer recent editing progress before handing off.

Error observation excludes hidden conversations and message prose while allowing an error banner inside an author-role wrapper. Supervisor health exposes the current failure signal and page recovery record. The popup distinguishes a controller reservation from response processing.

Work Mode keeps multiple conversations mounted and uses user-message bubbles, assistant markdown and agent-activity blocks rather than the classic author-role attributes. Version 2.6.4 observes only rendered messages in the current conversation, includes tool activity in its progress fingerprint, excludes clock-only Working timers and requires the latest user request to explicitly start, continue or resume Practice. A maintenance chat cannot receive a Stop permit. This scope is rechecked immediately before Stop; changing conversations clears the previous transport state.

The stream probe stamps each request with the conversation where it began. Late headers, bytes and errors from a previous conversation cannot recreate active transport in the current one. This upgrade retires legacy unscoped records that survived earlier extension reloads and blocked replacement creation; subsequent worker restarts preserve properly scoped active records. Health reports the current transport counts alongside positive idle UI evidence.

The 22:09 failure used generation and semantic evidence from an older response while the owning chat was receiving fresh stream bytes. Stop verification then failed and background.js permanently changed monitorState to paused. Version 2.6.4 fixes both defects.

- A new response, stream or owning page response identity clears prior generation completion, errors, semantic coverage and stall suspicion. The page identity reconciles starts missed when the observer attaches mid-response.
- Coverage is calculated from the currently active streams. Unsupported frames explicitly mark uncertainty; observed traffic then protects the response. Recognized keepalives and padding do not count as progress.
- One minute of actual silence starts suspicion; two additional minutes of silence confirm it. Any new useful or uncertain activity restarts the full confirmation window, including activity received between throttled samples. Extended-thinking UI and active AE/controller leases protect ongoing work.
- Historical tabs and superseded stream terminal events cannot change the owning response. A semantic terminal never silently closes a still-active cloned transport.
- Recovery errors never automatically pause monitoring. Stop failures retry with backoff; a no-progress restart circuit applies a temporary delay and automatically resumes.
- Durable Practice state, bound to the existing assignment, is authoritative for completion. A response ending, an assistant completion marker, or a FAILED assignment does not declare the edit complete.

## Handoff and restart recovery

1. Re-read assignment identity, cancellation and work leases; write the orchestration checkpoint before Stop.
2. Revalidate the permit before clicking the official Stop control. Newly resumed progress revokes a stall permit before Stop. A click under a valid permit is recorded separately so cancellation-caused EOF is not mistaken for resumed work.
3. Confirm positive idle UI and closure of all tracked generation transports for at least 1.5 seconds each. Work Mode empty-composer Voice controls provide positive idle evidence; the composer body scopes those controls. Missing, disabled or ineffective Stop controls do not authorize a replacement. Unknown observation keeps recovery running.
4. Record Stop proof and commit ownership to one fresh tab. Persist its continuation prompt and target tab. Verify that Send was accepted; retry a failed send in the same tab and reconcile the existing user prompt before retrying, avoiding duplicate submissions.
5. Preserve the committed handoff through supervisor/extension restarts, including the commit-before-browser-storage interval. A genuinely removed owning tab is checkpointed and verified as closed before creating its replacement. Observer loss repairs observation without authorizing termination of a live chat.

Continuation prompts preserve the assignment/session, original M6 workflow, connection preflight, raw-only footage/audio policy and open AE. Account/login or rate-limit blocks remain observed while availability is checked; creating more chats would not fix them.

## Validation and installation

Run node --test watchdog.test.js and node --check on each JavaScript file. Tests use simulated clocks and browser/AE evidence, including the recorded 22:09 incident, long active responses, genuine silence, confirmation reset, stale coverage, historical tabs, active transports, official Stop clicks, progress-before-Stop cancellation, Stop-caused EOF, failed handoff/send recovery, duplicate suppression, closure recovery and authoritative completion. No healthy production response is deliberately stopped to run these tests.

Run install.ps1 on Shadow. It backs up the installed controller, installs the validated files, restarts only the chat supervisor and reloads the unpacked extension. The current legacy automatic pause is migrated back to running when a recorded handoff failure and an active armed assignment corroborate it. Explicit user pauses have their own provenance and remain intact. The assignment, Practice service and AE are preserved.

Extension recovery verifies a new extension-loaded event; when Chrome InvokePattern reports success without reloading, it clicks the observed extension-details Reload control and verifies the event before reporting success.
