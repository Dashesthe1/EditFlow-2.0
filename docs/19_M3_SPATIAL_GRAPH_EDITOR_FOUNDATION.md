# M3 Spatial Graph Editor Foundation (Protocol 1.9)

## Scope

This tranche extends the accepted protocol 1.8 temporal-ease work into spatial motion-path control without changing accepted 1.1-1.8 behavior.

Protocol 1.9 declares two bounded commands:

- `property.spatial_graph.set`
- `property.spatial_graph.readback`

The state is per keyframe and contains exact incoming/outgoing spatial tangent vectors plus spatial continuity, spatial auto-Bezier, and roving state.

## Host-truth rules

The host validates the actual After Effects property before mutation:

1. Only `PropertyValueType.TwoD_SPATIAL` and `PropertyValueType.ThreeD_SPATIAL` are valid.
2. Manual tangent vectors must contain exactly two or three finite values respectively.
3. `AUTO_BEZIER` is host-shaped: callers do not provide tangent vectors; AE-generated tangents are returned as observation.
4. Roving may be enabled only on interior keys; first and last keys are rejected rather than silently accepted.
5. Mutations require the expected live host revision.
6. Applied state is structurally read back and compared.
7. If mutation/readback fails after a write begins, the prior spatial state is restored and rollback is read back.

These rules correspond to the After Effects scripting property surface: `keyInSpatialTangent`, `keyOutSpatialTangent`, `setSpatialTangentsAtKey`, `key/setSpatialContinuousAtKey`, `key/setSpatialAutoBezierAtKey`, and `key/setRovingAtKey`.

External references used to constrain the implementation and proof harness:

- After Effects Scripting Guide, Property object: https://ae-scripting.docsforadobe.dev/property/property/
- Adobe Expression Controls / Point Control: https://helpx.adobe.com/after-effects/desktop/work-with-expressions/expression-controls/expression-controls.html
- Adobe CEP 12 Debugging Handbook: https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/Debugging%20Handbook.md

The Property reference is the authority for spatial-property-only APIs, 2D/3D tangent cardinality, and the first/last-key roving restriction. It also documents the scripting model in which layer Position may expose a three-component spatial value even when the layer is presented as 2D in the UI. The accepted TwoD proof therefore uses the actual two-coordinate Point Control property rather than assuming UI layer dimensionality changes Position's scripting-level property type. The CEP handbook is the authority for the isolated Windows proof runner's temporary `CSXS.12` LogLevel 6 diagnostics and `%TEMP%` CEP/CEPHtmlEngine failure-log capture.

## Real-AE P1/P2 acceptance harness

The branch contains a bounded P1/P2 proof surface:

- `apps/desktop-host/src/m3-spatial-graph-p1-p2-cli.ts`
- `scripts/windows/run-m3-spatial-graph-p1-p2.ps1`
- `scripts/windows/run-m3-spatial-graph-self-hosted.ps1`
- `.github/workflows/m3-spatial-graph-real-ae-p1-p2.yml`
- `tests/m3-spatial-graph-p1-p2-harness.test.mjs`

The self-hosted runner deliberately reuses the accepted isolated AE lifecycle. Protocol 1.9 is still not part of the ordinary installer/default panel negotiation. For this proof only, the checked-out runner creates an isolated installed preview by:

1. running the accepted installer;
2. copying `editflow_host_m3_spatial_graph.jsx` and `editflow_host_current_v19.jsx` into that test installation;
3. extending only that installed panel/config to advertise protocol 1.9 and bootstrap `current_v19`;
4. launching an otherwise normal authenticated CEP session;
5. returning the runner-owned AE process set to zero after the proof.

This prevents unaccepted 1.9 behavior from displacing accepted 1.8 in ordinary EditFlow sessions.

### Bounded CEP registration resilience

The first real-AE spatial P1/P2 launch reached a healthy After Effects project window and executed the fixed `EditFlow 2.0 Bridge` menu command, but the CEP panel did not register with the broker before the timeout. The proof artifact contained no panel session, no host probe, no command responses, no spatial evidence, and no checks, so no project/spatial operation had begun. The runner then restored the workstation to zero After Effects processes.

