export type EffectSchemaStatusV1 = "PROOF_REQUIRED" | "CERTIFIED";

export interface EffectSchemaPropertyBindingV1 {
  readonly semanticParameter: string;
  readonly propertyPath: readonly (string | number)[];
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

const schemas = new Map<string, EffectSchemaV1>([
  [MOTION_TILE_EFFECT_SCHEMA_V1.schemaId, MOTION_TILE_EFFECT_SCHEMA_V1],
]);

export const getEffectSchemaV1 = (schemaId: string): EffectSchemaV1 | null =>
  schemas.get(schemaId) ?? null;

export const EFFECT_SCHEMAS_V1: readonly EffectSchemaV1[] =
  Object.freeze([...schemas.values()]);
