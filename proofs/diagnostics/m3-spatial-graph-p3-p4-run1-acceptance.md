# M3 Spatial Graph P3/P4 Real-AE Acceptance

Accepted: 2026-09-08T18:33:40Z

This record independently accepts the retained protocol 1.9 spatial Graph Editor P3/P4 evidence. It does **not** accept P5 transfer and does not promote the spatial capability family to `FULL`.

## Provenance

- Feature/source commit: `0c297200af3563d2f714d61a2df718af81cd1d4c`
- Control branch: `ae-test/m3-spatial-graph-p3-p4-control`
- Control commit: `5dedd0355959fbf24fd0d3d7960abb870389879b`
- Workflow run: `34184591197`
- Job: `102183384263`
- Artifact: `m3-spatial-graph-p3-p4-proof-34184591197` (`10070526495`)
- Artifact digest: `sha256:122342798174a2c451a1b94f03a1e79bfa8e9b643ce23d9db607d1d7775ca70a`
- `result.json` SHA-256: `d67703a94dd6940b06529a7da99e6e86e14b3abb9ee0bfc8efca2bdde0b06812`
- Host: After Effects 25.6.6 build 4 on the self-hosted `editflow-ae` Windows runner

## P3 visual acceptance

The fixture uses one Position motion path with three keys (`[96,180]` -> `[320,180]` -> `[544,180]`). The exercised manual middle-key spatial tangents create a visibly curved path while preserving the same endpoints.

Retained render SHA-256 values:

- straight baseline: `0790702368a95e3de551dfd9aa1db2553aa20a526808591aca5dba7ccbeaadc6`
- curved spatial path: `e4ae12db8cd527c8a432a58f1b1065c7819379f2b2415cbee3ff277035ff5e79`
- restored straight baseline: `418543ea15576cd9f1cab66bd7010fb93047e4255124978c9d48285a5208b96f`

Decoded-frame verification was performed with FFmpeg FrameMD5 rather than container-byte equality:

- straight baseline decoded FrameMD5 stream: `260285dad93b08ae179fa6b4a5cd7e608782c33fa33f7a3a8ee01e0df6406d72`
- curved decoded FrameMD5 stream: `331eeb3c88992a4ebf8d49297daf878c4053c4f7f1f12e5e5fb9c32e78701f22`
- restored baseline decoded FrameMD5 stream: `260285dad93b08ae179fa6b4a5cd7e608782c33fa33f7a3a8ee01e0df6406d72`

Frame-by-frame comparison found the curved render different from baseline on frames 1-23 of 24, with frame 0 equal at the common starting endpoint. The restored baseline is decoded-frame identical to the original baseline on all 24 frames.

**P3 accepted.** The spatial tangent state causes a viewer-visible motion-path change and removal restores the original straight-path pixels exactly.

## P4 rollback acceptance

The harness armed its deterministic proof-only failure injection after a spatial mutation and verified transaction rollback/readback. The retained post-rollback render SHA-256 is `2a4ae598c44e81e7f7cd8a4ed786ed37437716f8a7b9dd894da02c96d698489d`.

Its decoded FrameMD5 stream is `260285dad93b08ae179fa6b4a5cd7e608782c33fa33f7a3a8ee01e0df6406d72`, exactly matching the original straight baseline on all 24 frames.

**P4 accepted.** The induced failure cannot leave a partially mutated spatial path behind.

## Boundaries

This acceptance is bounded to the exercised protocol 1.9 spatial Graph Editor envelope: spatial tangents, spatial Continuous/Auto Bezier state, roving semantics, exact readback, visible Position-path behavior, and rollback. P5 save/reopen/reconnect transfer remains unproven. The accepted runtime must therefore continue to treat these capabilities as `PARTIAL` until P5 succeeds.