This matches a previously observed pre-command registration failure in the accepted temporal-ease proof lineage. To make the spatial proof resilient to that infrastructure-only failure without weakening any spatial assertion, the self-hosted wrapper permits exactly one fresh launch retry only when all of these conditions are true:

- `failureError` contains `CEP_PANEL_REGISTRATION_TIMEOUT`;
- `panel` is null;
- `environment` is null;
- the response array is empty;
- the evidence array is empty;
- the checks object has no properties;
- the failed generated runner has returned the machine to zero `AfterFX` processes.

Any attempt that reaches a broker/AE command, produces structural evidence, or fails a spatial assertion is not retryable and remains a hard proof failure.

## Accepted P1/P2 evidence

P1/P2 is accepted from self-hosted workflow run **34182897797**, artifact **10039524832**, executed against **Adobe After Effects 25.6.6x4** on Windows. The artifact reports `status: PASS`, `ok: true`, `cleanupComplete: true`, `P1_validation_rejection: true`, and `P2_structural_readback: true`. P3/P4/P5 remain false.

The successful proof uses two real scripting-level spatial property classes:

- **TwoD_SPATIAL:** `ADBE Effect Parade -> ADBE Point Control -> ADBE Point Control-0001`
- **ThreeD_SPATIAL:** `ADBE Transform Group -> ADBE Position`

Accepted structural evidence:

- TwoD manual key 2 at `0.5s`: incoming tangent `[-42.5, 18.25]`, outgoing tangent `[63.75, -21.5]`, `continuous=false`, `autoBezier=false`, `roving=false`; exact set readback and independent readback both matched; dimensionality read back as 2.
- ThreeD manual key 2 at `0.5s`: incoming tangent `[-31.5, 16.25, 9.75]`, outgoing tangent `[58.5, -27.25, 22.5]`, `continuous=false`, `autoBezier=false`, `roving=false`; exact set readback and independent readback both matched; dimensionality read back as 3.
- Interior TwoD roving was applied, read back as true, then reset deterministically.
- ThreeD Auto-Bezier was applied as host-shaped state. AE generated incoming tangent `[-76.6666641235352, 3.33333325386047, 13.3333330154419]` and outgoing tangent `[76.6666641235352, -3.33333325386047, -13.3333330154419]`; both remained stable on repeated `NO_OP` application.
- Repeated identical manual and Auto-Bezier requests returned `NO_OP` without advancing project revision.

Accepted P1 rejection/no-mutation evidence:

- non-spatial property -> `SPATIAL_PROPERTY_REQUIRED`;
- 3-component tangent supplied to the TwoD property -> `SPATIAL_TANGENT_DIMENSION_MISMATCH` with expected 2 / actual 3;
- roving requested on key 1 -> `ROVING_ENDPOINT_FORBIDDEN`;
- caller tangent supplied in `AUTO_BEZIER` mode -> `AUTO_BEZIER_TANGENTS_FORBIDDEN`;
- stale host revision -> `HOST_REVISION_CONFLICT`.

For every P1 case, host revision and project fingerprint remained unchanged, and applicable spatial state remained unchanged. Cleanup removed both managed null rigs and the temporary composition, restored the baseline item count, restored the exact baseline project fingerprint, and reported no cleanup errors.

## Maturity

Protocol 1.9 has now passed **P1 and P2** in real After Effects. The capability remains **PARTIAL** because Human-Parity promotion still requires viewer-visible behavior, injected-failure rollback evidence, and transfer/reconnect evidence.

Remaining sequence:

- **P3:** viewer-visible motion-path proof demonstrating a materially different spatial path while preserving controlled endpoints/state.
- **P4:** failure injection after spatial mutation begins, with exact tangent/continuity/Auto-Bezier/roving rollback readback plus project-state recovery.
- **P5:** save/reopen/reconnect transfer proof on a separate spatial-motion case.

Existing temporal interpolation/ease acceptance remains authoritative and unchanged. Protocol 1.9 must not become the ordinary installer/default CEP negotiation route until the remaining acceptance gates justify that promotion.

## Next integration gate

Build P3/P4 on top of the accepted P1/P2 artifact rather than reconstructing the fixture assumptions. P3 should prove viewer-visible spatial-path behavior, and P4 should prove transaction rollback after a real write has begun. P5 remains a separate save/reopen/reconnect transfer gate.
