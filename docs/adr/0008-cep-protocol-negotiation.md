# ADR 0008 — CEP protocol negotiation across milestone tranches

## Status

Accepted for M3 implementation.

## Context

M2 established an authenticated loopback CEP broker and panel transport using protocol `1.1.0`. M3 introduces mask/Bezier commands using protocol `1.2.0`. Replacing the entire session with a fixed 1.2 protocol would either break the accepted M2 path or imply that M2 proof maturity transferred to M3. Keeping the panel fixed at 1.1 makes the new host commands permanently unroutable.

The transport therefore needs to carry commands from more than one typed protocol tranche at the same time while preserving strict correlation, authentication, fixed host dispatch, and truthful evidence boundaries.

## Decision

The CEP panel advertises an ordered `supportedProtocolVersions` set during authenticated registration. The broker owns the supported set and returns the highest mutually supported version as the session's negotiated `protocolVersion`.

The negotiated version describes the highest common session capability; it does not rewrite individual messages. Every request retains its own protocol version (`1.1.0` for accepted M2 commands, `1.2.0` for M3 mask commands), and every host response must exactly match the leased request protocol and correlation fields.

The broker:

- supports only explicitly compiled protocol versions;
- rejects registration when there is no mutual protocol;
- records the panel's mutually supported set in the session;
- refuses immediate dispatch when a connected panel did not advertise the request protocol;
- never leases a queued request to a session that did not advertise that protocol;
- rejects responses whose protocol was not negotiated for that session;
- continues to accept the legacy single `protocolVersion: "1.1.0"` registration shape for the accepted M2 panel path.

The panel:

- advertises `1.2.0` and `1.1.0` in priority order;
- validates that the broker's selected version was advertised;
- validates host responses against the individual request protocol rather than a hard-coded session version;
- keeps the legacy single-version configuration field at `1.1.0` as a safe fallback signal.

## Alternatives considered

### Replace protocol 1.1 with 1.2 globally

Rejected. It would blur proof lineage and needlessly invalidate the accepted M2 message contract.

### Run separate broker ports or separate CEP panels per protocol

Rejected for now. It duplicates authentication, liveness, install, and session recovery complexity without adding a stronger safety boundary than per-request protocol correlation.

### Allow any host response version once a 1.2 session is negotiated

Rejected. Negotiation is not permission to change a request's schema in flight. Exact request/response protocol correlation remains mandatory.

## Consequences

M2 `1.1.0` and M3 `1.2.0` commands can share one authenticated panel session. A legacy 1.1-only panel remains able to execute M2 but receives a deterministic protocol-unavailable failure for M3. Future protocol tranches can join the supported set explicitly without silently widening host execution.

The session status must not be interpreted as proof maturity. Capability registry maturity remains evidence-scoped.

## Human-parity impact

This removes the transport blocker for typed mask/Bezier operations, enabling the first literal object-driven M3 construction path without weakening M2 semantics or substituting a lower-fidelity fallback.

## Safety / rollback impact

Authentication, loopback-only binding, fixed dispatcher execution, request correlation, project-revision checks, and AE undo behavior are unchanged. Protocol negotiation adds a narrowing gate: unsupported protocol traffic is rejected before host mutation.

## Proof impact

Transport availability may change the M3 route from unavailable to available, but mask capabilities remain `PARTIAL` + `DECLARED` until real-AE P1/P2/P3/P4/P5 evidence is produced. M2 accepted evidence remains scoped to protocol 1.1 capabilities.
