# M3 Layer Controls P1/P2 Real-AE Acceptance

## Acceptance boundary

**Accepted:** protocol 1.6 layer-switch and stacking-order P1 validation/rejection plus P2 structural/readback behavior on real Adobe After Effects.

This acceptance is deliberately bounded. It does **not** claim:

- P3 viewer-visible/rendered proof;
- P4 induced-failure rollback proof;
- P5 save/reopen/reconnect transfer;
- motion-blur/frame-blending controls reserved for the later compound-rendering tranche;
- unrelated Human-Parity capabilities.

## Accepted source and control

- Corrected source/harness commit: `bf26b3a4351a947d130f792ca7a1a26aa6091a2c`
- Repository CI on that exact source: `34156873839` / success
- Isolated control/trigger commit: `fea5a260a28e986589553ae2ee9125c9a8516505`
- Workflow: `M3 Layer Controls P1 P2 Real After Effects`
- Workflow run: `34156910741`
- Workflow run number: `7`
- Run attempt: `1`
- Real-AE job: `101850542487`
- Adobe After Effects host: `25.6.6x4`, build `4`, Windows 64-bit

The control commit is a trigger-only child of the exact accepted source commit, so the real-AE evidence and merge candidate share an explicit source lineage.

## Retained artifact

- Artifact: `m3-layer-controls-p1-p2-proof-34156910741`
- Artifact id: `10031293005`
- Artifact ZIP SHA-256: `0cafddc48bb146827b3ec9698f92eb219de241ed66773c1c97edfc82af45d31b`
- Artifact size: `5223` bytes

Retained file SHA-256 values:

- `panel-bootstrap.log`: `3b30d503605c76a14ffebcac7d21c3c4fc7520112382c1f6d20068bff609667b`
- `startup-diagnostics.log`: `9777b59bfc1626b9840daf2c660a813fe95aac36bf7867c2d9b7af2ed3410536`
- `result.json`: `8d63c6da4fa8febb623c803a349c3b9aa03b4c881c421d8bc4dde44f9a1c95f6`

The retained `result.json` reports `status: PASS`, `ok: true`, `cleanupComplete: true`, P1 true, P2 true, and P3/P4/P5 false. `failureError` is null and `cleanupErrors` is empty.

## Transport/session evidence

The proof registered an authenticated CEP session with:

- session id `e80e1b35-a056-457b-b6e9-8d79c9640d85`;
- negotiated protocol `1.6.0`;
- supported proof protocols `1.6.0` and baseline `1.1.0`;
- extension id `com.editflow2.bridge.panel`;
- extension version `0.1.0-dev.6`.

The baseline protocol-1.1 host probe also succeeded and reported Adobe After Effects `25.6.6x4`, build `4`.

## P1 validation/rejection evidence

All bounded P1 requests were rejected before mutation, with unchanged host revision and unchanged project fingerprint:

1. stale expected host revision -> `HOST_REVISION_CONFLICT`;
2. empty switch patch -> `LAYER_SWITCHES_EMPTY`;
3. self-relative ordering request -> `LAYER_RELATIVE_SELF`.

The aggregate P1 check is true.

## P2 switch evidence

The proof used a disposable nested-composition AVLayer so applicability differences did not masquerade as capability failure. All twelve protocol-1.6 switch keys were proven on the real host.

Eleven switches were independently changed and restored with exact readback:

- `enabled`: `false` -> `true`;
- `audioEnabled`: `false` -> `true`;
- `solo`: `true` -> `false`;
- `shy`: `true` -> `false`;
- `collapseTransformation`: `true` -> `false`;
- `quality`: `DRAFT` -> `BEST`;
- `effectsActive`: `false` -> `true`;
- `adjustmentLayer`: `true` -> `false`;
- `threeDLayer`: `true` -> `false`;
- `preserveTransparency`: `true` -> `false`;
- `samplingQuality`: `BICUBIC` -> `BILINEAR`.

Every set was `APPLIED` with the requested value in structural readback. Every restore returned the requested original value.

