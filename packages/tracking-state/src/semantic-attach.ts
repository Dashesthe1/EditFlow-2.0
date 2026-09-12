export const SEMANTIC_ATTACH_BOUNDING_BOX_ANCHORS_V1 = [
  "CENTER",
  "TOP",
  "BOTTOM",
  "LEFT",
  "RIGHT",
  "TOP_LEFT",
  "TOP_RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM_RIGHT",
] as const;

export type SemanticAttachBoundingBoxAnchorV1 =
  (typeof SEMANTIC_ATTACH_BOUNDING_BOX_ANCHORS_V1)[number];

export interface SemanticLandmarkObservationV1 {
  readonly x: number;
  readonly y: number;
  readonly confidence: number;
  readonly evidenceIds?: readonly string[];
}

/**
 * Minimal normalized scene-entity geometry consumed by the semantic attach resolver.
 * Upstream scene intelligence remains authoritative for detection and classification.
 */
export interface SemanticSceneEntityGeometryV1 {
  readonly semanticId: string;
  readonly entityClass: string;
  /** Normalized [x, y, width, height], all relative to the scene/comp extent. */
  readonly boundingBox: readonly [number, number, number, number];
  readonly confidence: number;
  readonly landmarks?: Readonly<Record<string, SemanticLandmarkObservationV1>>;
  readonly evidenceIds?: readonly string[];
}

export type SemanticAttachTargetV1 =
  | {
      readonly kind: "BOUNDING_BOX";
      readonly anchor: SemanticAttachBoundingBoxAnchorV1;
    }
  | {
      readonly kind: "LANDMARK";
      /** Exact upstream semantic landmark name, e.g. `left_hand` or `nose_tip`. */
      readonly landmark: string;
    };

export interface SemanticAttachQueryV1 {
  /** Exact entity identity. Preferred whenever the planner already has a bound subject. */
  readonly semanticId?: string;
  /** Optional exact class constraint, or sole selector only when exactly one entity matches. */
  readonly entityClass?: string;
  readonly target: SemanticAttachTargetV1;
  readonly minConfidence?: number;
  readonly compWidth?: number;
  readonly compHeight?: number;
}

export interface SemanticAttachResolutionV1 {
  readonly semanticId: string;
  readonly entityClass: string;
  readonly source: "BOUNDING_BOX" | "LANDMARK";
  readonly anchor: SemanticAttachBoundingBoxAnchorV1 | null;
  readonly landmark: string | null;
  readonly pointNormalized: readonly [number, number];
  readonly pointCompPx: readonly [number, number] | null;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

const finite01 = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const validBoundingBox = (
  value: readonly [number, number, number, number],
): boolean => {
  const [x, y, width, height] = value;
  return [x, y, width, height].every(finite01)
    && width > 0
    && height > 0
    && x + width <= 1 + Number.EPSILON
    && y + height <= 1 + Number.EPSILON;
};

const validEntity = (entity: SemanticSceneEntityGeometryV1): boolean =>
  entity.semanticId.trim().length > 0
  && entity.entityClass.trim().length > 0
  && finite01(entity.confidence)
  && validBoundingBox(entity.boundingBox);

const validCompExtent = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

const boundingBoxAnchorPoint = (
  box: readonly [number, number, number, number],
  anchor: SemanticAttachBoundingBoxAnchorV1,
): readonly [number, number] => {
  const [x, y, width, height] = box;
  const left = x;
  const right = x + width;
  const top = y;
  const bottom = y + height;
  const centerX = x + (width / 2);
  const centerY = y + (height / 2);
  switch (anchor) {
    case "CENTER": return [centerX, centerY];
    case "TOP": return [centerX, top];
    case "BOTTOM": return [centerX, bottom];
    case "LEFT": return [left, centerY];
    case "RIGHT": return [right, centerY];
    case "TOP_LEFT": return [left, top];
    case "TOP_RIGHT": return [right, top];
    case "BOTTOM_LEFT": return [left, bottom];
    case "BOTTOM_RIGHT": return [right, bottom];
  }
};

const selectEntity = (
  entities: readonly SemanticSceneEntityGeometryV1[],
  query: SemanticAttachQueryV1,
): SemanticSceneEntityGeometryV1 | null => {
  const semanticId = query.semanticId?.trim();
  const entityClass = query.entityClass?.trim();
  if (!semanticId && !entityClass) return null;

  const candidates = entities.filter((entity) => {
    if (!validEntity(entity)) return false;
    if (semanticId && entity.semanticId !== semanticId) return false;
    if (entityClass && entity.entityClass !== entityClass) return false;
    return true;
  });

  // Class-only selection is deliberately fail-closed when more than one entity matches.
  return candidates.length === 1 ? candidates[0]! : null;
};

const normalizedToComp = (
  point: readonly [number, number],
  query: SemanticAttachQueryV1,
): readonly [number, number] | null => {
  const hasWidth = query.compWidth !== undefined;
  const hasHeight = query.compHeight !== undefined;
  if (!hasWidth && !hasHeight) return null;
  if (!validCompExtent(query.compWidth) || !validCompExtent(query.compHeight)) return null;
  return [point[0] * query.compWidth, point[1] * query.compHeight];
};

/**
 * Resolve an already-observed semantic entity into an explicit attach point.
 *
 * This is a resolver, not a detector: it never invents an entity or landmark and never picks an
 * arbitrary entity from an ambiguous class-only query. Bounding-box anchors are derivable geometry;
 * named landmarks require exact upstream evidence.
 */
export const resolveSemanticAttachPointV1 = (
  entities: readonly SemanticSceneEntityGeometryV1[],
  query: SemanticAttachQueryV1,
): SemanticAttachResolutionV1 | null => {
  const minConfidence = query.minConfidence ?? 0;
  if (!finite01(minConfidence)) return null;
  if ((query.compWidth === undefined) !== (query.compHeight === undefined)) return null;

  const entity = selectEntity(entities, query);
  if (!entity || entity.confidence < minConfidence) return null;

  if (query.target.kind === "BOUNDING_BOX") {
    const pointNormalized = boundingBoxAnchorPoint(entity.boundingBox, query.target.anchor);
    const pointCompPx = normalizedToComp(pointNormalized, query);
    if ((query.compWidth !== undefined || query.compHeight !== undefined) && !pointCompPx) return null;
    return {
      semanticId: entity.semanticId,
      entityClass: entity.entityClass,
      source: "BOUNDING_BOX",
      anchor: query.target.anchor,
      landmark: null,
      pointNormalized,
      pointCompPx,
      confidence: entity.confidence,
      evidenceIds: [...new Set(entity.evidenceIds ?? [])],
    };
  }

  const landmarkName = query.target.landmark.trim();
  if (!landmarkName) return null;
  const landmark = entity.landmarks?.[landmarkName];
  if (!landmark || !finite01(landmark.x) || !finite01(landmark.y) || !finite01(landmark.confidence)) {
    return null;
  }
  const confidence = Math.min(entity.confidence, landmark.confidence);
  if (confidence < minConfidence) return null;
  const pointNormalized: readonly [number, number] = [landmark.x, landmark.y];
  const pointCompPx = normalizedToComp(pointNormalized, query);
  if ((query.compWidth !== undefined || query.compHeight !== undefined) && !pointCompPx) return null;
  return {
    semanticId: entity.semanticId,
    entityClass: entity.entityClass,
    source: "LANDMARK",
    anchor: null,
    landmark: landmarkName,
    pointNormalized,
    pointCompPx,
    confidence,
    evidenceIds: [...new Set([...(entity.evidenceIds ?? []), ...(landmark.evidenceIds ?? [])])],
  };
};
