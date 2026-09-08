# M3 temporal-ease protocol 1.8 — accepted P1/P2 real-AE evidence

Accepted on September 7, 2026 (America/Toronto) from the production-equivalent self-hosted After Effects workflow.

## Provenance

- Feature source commit: `718fd72dd9b07c3605163354cf7ce7be26ef8f23`
- Acceptance control commit: `033e4e2f005a175f48fefaca1912dc54716d7eb4`
- Workflow run: `34176061647`
- Job: `101905568438`
- Retained artifact: `10037290595` (`m3-temporal-ease-p1-p2-proof-34176061647`)
- GitHub artifact SHA-256: `b1046dfe32b1b1c73a3acd65e5d5b3deb90fef50e01170ed3b8e8e04d4e2439b`
- Host: Adobe After Effects `25.6.6x4`, build `4`, Windows 64-bit
- CEP extension: `com.editflow2.bridge.panel` version `0.1.0-dev.8`
- Negotiated protocol: `1.8.0`, with `1.7.0` and `1.1.0` compatibility in the proof broker

## Acceptance result

The retained `result.json` reports:

- `status: PASS`
- `ok: true`
- `P1_validation_rejection: true`
- `P2_structural_readback: true`
- `P3_visual_proof: false`
- `P4_failure_injection_rollback: false`
- `P5_save_reopen_reconnect_transfer: false`
- all 44 bounded checks `true`
- `cleanupComplete: true`
- `failureError: null`
- final project fingerprint exactly equal to the blank baseline fingerprint

P1 proves deterministic rejection without mutation for invalid key index, unresolved property path, missing BEZIER precondition, incorrect live KeyframeEase cardinality, influence outside Adobe's accepted range, automatic-Bezier precondition violation, and stale host revision.

P2 proves exact protocol-1.8 numeric KeyframeEase write/readback on:

1. scalar Opacity, with one incoming and one outgoing ease handle;
2. Scale on a 2D layer fixture whose keyframe values are supplied as two coordinates but whose live After Effects key exposes three incoming and three outgoing KeyframeEase handles.

The Scale state is written and read back exactly at live cardinality three. Exact scalar no-op behavior is also proven without revision advance.

## Pre-acceptance diagnostic

A separate diagnostic run (`34175935709`, artifact `10037251078`) first proved that the additive v1.8 host loader was healthy and isolated the initial failure to an incorrect cardinality assumption. That diagnostic was deliberately **not** used as acceptance evidence because it preloaded the fixed v1.8 host chain before opening CEP.

The accepted run above used the normal production-equivalent CEP bootstrap with **no direct host-loader preload**.

## Maturity decision

This evidence promotes `ae.property.temporal_ease.set` and `ae.property.temporal_ease.readback` from `DECLARED` to **STRUCTURAL** while keeping capability status `PARTIAL`.

It does not establish viewer-visible behavior, induced-failure rollback, or save/reopen/reconnect transfer. Protocol 1.8 must still pass P3, P4, and P5 before transfer/full maturity can be claimed.

## External API basis

The implementation correction is consistent with Adobe's scripting documentation:

- `KeyframeEase`: https://ae-scripting.docsforadobe.dev/other/keyframeease/
- `Property.keyInTemporalEase`, `keyOutTemporalEase`, and `setTemporalEaseAtKey`: https://ae-scripting.docsforadobe.dev/property/property/

Adobe's Scale examples and the live AE 25.6.6 result demonstrate why protocol 1.8 derives ease cardinality from the target key's actual incoming/outgoing KeyframeEase arrays rather than inferring it solely from the nominal property value type.