The twelfth switch, `locked`, was exercised around the stacking-order proof:

- lock -> `APPLIED`, exact `locked:true` readback;
- repeated lock -> `NO_OP`, exact `locked:true` readback;
- every ordering mutation preserved the lock state;
- final unlock -> `APPLIED`, exact `locked:false` readback.

The aggregate exact-switch check is true.

## P2 stacking-order evidence

The corrected fixture intentionally creates disposable layers in `C, B, A` order. Because After Effects inserts newly added layers at the beginning of a composition's layer stack, this leaves A at index 1 and makes each requested placement in the proof materially exercise the host rather than accidentally request the layer's current position.

The accepted sequence was:

1. `END` -> `APPLIED`; A read back at index `3/3`, still locked;
2. repeat `END` -> `NO_OP`; idempotency proven at index `3/3`;
3. `BEFORE B` -> `APPLIED`; A read back immediately before B;
4. `AFTER C` -> `APPLIED`; A read back immediately after C;
5. `BEGINNING` -> `APPLIED`; A read back at index `1/3`;
6. final controls readback -> `NO_OP`; A remained index `1/3` and unlocked after the explicit unlock step.

All exact-order checks are true.

The fixture correction was cross-checked against the documented After Effects scripting semantics for `moveToBeginning`, `moveToEnd`, `moveBefore`, and `moveAfter`; the accepted real-AE readbacks independently confirm those semantics on the exercised host.

## Cleanup evidence

The proof removed both disposable fixture compositions and restored:

- the exact pre-proof project item count;
- the exact pre-proof project fingerprint;
- zero cleanup errors.

After the proof and project cleanup were already complete, the runner attempted a graceful close of only its owned After Effects process. After Effects did not exit within the bounded close window, so the runner force-stopped only that owned PID and then confirmed the final After Effects process count was zero. This post-proof process shutdown did not alter the successful project-cleanup evidence.

## Attempt history and retained negative evidence

The earlier workflow run `34155825837` remains non-acceptance evidence:

- Attempt 1 failed before an authenticated panel session with `CEP_PANEL_REGISTRATION_TIMEOUT`. No layer-controls behavior was accepted from that attempt.
- Attempt 2 successfully registered protocol 1.6, passed the host probe, passed all P1 checks, and passed all declared switch writes/readbacks. It then exposed two harness-fixture assumptions: A already occupied the requested `END` position, and the requested `AFTER C` placement after `BEFORE B` represented the same adjacency. After Effects correctly returned `NO_OP` for those two requests. Exact project cleanup still completed.

The implementation's ordering semantics were not changed in response. The proof fixture alone was corrected so every non-idempotency placement request causes a real move, and regression coverage now locks that fixture construction order.

The first registration miss also motivated bounded CEP diagnostics in the self-hosted runner. On future proof failure, it temporarily enables CEP 12 verbose logging, retains recent documented AEFT CEP/CEPHtmlEngine logs from `%TEMP%`, writes a diagnostics manifest, and restores the user's prior CEP LogLevel setting. Successful runs do not retain those extra failure logs.

## External implementation references

The fixture/order correction was checked against:

- Adobe After Effects layer creation/stacking documentation: <https://helpx.adobe.com/after-effects/desktop/work-with-layers/create-layers/creating-layers.html>
- After Effects scripting Layer ordering methods: <https://ae-scripting.docsforadobe.dev/layer/layer/>
- Adobe CEP 12 debugging handbook used for the failure-log capture path: <https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/Debugging%20Handbook.md>

## Result

**M3 protocol 1.6 layer-controls P1/P2 is accepted for the exercised deterministic rejection, exact switch behavior, stacking-order behavior, idempotency, structural readback, and proof-owned cleanup envelope.**

Next evidence boundary: P3 must independently establish viewer-visible behavior for a representative rendering-sensitive layer-control/order fixture; P4 must inject a failure after a real protocol-1.6 mutation and prove immediate AE-Undo rollback with structural and visual recovery; P5 remains a separate save/reopen/reconnect transfer proof.
