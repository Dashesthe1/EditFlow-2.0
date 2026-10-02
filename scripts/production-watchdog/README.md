# EditFlow Production Supervisor 3.0

Practice and Pro Creation share one local supervisor and one gateway worker authority.
The supervisor starts at Windows sign-in and arms automatically when the gateway
finds an unfinished assignment. No paid API or model service is used.

The gateway persists a monotonic generation and private worker credential. All
assignment POSTs (including claim, research, queue, review, checkpoints, learning
and completion) require that credential. Public responses redact it. The gateway
serializes admission against revocation so an old request cannot cross a handoff.
Use the issued credential as claimedBy/researchContext.claimedBy, or send the
X-EditFlow-Worker-Credential header. A stale worker must stop, never reclaim.

Health decisions use authorized operations, durable queue statuses and heartbeats,
checkpoint/phase/score movement and repeated operation signatures. Browser pixels,
DOM activity, errors, thinking indicators and ChatGPT network payloads are not
health evidence. Silence has a 60-second grace and 120-second confirmation; first
worker startup has 180 seconds. Healthy accepted jobs are protected up to explicit
operation deadlines. Infrastructure failures trigger local gateway/actuator repair.
Ambiguous operations are retained for reconciliation; they are never replayed.

Handoff order: persist intent, revoke gateway authority, request Stop and close the
owned tab, drain accepted work, issue the next generation, create one fresh chat,
send the assignment-specific durable continuation. Retries resume the same step.
A manual pause persists, freezes new/pending work and retains the checkpoint.
Resume reuses the same assignment. Completion/cancellation disarms production;
the supervisor/guardian processes stay running.

The browser extension is only an actuator. Its permissions no longer include
webRequest and it contains no ChatGPT stream parser. It reads only its own submitted
prompt to verify send acceptance and browser controls to execute Stop/Send.
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
