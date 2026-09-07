# M3 mask/Bezier P5 real-AE acceptance — run 5

- PR: #74 (`feature/m3-mask-p5-transfer-proof`)
- Validated source commit: `2ff3e6f6278dfdabe748c2c861c7e5cc5f94d31d`
- Control trigger merge: `41dbab80cfbd81ac65294c1569f334ab7c31d168`
- Trigger-only PR: #75
- GitHub Actions run: `34075693434`
- Real-AE job: `101601208548`
- Uploaded artifact: `m3-mask-p5-proof-34075693434` / artifact id `10001978740`
- Artifact ZIP digest: `sha256:a169a747dac7d85bfe6dc4d4e423e471585a2869120bd50ada2504c68e735832`
- Host: Adobe After Effects 25.6.6 on the self-hosted Windows `editflow-ae` runner
- Accepted baseline: main merge `2f7af5fba1fe67d663ff84b17c59ca8c5c551ebb` / P3-P4 real-AE run `34073726432`

## Failure diagnosis and repair

The preceding real-AE attempt reopened the saved `.aep` successfully but then hit the outer hard runtime guard before proof completion. Its retained `reopen-result.json` proved that the reopen and dispatcher reload had completed, localizing the stall to loopback broker shutdown before the forced reconnect.

`LoopbackCepBroker.stop()` previously awaited `server.close()` without terminating an active CEP HTTP request. A live panel poll/liveness request could therefore keep the Node HTTP server open indefinitely. The accepted repair calls `server.closeAllConnections()` after initiating `server.close()`, and a regression test holds an intentionally incomplete authenticated request open to prove `stop()` cannot deadlock. Normal PR CI passed on source commit `2ff3e6f6278dfdabe748c2c861c7e5cc5f94d31d` before the real-AE rerun.

## Automated proof result

The retained `result.json` reports `ok: true`, `status: ACCEPTED`, `cleanupComplete: true`, no failure error, and no cleanup errors. `P5_save_reopen_reconnect_transfer` is `true`; P1-P4 remain accepted baseline evidence and were deliberately not replayed.

All required P5 checks are true, including:

- public v1.1 `project.save` applied and the runner-owned `.aep` was retained;
- the exact saved project reopened and the current dispatcher reloaded;
- the initial panel negotiated protocol 1.2 while retaining 1.1 compatibility;
- broker restart produced a distinct authenticated CEP session;
- reopened project path, stable IDs, and structural fingerprint were preserved;
- exact mask properties, Bezier shape, and all animated path keyframes survived save/reopen/reconnect;
- a fresh post-reconnect `mask.set_properties` mutation applied and read back exactly;
- that mutation did not disturb the transferred animated path;
- proof-only cleanup passed, retained the evidence `.aep`, returned the project to zero items, and restored the original blank structural fingerprint.

The initial session was `ad2f47b6-b91c-46f0-9882-b8932d13c961`; the reconnected session was `47157af2-1c69-44ef-a84b-95569b4b8c1b`, proving a new authenticated transport session rather than reuse of the original registration.

The post-reconnect property mutation changed the mask from ADD / non-inverted / feather `[7, 9]` / expansion `4` / opacity `91` to SUBTRACT / inverted / feather `[16, 12]` / expansion `9` / opacity `73`, while the three path keyframes remained exact.

The cleanup marker reports `ok: true` and `blankItemCount: 0`. Runner diagnostics report `FINAL_CLEANUP_ZERO` with zero After Effects processes after the proof.

## Retained evidence hashes

- `m3-mask-p5-transfer.aep`: `64e1c22541d15e219a66bff25f070cf079fd3656797508a4a863ecb7bbb80226`
- `result.json`: `cc9879c25f88b1d72e59869fa69174ec6dba87de0025711accb664f5fe7b9653`
- `reopen-result.json`: `2b1d2a2dc8e0047d89869daa29dc968a369df72412df894ee61b7653e00a0161`
- `cleanup-result.json`: `34585fb50c228b575b030bbe4100941e699e4d7f7f55ced15dab47f4c2881187`

## Acceptance

**P5 save/reopen/reconnect transfer is accepted on real After Effects.**

Together with the previously accepted P1-P4 evidence, this completes the mask/Bezier proof ladder through transfer maturity. This acceptance does not claim the remaining M3 matte, parenting, layer-control, or Graph Editor capabilities; those remain separate M3 work.
