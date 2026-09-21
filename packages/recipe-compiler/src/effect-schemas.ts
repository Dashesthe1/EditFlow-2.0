export type EffectSchemaStatusV1 = "PROOF_REQUIRED" | "CERTIFIED";

export type EffectSchemaValueAdapterV1 =
  | "IDENTITY"
  | "NEGATIVE_FRAMES_TO_SECONDS"
  | "MULTIPLY_BY_PARAMETER"
  | "NORMALIZED_POINT_TO_COMP_PIXELS";

export interface EffectSchemaPropertyBindingV1 {
  readonly semanticParameter: string;
  readonly propertyPath: readonly (string | number)[];
  readonly valueAdapter?: EffectSchemaValueAdapterV1;
  readonly scaleParameter?: string;
  readonly scaleRange?: readonly [number, number];
}

export interface EffectSchemaV1 {
  readonly schemaId: string;
  readonly effectMatchName: string;
  readonly status: EffectSchemaStatusV1;
  readonly propertyBindings: readonly EffectSchemaPropertyBindingV1[];
  readonly proofRef?: string;
}

export const MOTION_TILE_EFFECT_SCHEMA_V1: EffectSchemaV1 = Object.freeze({
  schemaId: "ae.effect-schema.motion-tile.v1",
  effectMatchName: "ADBE Tile",
  status: "CERTIFIED",
  proofRef: "proofs/diagnostics/m5-motion-tile-effect-schema-proof.json",
  propertyBindings: Object.freeze([
    Object.freeze({
      semanticParameter: "outputWidth",
      propertyPath: Object.freeze(["ADBE Tile-0004"]),
    }),
    Object.freeze({
      semanticParameter: "outputHeight",
      propertyPath: Object.freeze(["ADBE Tile-0005"]),
    }),
    Object.freeze({
      semanticParameter: "mirrorEdges",
      propertyPath: Object.freeze(["ADBE Tile-0006"]),
    }),
  ]),
});

export const M6_ECHO_EFFECT_SCHEMA_PROPOSAL_V1: EffectSchemaV1 = Object.freeze({
  schemaId: "ae.effect-schema.m6.echo.v1",
  effectMatchName: "ADBE Echo",
  status: "PROOF_REQUIRED",
  propertyBindings: Object.freeze([
    Object.freeze({
      semanticParameter: "echoSpacingFrames",
      propertyPath: Object.freeze(["ADBE Echo-0001"]),
      valueAdapter: "NEGATIVE_FRAMES_TO_SECONDS" as const,
    }),
    Object.freeze({ semanticParameter: "numberOfEchoes", propertyPath: Object.freeze(["ADBE Echo-0002"]) }),
    Object.freeze({ semanticParameter: "startingIntensity", propertyPath: Object.freeze(["ADBE Echo-0003"]) }),
    Object.freeze({ semanticParameter: "decay", propertyPath: Object.freeze(["ADBE Echo-0004"]) }),
  ]),
});

export const M6_CC_SMEAR_EFFECT_SCHEMA_PROPOSAL_V1: EffectSchemaV1 = Object.freeze({
  schemaId: "ae.effect-schema.m6.cc-smear.v1",
  effectMatchName: "CC Smear",
  status: "PROOF_REQUIRED",
  propertyBindings: Object.freeze([
    Object.freeze({
      semanticParameter: "smearFromNormalized",
      propertyPath: Object.freeze(["CC Smear-0001"]),
      valueAdapter: "NORMALIZED_POINT_TO_COMP_PIXELS" as const,
    }),
    Object.freeze({
      semanticParameter: "smearToNormalized",
      propertyPath: Object.freeze(["CC Smear-0002"]),
      valueAdapter: "NORMALIZED_POINT_TO_COMP_PIXELS" as const,
    }),
    Object.freeze({
      semanticParameter: "smearReach",
      propertyPath: Object.freeze(["CC Smear-0003"]),
      valueAdapter: "MULTIPLY_BY_PARAMETER" as const,
      scaleParameter: "smearReachScale",
      scaleRange: Object.freeze([0.25, 4] as const),
    }),
    Object.freeze({
      semanticParameter: "smearRadius",
      propertyPath: Object.freeze(["CC Smear-0004"]),
      valueAdapter: "MULTIPLY_BY_PARAMETER" as const,
      scaleParameter: "smearRadiusScale",
      scaleRange: Object.freeze([0.25, 4] as const),
    }),
  ]),
});

