export type EffectSchemaStatusV1 = "PROOF_REQUIRED" | "CERTIFIED";

export type EffectSchemaValueAdapterV1 =
  | "IDENTITY"
  | "NEGATIVE_FRAMES_TO_SECONDS";

export interface EffectSchemaPropertyBindingV1 {
  readonly semanticParameter: string;
  readonly propertyPath: readonly (string | number)[];
  readonly valueAdapter?: EffectSchemaValueAdapterV1;
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

const schemas = new Map<string, EffectSchemaV1>([
  [MOTION_TILE_EFFECT_SCHEMA_V1.schemaId, MOTION_TILE_EFFECT_SCHEMA_V1],
  [M6_ECHO_EFFECT_SCHEMA_PROPOSAL_V1.schemaId, M6_ECHO_EFFECT_SCHEMA_PROPOSAL_V1],
]);

export const getEffectSchemaV1 = (schemaId: string): EffectSchemaV1 | null =>
  schemas.get(schemaId) ?? null;

export const EFFECT_SCHEMAS_V1: readonly EffectSchemaV1[] =
  Object.freeze([...schemas.values()]);
