# M3 composite P5 real-AE acceptance — run 1 attempt 2

- PR: #86 (`feature/m3-composite-p5-transfer-proof`)
- CI-green source commit under proof: `37e7e0417ec3e7d9e8f1a2df172ff06ecfa26d4b`
- Control trigger merge: `a4a34318072c4b19a2efa8590af401e63c97e369`
- Trigger-only PR: #87
- GitHub Actions run: `34080055645`, attempt 2
- Real-AE job: `101614103943`
- Uploaded artifact: `m3-composite-p5-proof-34080055645` / artifact id `10003461751`
- Artifact ZIP digest: `sha256:bfd0c00be827a89535112ac4c80fdb58312973bb6edeca1dd42cc44b03c973bc`
- Host: Adobe After Effects 25.6.6 on self-hosted Windows runner `editflow-ae`
- Accepted P3/P4 baseline: main `e629e2b6c463c0467a20e145445976f9a88a4a24` / real-AE run `34079590956`

## Attempt history

Run 1 attempt 1 did not exercise the P5 project or composite surface. After Effects launched and the fixed panel-open command was sent, but the CEP panel missed its initial broker registration window and the harness ended with `WAIT_FOR_PANEL_TIMEOUT`. No panel session was created, no fixture was built, and no project mutation occurred. The runner cleaned its owned AE process set back to zero.

The identical control commit was rerun without any code change as attempt 2. The panel registered normally and the complete transfer proof passed. This establishes the first attempt as a transient startup/registration miss rather than a P5 implementation defect.

## Automated proof result

The retained `result.json` reports:

- `status: ACCEPTED`
- `ok: true`
- `cleanupComplete: true`
- `P5_save_reopen_reconnect_transfer: true`
- no failure error
- no cleanup errors

Every P5 check is true, including:

- fixed reopen/cleanup proof scripts and After Effects executable present;
- initial authenticated protocol 1.3 panel session with protocol 1.1 compatibility;
- live Adobe After Effects host probe;
- blank unsaved baseline;
- source and target compositions created;
- target, spacer, and matte layers created with the matte non-adjacent and the spacer preserved between target and matte;
- initial arbitrary-source `LUMA` track matte applied;
- initial `ADD` blend mode applied;
- exact pre-save composite readback;
- public v1.1 `project.save` applied;
- non-empty saved `.aep` artifact and exact saved-project path readback;
- fixed saved fixture shape present before reopen;
- exact saved `.aep` reopened and current EditFlow dispatcher reloaded;
- loopback broker restarted and a distinct authenticated protocol 1.3 CEP session established;
- reopened project path, stable IDs, and layer order preserved;
- saved structural fingerprint preserved;
- exact `LUMA + ADD` composite state preserved across save/reopen/reconnect;
- fresh post-reconnect `layer.clear_track_matte` applied, reading back no active matte while preserving dormant `LUMA` type;
- fresh post-reconnect `layer.set_track_matte` applied with `ALPHA_INVERTED` and the same arbitrary matte source;
- fresh post-reconnect `layer.set_blend_mode` applied with `SCREEN`;
- final `layer.composite_readback` returned exact `ALPHA_INVERTED + SCREEN` state;
- layer order survived the post-reconnect composite mutations;
- proof-only cleanup passed;
- the saved `.aep` remained retained as evidence;
- cleanup returned After Effects to a blank unsaved project and restored the original structural fingerprint;
- the self-hosted runner confirmed zero After Effects processes after final cleanup.

P1-P4 are accepted baseline evidence and were deliberately not replayed by this tranche.

## Session-transfer evidence

Initial authenticated CEP session:

- session id: `7aaf09ce-52a0-4b44-a9d1-8086d1209b11`
- selected protocol: `1.3.0`
- supported protocols: `1.3.0`, `1.1.0`
- registered: `2026-09-07T03:38:03.404Z`

Post-reopen/reconnect authenticated CEP session:

- session id: `43a22117-0d77-4b16-b3a2-2bee36347ef6`
- selected protocol: `1.3.0`
- supported protocols: `1.3.0`, `1.1.0`
- registered: `2026-09-07T03:38:13.339Z`

The distinct session IDs prove that post-reopen authority was established through a new authenticated transport session rather than reuse of the pre-save registration.

## Exact composite transfer

Before save:

- target stable id: `M3_COMPOSITE_P5_1788752283262_TARGET_LAYER`
- target layer index: `3`
- matte stable id: `M3_COMPOSITE_P5_1788752283262_MATTE_LAYER`
- matte layer index: `1`
- `hasTrackMatte: true`
- `trackMatteType: LUMA`
- `blendMode: ADD`

After reopen/reconnect, the same target/matte host IDs, stable IDs, indices, matte type, matte relationship, and blend mode read back exactly.

The fresh post-reconnect clear produced:

- `hasTrackMatte: false`
- `trackMatteLayer: null`
- dormant `trackMatteType: LUMA`
- `blendMode: ADD`

The fresh post-reconnect reassignment and blend mutation then produced:

- `hasTrackMatte: true`
- `trackMatteType: ALPHA_INVERTED`
- same matte stable id and index
- `blendMode: SCREEN`

This proves transferred post-reconnect authority for all four protocol-1.3 composite commands: structural readback, clear matte, set arbitrary-source matte, and set blend mode.

## Reopen and cleanup markers

`reopen-result.json` reports:

- proof id `M3_COMPOSITE_P5_REOPEN`
- `ok: true`
- reopened fixed saved project path
- item count `2`
- host revision `101`
- `dispatcherReady: true`

`cleanup-result.json` reports:

- proof id `M3_COMPOSITE_P5_CLEANUP`
- `ok: true`
- exact proof generation prefix `M3_COMPOSITE_P5_1788752283262`
- retained fixed saved project path
- blank item count `0`

## Retained evidence hashes

- `m3-composite-p5-transfer.aep`: `91b448cd716304a932f43a626824fb2e6b7fe6b824d03866b71e2ecabd65ea73`
- `result.json`: `f0bcbcb893ce3a213860383654bde4e214f4ec6f6eaa6dec0dae38a403585904`
- `reopen-result.json`: `cd45cce1c0f83303c2a097d218d6a592fb271323f6f32f35bc402e1095effc9c`
- `cleanup-result.json`: `feb1ef284c71412a35b87d97577f6bd0e614a18e906acf6a73497e8cc1dbab94`
- `panel-bootstrap.log`: `81bdcce7f89b3b5b53750cb3d07a9f18f2ffd0821ab47f748758a8121f2964b4`
- `startup-diagnostics.log`: `a877781e0257a21d095827d4d32f32821982da2304c9678647dce026ad7156ca`

## Acceptance

**M3 composite P5 save/reopen/reconnect transfer is accepted on real After Effects.**

Together with the previously accepted P1/P2 structural tranche and P3/P4 visual/rollback evidence, this completes the composite protocol-1.3 proof ladder through transfer for the behaviors exercised by the accepted evidence. The accepted evidence is capability-scoped: blend-mode mutation has explicit P4 induced-failure rollback evidence; matte set and clear retain their own previously proven evidence boundaries. No unrelated M3 parenting, layer-control, or Graph Editor capability is implied by this acceptance.