export const M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V1: EffectSchemaV1 = Object.freeze({
  schemaId: "ae.effect-schema.m6.turbulent-displace.v1",
  effectMatchName: "ADBE Turbulent Displace",
  status: "PROOF_REQUIRED",
  propertyBindings: Object.freeze([
    Object.freeze({
      semanticParameter: "distortionAmount",
      propertyPath: Object.freeze(["ADBE Turbulent Displace-0002"]),
      valueAdapter: "MULTIPLY_BY_PARAMETER" as const,
      scaleParameter: "distortionStrengthScale",
      scaleRange: Object.freeze([0.25, 4] as const),
    }),
    Object.freeze({
      semanticParameter: "distortionSize",
      propertyPath: Object.freeze(["ADBE Turbulent Displace-0003"]),
      valueAdapter: "MULTIPLY_BY_PARAMETER" as const,
      scaleParameter: "distortionSizeScale",
      scaleRange: Object.freeze([0.25, 4] as const),
    }),
    Object.freeze({
      semanticParameter: "distortionComplexity",
      propertyPath: Object.freeze(["ADBE Turbulent Displace-0005"]),
      valueAdapter: "MULTIPLY_BY_PARAMETER" as const,
      scaleParameter: "distortionComplexityScale",
      scaleRange: Object.freeze([0.5, 2] as const),
    }),
  ]),
});

export const M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V2: EffectSchemaV1 = Object.freeze({
  schemaId: "ae.effect-schema.m6.turbulent-displace.v2",
  effectMatchName: "ADBE Turbulent Displace",
  status: "PROOF_REQUIRED",
  propertyBindings: Object.freeze([
    ...M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V1.propertyBindings,
    Object.freeze({
      semanticParameter: "distortionEvolution",
      propertyPath: Object.freeze(["ADBE Turbulent Displace-0006"]),
      valueAdapter: "MULTIPLY_BY_PARAMETER" as const,
      scaleParameter: "distortionEvolutionScale",
      scaleRange: Object.freeze([0.25, 4] as const),
    }),
  ]),
});

// v3 intentionally retains the proven v2 property map and adds no new static
// assumptions. Its distinct schema id gates the new event-local property-expression
// realization so retained v2 evidence remains authoritative and uninvalidated.
export const M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V3: EffectSchemaV1 = Object.freeze({
  schemaId: "ae.effect-schema.m6.turbulent-displace.v3",
  effectMatchName: "ADBE Turbulent Displace",
  status: "PROOF_REQUIRED",
  propertyBindings: M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V2.propertyBindings,
});

const schemas = new Map<string, EffectSchemaV1>([
  [MOTION_TILE_EFFECT_SCHEMA_V1.schemaId, MOTION_TILE_EFFECT_SCHEMA_V1],
  [M6_ECHO_EFFECT_SCHEMA_PROPOSAL_V1.schemaId, M6_ECHO_EFFECT_SCHEMA_PROPOSAL_V1],
  [M6_CC_SMEAR_EFFECT_SCHEMA_PROPOSAL_V1.schemaId, M6_CC_SMEAR_EFFECT_SCHEMA_PROPOSAL_V1],
  [M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V1.schemaId, M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V1],
  [M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V2.schemaId, M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V2],
  [M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V3.schemaId, M6_TURBULENT_DISPLACE_EFFECT_SCHEMA_PROPOSAL_V3],
]);

export const getEffectSchemaV1 = (schemaId: string): EffectSchemaV1 | null =>
  schemas.get(schemaId) ?? null;

export const EFFECT_SCHEMAS_V1: readonly EffectSchemaV1[] =
  Object.freeze([...schemas.values()]);
