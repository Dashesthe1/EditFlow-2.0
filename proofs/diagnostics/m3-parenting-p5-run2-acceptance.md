# M3 parenting P5 real-AE acceptance — run 2

- Feature PR: #101 (`feature/m3-parenting-p5-transfer-proof`)
- CI-green source commit under proof: `59f0401d49dd0c92e86246df59c801e8ed76616f`
- Control trigger merge: `046d0d4bb6165875acb4965b1d6d94539714571a`
- Trigger-only PR: #103
- GitHub Actions run: `34086348504`, attempt 1 / workflow run number 2
- Real-AE job: `101631020844`
- Uploaded artifact: `m3-parenting-p5-proof-34086348504` / artifact id `10005344570`
- Artifact ZIP digest: `sha256:8e1975ddd2037806dfb4da580a77e1335a677fca54c89bf454e79f26ba9e8d8f`
- Host: Adobe After Effects `25.6.6x4`, build `4`, on self-hosted Windows runner `editflow-ae`
- Accepted P3/P4 baseline: main `a2d4acf47668f47d18fce86ccce60ed52674cab2` / real-AE run `34084958343`

## Attempt history

The first parenting P5 workflow run, `34085989051`, did not exercise the parenting surface. After Effects launched to a blank unsaved project and the fixed panel-open command was sent, but the CEP panel missed its initial broker registration window. The retained result had `sessions.initial: null`, `sessions.reconnected: null`, an empty `responses` array, and `CEP_PANEL_REGISTRATION_TIMEOUT`. No fixture was built, no project save occurred, and no parenting command was sent. The runner cleaned its owned After Effects process set back to zero. Its artifact id was `10005269799` with ZIP digest `sha256:a45f7aee85cd86b0861e289531b04f4fd79b778edef96c04696e33542e843d1c`.

Run 2 was a controlled no-source-change retry of the same CI-green P5 implementation. The only repository difference on the control branch was the trigger/evidence marker. The panel registered normally and the complete P5 transfer proof passed. This keeps the first run as explicit launcher-registration negative evidence rather than hiding it or misclassifying it as a parenting defect.

## Automated proof result

The retained `result.json` reports:

- `proofId: M3_PARENTING_P5_REAL_AE`
- `status: ACCEPTED`
- `ok: true`
- `cleanupComplete: true`
- `P5_save_reopen_reconnect_transfer: true`
- no failure error
- no cleanup errors

All P5 checks are true, including:

- fixed reopen/cleanup proof scripts and After Effects executable present;
- initial authenticated protocol 1.4 panel session with protocol 1.1 compatibility;
- live Adobe After Effects host probe;
- blank unsaved baseline;
- materially different 480x240 source composition and 960x540 target composition created at 30 fps;
- two distinct stable-ID AV layers created;
- initial child five-point comp-space geometry available while unparented;
- direct preserve-transform parent assignment applied and verified against all five geometry points;
- exact parenting readback before save;
- public v1.1 `project.save` applied;
- non-empty saved `.aep` artifact and exact saved-project path readback;
- saved fixture shape and layer order verified before reopen;
- exact saved `.aep` reopened and the current EditFlow dispatcher reloaded;
- loopback broker stopped/restarted and a distinct authenticated protocol 1.4 CEP session established;
- reopened project path, stable item/layer IDs, layer order, and saved structural fingerprint preserved;
- exact child-to-parent relationship preserved across save/reopen/reconnect;
- all five comp-space geometry points preserved exactly across the transfer;
- fresh post-reconnect `layer.clear_parent_preserve_transform` applied with geometry preserved;
- fresh post-reconnect `layer.set_parent_preserve_transform` applied with geometry preserved;
- final `layer.parenting_readback` returned the exact re-parented relation and geometry;
- layer order survived the post-reconnect parenting mutations;
- proof-only cleanup passed;
- the saved `.aep` remained retained as evidence;
- cleanup returned After Effects to a blank unsaved project and restored the original structural fingerprint;
- the self-hosted runner confirmed zero After Effects processes after final cleanup.

P1-P4 are accepted baseline evidence and were deliberately not replayed by this tranche.

## Session-transfer evidence

Initial authenticated CEP session:

