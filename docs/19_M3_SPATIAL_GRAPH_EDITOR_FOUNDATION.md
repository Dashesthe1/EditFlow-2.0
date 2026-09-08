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
- Adobe CEP 12 Debugging Handbook: https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/Debugging%20Handbook.md

The Property reference is the authority for spatial-property-only APIs, 2D/3D tangent cardinality, and the first/last-key roving restriction. The CEP handbook is the authority for the isolated Windows proof runner's temporary `CSXS.12` LogLevel 6 diagnostics and `%TEMP%` CEP/CEPHtmlEngine failure-log capture.

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

The first real-AE spatial P1/P2 launch reached a healthy After Effects 25.6.6 project window and executed the fixed `EditFlow 2.0 Bridge` menu command, but the CEP panel did not register with the broker before the timeout. The proof artifact contained no panel session, no host probe, no command responses, no spatial evidence, and no checks, so no project/spatial operation had begun. The runner then restored the workstation to zero After Effects processes.

This matches a previously observed pre-command registration failure in the accepted temporal-ease proof lineage. To make the spatial proof resilient to that infrastructure-only failure without weakening any spatial assertion, the self-hosted wrapper now permits exactly one fresh launch retry only when all of these conditions are true:

- `failureError` contains `CEP_PANEL_REGISTRATION_TIMEOUT`;
- `panel` is null;
- `environment` is null;
- the response array is empty;
- the evidence array is empty;
- the checks object has no properties;
- the failed generated runner has returned the machine to zero `AfterFX` processes.

The failed attempt's result, panel-bootstrap evidence, startup diagnostics, and CEP diagnostics are retained in `panel-registration-retry-attempt-1` before the fresh launch. There are at most two total registration attempts. Any attempt that reaches a broker/AE command, produces structural evidence, or fails a spatial assertion is not retryable and remains a hard proof failure.

### P1 matrix

P1 must prove deterministic rejection without project-revision, project-fingerprint, or applicable spatial-state mutation for:

- a non-spatial property;
- wrong 2D tangent dimensionality;
- attempted roving on an endpoint key;
- manual tangent fields supplied in `AUTO_BEZIER` mode;
- stale host project revision.

### P2 matrix

P2 creates disposable 2D and 3D null layers, adds three Position keys, and proves through live AE readback:

- exact manual 2D incoming/outgoing tangent vectors;
- exact manual 3D incoming/outgoing tangent vectors;
- correct 2D/3D spatial dimensionality reported by the host;
- interior roving can be enabled, read back, and reset;
- 3D Auto-Bezier is enabled and returns finite three-component host-generated tangent vectors;
- repeated identical manual and Auto-Bezier requests are `NO_OP` and do not advance project revision;
- all temporary project objects are removed and the pre-proof item count/fingerprint are restored.

The P1/P2 wrapper fails closed if any P3/P4/P5 claim appears. A successful source/CI run alone still does not promote proof maturity.

## Maturity

The capability remains intentionally **PARTIAL / DECLARED** until live After Effects acceptance evidence is produced and reviewed. Source-contract tests are not evidence that After Effects executed the behavior correctly.

Promotion sequence:

- P1/P2: live AE mutation + exact structural readback, including TwoD/ThreeD dimensionality and endpoint-roving rejection.
- P3: viewer-visible motion-path proof demonstrating materially different spatial paths.
- P4: failure injection + rollback proof.
- P5: save/reopen/reconnect transfer proof on a separate spatial-motion case.

Only accepted evidence may promote proof maturity. Existing temporal interpolation/ease acceptance remains authoritative and unchanged.

## Next integration gate

After the dedicated P1/P2 workflow passes on the self-hosted After Effects workstation and its artifact is reviewed, protocol 1.9 can be considered for normal CEP negotiation/installer defaults. P3/P4/P5 remain separate gates; P1/P2 acceptance must not be treated as full Human-Parity completion.
