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
2. Tangent vectors must contain exactly two or three finite values respectively.
3. Roving may be enabled only on interior keys; first and last keys are rejected rather than silently accepted.
4. Mutations require the expected live host revision.
5. Applied state is structurally read back and compared.
6. If mutation/readback fails after a write begins, the prior spatial state is restored.

These rules correspond to the After Effects scripting property surface: `keyInSpatialTangent`, `keyOutSpatialTangent`, `setSpatialTangentsAtKey`, `key/setSpatialContinuousAtKey`, `key/setSpatialAutoBezierAtKey`, and `key/setRovingAtKey`.

## Maturity

The capability is intentionally **PARTIAL / DECLARED** in this foundation commit. Source-contract tests are not evidence that After Effects executed the behavior correctly.

Promotion sequence:

- P1/P2: live AE mutation + exact structural readback, including TwoD/ThreeD dimensionality and endpoint-roving rejection.
- P3: viewer-visible motion-path proof demonstrating materially different spatial paths.
- P4: failure injection + rollback proof.
- P5: save/reopen/reconnect transfer proof on a separate spatial-motion case.

Only accepted evidence may promote proof maturity. Existing temporal interpolation/ease acceptance remains authoritative and unchanged.

## Next integration gate

After P1/P2 passes, protocol 1.9 should be added to CEP negotiation/installer defaults and a dedicated self-hosted real-AE workflow, following the additive versioning pattern used by protocol 1.8.
