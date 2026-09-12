import type { CapabilityAdapterDeclaration, CapabilityRegistry } from "../../../packages/capability-registry/src/index.js";
import { M3_COMPOSITE_CAPABILITIES_V13 } from "../../../packages/adapters/ae-cep/src/m3-composite.js";
import { M3_LAYER_CONTROLS_CAPABILITIES_V16 } from "../../../packages/adapters/ae-cep/src/m3-layer-controls.js";
import { M3_MARKER_MOTION_CAPABILITIES_V20 } from "../../../packages/adapters/ae-cep/src/m3-marker-motion.js";
import { M3_MASK_CAPABILITIES_V12 } from "../../../packages/adapters/ae-cep/src/m3-mask.js";
import { M3_NULL_RIG_CAPABILITIES_V15 } from "../../../packages/adapters/ae-cep/src/m3-null-rig.js";
import { M3_PARENTING_CAPABILITIES_V14 } from "../../../packages/adapters/ae-cep/src/m3-parenting.js";
import { M3_SPATIAL_GRAPH_CAPABILITIES_V19 } from "../../../packages/adapters/ae-cep/src/m3-spatial-graph.js";
import { M3_TEMPORAL_EASE_CAPABILITIES_V18 } from "../../../packages/adapters/ae-cep/src/m3-temporal-ease.js";
import { M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17 } from "../../../packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import { M4_POINT_TRACKING_CAPABILITIES_V21 } from "../../../packages/adapters/ae-cep/src/m4-point-tracking.js";
import { M4_TWO_POINT_TRACKING_CAPABILITY_V1 } from "../../../packages/adapters/ae-cep/src/m4-two-point-tracking.js";
import {
  capabilityForTrackerAnalysisDriverV1,
  type TrackerVisualAnalysisDriverV1,
} from "../../../packages/adapters/ae-cep/src/m4-tracker-analysis.js";

/**
 * Single composition point for every M3 capability family that has reached an
 * accepted real-AE evidence level. New M3 families must be added here only after
 * their proof-maturity projection has been updated from retained acceptance
 * evidence; declared/draft capability arrays do not belong in the live runtime.
 */
export const AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS: readonly CapabilityAdapterDeclaration[] = Object.freeze([
  Object.freeze({ adapterId: "ae-cep.m3.mask", adapterVersion: "1.2.0", priority: 112, capabilities: M3_MASK_CAPABILITIES_V12 }),
  Object.freeze({ adapterId: "ae-cep.m3.composite", adapterVersion: "1.3.0", priority: 113, capabilities: M3_COMPOSITE_CAPABILITIES_V13 }),
  Object.freeze({ adapterId: "ae-cep.m3.parenting", adapterVersion: "1.4.0", priority: 114, capabilities: M3_PARENTING_CAPABILITIES_V14 }),
  Object.freeze({ adapterId: "ae-cep.m3.null-rig", adapterVersion: "1.5.0", priority: 115, capabilities: M3_NULL_RIG_CAPABILITIES_V15 }),
  Object.freeze({ adapterId: "ae-cep.m3.layer-controls", adapterVersion: "1.6.0", priority: 116, capabilities: M3_LAYER_CONTROLS_CAPABILITIES_V16 }),
  Object.freeze({ adapterId: "ae-cep.m3.temporal-interpolation", adapterVersion: "1.7.0", priority: 117, capabilities: M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17 }),
  Object.freeze({ adapterId: "ae-cep.m3.temporal-ease", adapterVersion: "1.8.0", priority: 118, capabilities: M3_TEMPORAL_EASE_CAPABILITIES_V18 }),
  Object.freeze({ adapterId: "ae-cep.m3.spatial-graph", adapterVersion: "1.9.0", priority: 119, capabilities: M3_SPATIAL_GRAPH_CAPABILITIES_V19 }),
  Object.freeze({ adapterId: "ae-cep.m3.marker-motion", adapterVersion: "2.0.0", priority: 120, capabilities: M3_MARKER_MOTION_CAPABILITIES_V20 }),
]);

export const AE_ACCEPTED_M3_RUNTIME_PROTOCOLS = Object.freeze([
  "1.2.0",
  "1.3.0",
  "1.4.0",
  "1.5.0",
  "1.6.0",
  "1.7.0",
  "1.8.0",
  "1.9.0",
  "2.0.0",
] as const);

export const registerAcceptedM3RuntimeCapabilities = (registry: CapabilityRegistry): void => {
  for (const declaration of AE_ACCEPTED_M3_RUNTIME_CAPABILITY_GROUPS) {
    registry.registerAdapter(declaration);
  }
};

export interface M4TrackerRuntimeRegistrationV1 {
  readonly pointTrackingV21Available: boolean;
  readonly visualDriver: TrackerVisualAnalysisDriverV1 | null;
}

export const registerAcceptedM4TrackerRuntimeCapabilities = (
  registry: CapabilityRegistry,
  registration: M4TrackerRuntimeRegistrationV1,
): void => {
  if (!registration.pointTrackingV21Available) return;
  registry.registerAdapter({
    adapterId: "ae-cep.m4.point-tracking",
    adapterVersion: "2.1.0",
    priority: 121,
    capabilities: M4_POINT_TRACKING_CAPABILITIES_V21,
  });
  registry.registerAdapter({
    adapterId: "ae-cep.m4.two-point-tracking",
    adapterVersion: "0.5.0-dev.1",
    priority: 122,
    capabilities: [M4_TWO_POINT_TRACKING_CAPABILITY_V1],
  });
  const analysis = capabilityForTrackerAnalysisDriverV1(registration.visualDriver);
  if (!analysis.routes.some((route) => route.available)) return;
  registry.registerAdapter({
    adapterId: "ae-cep.m4.tracker-analysis",
    adapterVersion: "0.5.0-dev.2",
    priority: 123,
    capabilities: [analysis],
  });
};
