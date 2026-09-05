export const AE_OBJECT_KINDS = [
  "FOLDER",
  "FOOTAGE",
  "COMPOSITION",
  "LAYER_AV",
  "LAYER_TEXT",
  "LAYER_SHAPE",
  "LAYER_CAMERA",
  "LAYER_LIGHT",
  "LAYER_NULL",
  "LAYER_UNKNOWN",
  "EFFECT",
] as const;
export type AeObjectKind = (typeof AE_OBJECT_KINDS)[number];

export interface AeTransformSnapshot {
  readonly anchorPoint?: readonly number[];
  readonly position?: readonly number[];
  readonly scale?: readonly number[];
  readonly rotation?: number;
  readonly opacity?: number;
}

export interface AeLayerSnapshot {
  readonly hostId: number | null;
  readonly stableId: string | null;
  readonly index: number;
  readonly name: string;
  readonly kind: AeObjectKind;
  readonly sourceHostId: number | null;
  readonly sourceStableId: string | null;
  readonly startTime: number;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly stretch: number;
  readonly parentStableId: string | null;
  readonly transform: AeTransformSnapshot;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly shy: boolean;
  readonly solo: boolean;
  readonly threeDLayer: boolean;
  readonly adjustmentLayer: boolean;
}

export interface AeCompositionSnapshot {
  readonly hostId: number;
  readonly stableId: string | null;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly pixelAspect: number;
  readonly duration: number;
  readonly frameRate: number;
  readonly displayStartTime: number;
  readonly layers: readonly AeLayerSnapshot[];
}

export interface AeProjectItemSnapshot {
  readonly hostId: number;
  readonly stableId: string | null;
  readonly kind: "FOLDER" | "FOOTAGE" | "COMPOSITION";
  readonly name: string;
  readonly parentHostId: number | null;
  readonly comment: string;
  readonly composition?: AeCompositionSnapshot;
}

export interface AeProjectSnapshot {
  readonly hostRevision: number;
  readonly filePath: string | null;
  readonly activeItemHostId: number | null;
  readonly itemCount: number;
  readonly items: readonly AeProjectItemSnapshot[];
}

export interface AeEnvironmentProbe {
  readonly adapterProtocolVersion: string;
  readonly adapterBuild: string;
  readonly hostName: "Adobe After Effects";
  readonly hostVersion: string;
  readonly hostBuild: string | null;
  readonly os: string | null;
  readonly projectOpen: boolean;
}

export interface AeAffectedObjectRef {
  readonly stableId: string;
  readonly hostId: number | null;
  readonly kind: AeObjectKind;
}

export const toAeStructuralFingerprintInput = (project: AeProjectSnapshot): unknown => ({
  hostRevision: project.hostRevision,
  filePath: project.filePath,
  itemCount: project.itemCount,
  items: project.items.map((item) => ({
    hostId: item.hostId,
    stableId: item.stableId,
    kind: item.kind,
    name: item.name,
    parentHostId: item.parentHostId,
    composition: item.composition === undefined ? null : {
      hostId: item.composition.hostId,
      stableId: item.composition.stableId,
      name: item.composition.name,
      width: item.composition.width,
      height: item.composition.height,
      pixelAspect: item.composition.pixelAspect,
      duration: item.composition.duration,
      frameRate: item.composition.frameRate,
      displayStartTime: item.composition.displayStartTime,
      layers: item.composition.layers.map((layer) => ({
        hostId: layer.hostId,
        stableId: layer.stableId,
        index: layer.index,
        name: layer.name,
        kind: layer.kind,
        sourceHostId: layer.sourceHostId,
        sourceStableId: layer.sourceStableId,
        startTime: layer.startTime,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        stretch: layer.stretch,
        parentStableId: layer.parentStableId,
        transform: layer.transform,
        enabled: layer.enabled,
        locked: layer.locked,
        shy: layer.shy,
        solo: layer.solo,
        threeDLayer: layer.threeDLayer,
        adjustmentLayer: layer.adjustmentLayer,
      })),
    },
  })),
});

export const toAeEnvironmentFingerprintInput = (environment: AeEnvironmentProbe): unknown => ({
  adapterProtocolVersion: environment.adapterProtocolVersion,
  adapterBuild: environment.adapterBuild,
  hostName: environment.hostName,
  hostVersion: environment.hostVersion,
  hostBuild: environment.hostBuild,
  os: environment.os,
});