- session id: `4447a4d5-bdde-4667-abf2-ecbdaff86ff4`
- selected protocol: `1.4.0`
- supported protocols: `1.4.0`, `1.1.0`
- extension: `com.editflow2.bridge.panel` `0.1.0-dev.4`
- registered: `2026-09-07T05:19:58.751Z`

Post-reopen/reconnect authenticated CEP session:

- session id: `a4925317-67d4-48b1-8eef-2595b9a21019`
- selected protocol: `1.4.0`
- supported protocols: `1.4.0`, `1.1.0`
- extension: `com.editflow2.bridge.panel` `0.1.0-dev.4`
- registered: `2026-09-07T05:20:10.192Z`

The distinct session IDs prove that post-reopen authority was established through a new authenticated transport session rather than reuse of the pre-save registration.

## Exact parenting transfer

The transfer fixture deliberately differs from the accepted P3 visual fixture:

- source composition: 480x240;
- target composition: 960x540;
- parent transform: position `[205, 355]`, scale `[82, 82]`, rotation `-31` degrees, opacity `0`;
- child transform: position `[610, 165]`, scale `[130, 65]`, rotation `18` degrees, opacity `100`.

Proof generation prefix: `M3_PARENTING_P5_1788758398728`.

Before save the child was parented to `M3_PARENTING_P5_1788758398728_PARENT_LAYER` and its comp-space geometry was:

- top-left: `[337.373687744141, -5.59571075439453]`
- top-right: `[930.832946777344, 187.230895996094]`
- bottom-right: `[882.626281738281, 335.595703125]`
- bottom-left: `[289.167053222656, 142.769104003906]`
- center: `[610, 165]`

After save/reopen/reconnect, the same child and parent stable IDs and layer indices read back with the same five geometry points. The fresh post-reconnect clear restored the child to its original local transform while preserving those same five comp-space points. The fresh re-parent recomputed the parent-relative local transform and again preserved those same five points. The final parenting readback remained exact.

This proves transferred post-reconnect authority for all three protocol-1.4 parenting commands: structural/geometry readback, preserve-transform clear, and preserve-transform set-parent, within the representable direct-parent geometry envelope already established by the accepted P3/P4 evidence.

## Reopen and cleanup markers

`reopen-result.json` reports:

- proof id `M3_PARENTING_P5_REOPEN`;
- `ok: true`;
- exact fixed saved project reopened;
- item count `2`;
- host project revision `105`;
- `dispatcherReady: true`.

`cleanup-result.json` reports:

- proof id `M3_PARENTING_P5_CLEANUP`;
- `ok: true`;
- exact proof generation prefix `M3_PARENTING_P5_1788758398728`;
- retained fixed saved project path;
- blank item count `0`.

## Retained evidence hashes

- `m3-parenting-p5-transfer.aep`: `71809019b582dc3202ed848054057c946b0859528ed3f58a043133988517f5e5`
- `result.json`: `7dd69baa914dbd47a915967afe7ec30b0a11f9b5deee1c7da1736f6d9bacbd87`
- `reopen-result.json`: `cf1b5e6352f5c4750714d612c6096c470579b26970ba7a921cd062883fb6c7f3`
- `cleanup-result.json`: `c13bd3e4a84ef0293e6313f757ada7591b8ce78362d2eaf636cad309eeaa48b4`
- `panel-bootstrap.log`: `f1cee59c24e65c91a62a2ba2b7a4472fdb097de619adabac9fd93af1e21b2bab`
- `startup-diagnostics.log`: `2579c60d09f7c3595d8a6a807a30729265e283e85fa825eee4886c7541db1383`

## Acceptance

**M3 parenting P5 save/reopen/reconnect transfer is accepted on real After Effects.**

Together with the previously accepted P1/P2 structural tranche and P3/P4 visual/rollback tranche, this completes the protocol-1.4 parenting proof ladder through transfer for the behaviors exercised by the accepted evidence. The evidence remains capability-scoped: direct-parent preserve-transform assignment is accepted only when After Effects can represent the required local transform without geometry drift. The known rotated + non-uniform parent shear boundary remains fail-closed with rollback; this acceptance does not convert an unrepresentable transform into a silently approximate success, and it implies no unrelated layer-control or Graph Editor capability.