# M3 mask P3/P4 real-AE run 1 diagnostic

- Workflow run: `34069494260`
- Artifact: `10000033735`
- Source under test: PR #73 via `ae-test/m3-mask-p3-p4-control`
- Result: `FAILURE` before P4 execution.
- After Effects: 25.6.6 (`25.6.6x4`).
- CEP protocol negotiation: 1.2.0 selected; 1.2.0 and 1.1.0 advertised.

## What passed

The deterministic bitmap fixtures were written and imported, the disposable composition/layers were created and ordered, the M3 mask was created, and the three-keyframe animated mask path passed structural readback. Final cleanup restored the baseline project fingerprint, removed all temporary items, and restored the original item count.

## Failure boundary

The first P3 `render.capture` scheduled successfully through protocol 1.1, but the desktop harness timed out waiting for a terminal lifecycle marker. The retained `p3-mask-reveal.avi.editflow-render.json` file was exactly 0 bytes and no AVI was emitted. P4 was therefore not attempted.

The synchronous SCHEDULED marker paths had already completed successfully before the delayed host driver ran. The zero-byte retained marker is consistent with the delayed driver's hand-written serializer opening/truncating the marker and failing before durable payload completion.

## Corrective change

The delayed async-render driver now uses the same checked-in `$.global.EditFlow2_JSON.stringify` runtime already proven by the synchronous SCHEDULED writers. It serializes the entire marker payload before opening/truncating the durable marker, so a serialization failure cannot erase the last valid lifecycle state.

No P3 or P4 maturity is claimed from run 1.
