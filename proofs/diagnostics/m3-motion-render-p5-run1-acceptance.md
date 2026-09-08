# M3 motion-render P5 real-AE transfer acceptance — run 1

- Feature source commit under proof: `79dabd7573d99fc8b0664032d54658d65bc1cf02`
- Isolated control/trigger commit: `364055888dcb404ea4dbc06e44619c33d16a348a`
- GitHub Actions real-AE run: `34281332554`
- Real-AE job: `102246528340`
- Uploaded artifact: `m3-motion-render-p5-proof-34281332554` / artifact id `10077917851`
- Artifact ZIP digest: `sha256:91efbbfc8a3c7a2cf742d669ea4d6fafc0c49f80e90eb692df3835bdf834ce34`
- Successful `result.json` SHA-256: `89aa0465ae6e5291ddf4d936233e793c1587f3e97213313fc16f1b873e3aade6`
- Retained `.aep` SHA-256: `ff045e3a444eac59f4e51ee3d818d08a5d078ed5a198d12d4f883c28f09f26bb`
- Reopen marker SHA-256: `58c9929ae5958fdae0e97e54880bb6a2ebab9cd72c0e5d429edfe6d740d2b7f2`
- Cleanup marker SHA-256: `ad0ee0958dce4ee9ec49104f3a7d1c570adb2c2004af90f7421bcb135feba3a2`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- Accepted P1/P2 baseline: source `70b1549c56179689fb033db36f13fc4b6dbb5998`, run `34275036819`, artifact `10075375705`
- Accepted P3/P4 baseline: source `042a54b63a73dc3fcbcd77d5cb9d6f981492713e`, run `34279808693`, artifact `10077191111`

## Result

The retained successful `result.json` reports:

- `proofId: M3_MOTION_RENDER_P5_REAL_AE`
- `protocolVersion: 1.10.0`
- `status: ACCEPTED`
- `ok: true`
- `P5_save_reopen_reconnect_transfer: true`
- `cleanupComplete: true`
- `cleanupErrors: []`
- `failureError: null`

P1-P4 were intentionally not replayed. Their exact accepted provenance is embedded in the P5 result and was validated before the transfer tranche began.

Every bounded P5 check is true. In particular:

- the proof began from the exact blank unsaved runner-owned project fingerprint;
- protocol 1.10 was negotiated while protocol 1.1 compatibility remained available;
- a proof-owned source composition, target composition and one AVLayer were created;
- before save, the composition read back `motionBlur=true`, `frameBlending=true`, `shutterAngle=315`, `shutterPhase=-105`, `samplesPerFrame=24`, `adaptiveSampleLimit=96`;
- before save, the layer read back `motionBlur=true` and `FRAME_MIX`, including its derived frame-blending state;
- the native AE layer id was captured as `25`;
- `project.save` produced the fixed retained `m3-motion-render-p5-transfer.aep` artifact;
- the fixed AEP was closed without saving changes and reopened by the proof-only fixed-path script;
- the protocol-1.10 dispatcher was reloaded after reopen;
- the initial authenticated CEP session `66ad0ece-59c7-4dab-84ff-1d4888856186` was replaced by distinct authenticated session `eec5a148-fb5e-4e8f-9339-ae2c91b8920f`;
- both sessions negotiated `1.10.0`, retained `1.1.0` compatibility, and reported the same expected extension identity/version;
- the saved structural project fingerprint, stable fixture topology, exact motion-render settings and native layer id `25` all survived save/reopen/reconnect;
- a fresh post-reconnect composition write/readback succeeded with `motionBlur=false`, `frameBlending=true`, `shutterAngle=180`, `shutterPhase=-45`, `samplesPerFrame=32`, `adaptiveSampleLimit=128`;
- a fresh post-reconnect layer write/readback succeeded with `motionBlur=false` and `PIXEL_MOTION`;
- the final combined protocol-1.10 readback was exact;
- proof-only cleanup discarded only unsaved post-reconnect changes, retained the saved AEP evidence, and restored the live runner to the exact original blank-project fingerprint.

The blank baseline fingerprint was `project:sha256:0a1f2ab2a77b28d4a483592a7e59b2f1614ce3012a85ef680a97ffbbd9b10440`; the retained saved-project fingerprint was `project:sha256:0fad3ebe7ead5b814af3a7cfce721805c75fed6afb77aa33f46b1c2f75ece23a`.

## Bounded registration retry

The retained artifact also contains a first-attempt panel-registration timeout. That attempt contains no host/session/fixture evidence, `checks` is empty, and `responses` is empty: no EditFlow command was leased or applied before the bounded self-hosted retry. The accepted second attempt is therefore the sole host-state transfer proof and is not contaminated by a preceding mutation.

## Acceptance

**P5 save/reopen/reconnect transfer is accepted for the bounded protocol-1.10 motion-render envelope.** The saved AE-owned composition/layer state and native layer identity survive fixed-path `.aep` reopen into a distinct authenticated CEP session, and that new session retains fresh protocol-1.10 write plus exact-readback authority.

Together with the previously accepted P1-P4 evidence, the three protocol-1.10 motion-render capabilities may advance from `PARTIAL`/`ROLLBACK` to `FULL`/`TRANSFER`.

This acceptance does not claim `ROBUST` maturity, artifact-free Pixel Motion for arbitrary footage, or capabilities beyond the explicitly typed composition/layer motion-render surface.