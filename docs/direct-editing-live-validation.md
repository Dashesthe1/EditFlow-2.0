# Direct editing live validation — 2026-10-06

The normal production queue executed two isolated real-After-Effects acceptance
runs on Shadow: PRACTICE and PRO_CREATION. These used the same product API, durable
worker, exact transaction adapter, batch executor, checkpoint save and render driver
as production. The lab used separate state and explicitly disabled its own chat
supervisor; it did not change the paused production assignment or recover a worker
credential. The production supervisor itself was not exercised by these two runs.

| Check | Practice | Pro Creation |
|---|---|---|
| One-call claim returns retained context and real AE state | Passed | Passed |
| Exact transaction without research/workflow plans | Passed | Passed |
| Import raw-derived working footage and provided audio; add scale keys and blur | Passed | Passed |
| Automatic nonempty AEP checkpoint after committed edits | Passed | Passed |
| Batch changes across two compositions | Passed | Passed |
| Duplicate submission returns the same durable receipt | Passed | Passed |
| Actual full-resolution test-comp render | Passed | Passed |
| Subsequent edit proceeds without a preview resolve receipt | Passed | Passed |
| Same assignment and completed jobs survive service restart | Passed | Passed |
| Disposable project cleaned; original empty project restored | Passed | Passed |

Measured construction/batch/render/continuation portions: 11,688 ms and 7,904 ms.
Complete lab process including setup, restarts and cleanup: 23.58 seconds.
Decoded both outputs: 24 frames, 24 fps, one second, 320×320, H.264 and AAC audio.
Directly viewed the Practice contact sheet: real movie footage and the chosen zoom
are visible; the output is not a metadata-only or mocked-host test.

The production assignment file SHA-256 was unchanged across the lab:
`39b171e85ddbee7925234442a5f8225d713c96c8a38e5a9c8e0244443d131599`.
No in-flight production writer existed before testing; the assignment was paused
at generation 115. Retained raw files, selections, AEPs and proof receipts remain.

Checks on Linux: schema validation and typecheck passed; 850 tests passed, two
platform skips. Checks on Shadow/Windows: 851 tests passed, one platform skip.

This establishes real execution and continuity on these small test cases. It does
not measure long-movie discovery, full-edit fidelity, concurrent assignments,
watchdog behavior over long sessions, or an end-to-end short-edit completion time.
Private lab inputs, readbacks, receipts, checkpoints and renders remain under the
ignored `proofs/artifacts/direct-live-20261006` directory on Shadow.
