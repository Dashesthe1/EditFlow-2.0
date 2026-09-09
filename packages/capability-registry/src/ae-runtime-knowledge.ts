import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
  type CapabilityStatus,
  type EnvironmentFingerprint,
} from "../../core-contracts/src/index.js";
import type { AeRuntimeKnowledgeSnapshot } from "../../ae-object-model/src/knowledge.js";
import type { CapabilityAdapterDeclaration } from "./index.js";

export const AE_RUNTIME_KNOWLEDGE_ADAPTER_ID = "ae-runtime-knowledge" as const;
export const AE_RUNTIME_KNOWLEDGE_ROUTE_ID = asRouteId("route.ae.runtime_knowledge");

const capability = (
  snapshot: AeRuntimeKnowledgeSnapshot,
  environmentFingerprint: EnvironmentFingerprint,
  id: string,
  domain: string,
  description: string,
  status: CapabilityStatus,
  limitations: readonly string[],
): CapabilityRecord => ({
  id: asCapabilityId(id),
  domain,
  description,
  status,
  proofMaturity: "STRUCTURAL",
  routes: [{
    routeId: AE_RUNTIME_KNOWLEDGE_ROUTE_ID,
    kind: "HOST_ADAPTER",
    available: true,
    adapterVersion: snapshot.profilerVersion,
    limitations,
  }],
  requiredEnvironment: {
    hostName: snapshot.host.name,
    hostVersion: snapshot.host.version,
    hostBuildName: snapshot.host.buildName,
    hostBuildNumber: snapshot.host.buildNumber,
    profilerVersion: snapshot.profilerVersion,
  },
  inputSchemaRef: null,
  outputSchemaRef: null,
  readbackStrategy: "READ_ONLY_RUNTIME_INTROSPECTION",
  visualProofProfile: null,
  rollbackStrategy: "NO_MUTATION",
  riskClass: "R0_READ_ONLY",
  lastVerifiedEnvironmentFingerprint: environmentFingerprint,
  limitations,
  fallbackPolicy: "FORBID",
});

/**
 * Converts a successful live AE knowledge capture into ordinary capability
 * declarations. Discovery is evidence, not an editing proof: it makes the
 * inspection routes structurally available but does not promote discovered
 * effect/property controls to FULL editing capabilities.
 */
export const createAeRuntimeKnowledgeDeclaration = (
  snapshot: AeRuntimeKnowledgeSnapshot,
  environmentFingerprint: EnvironmentFingerprint,
): CapabilityAdapterDeclaration => {
  const reflectionLimitations = snapshot.applicationReflection === null
    ? ["Application reflection was unavailable in this capture."]
    : [];
  const propertyLimitations = [
    "Property graph discovery is observational and covers the active composition/layers present during capture.",
    "A discovered property is not considered safely writable until its EditFlow operation passes the normal proof ladder.",
    ...(snapshot.activeComposition === null ? ["No active composition was available during this capture."] : []),
    ...snapshot.warnings,
  ];

  return {
    adapterId: AE_RUNTIME_KNOWLEDGE_ADAPTER_ID,
    adapterVersion: snapshot.profilerVersion,
    priority: 100,
    capabilities: [
      capability(
        snapshot,
        environmentFingerprint,
        "ae.runtime.knowledge.inspect",
        "environment",
        "Capture a deterministic knowledge snapshot from the installed After Effects runtime without mutating the project.",
        "FULL",
        snapshot.warnings,
      ),
      capability(
        snapshot,
        environmentFingerprint,
        "ae.host.reflection.inspect",
        "environment",
        "Inspect the ExtendScript reflection surface exposed by the installed After Effects host.",
        snapshot.applicationReflection === null ? "PARTIAL" : "FULL",
        reflectionLimitations,
      ),
      capability(
        snapshot,
        environmentFingerprint,
        "ae.effect.catalog.inspect",
        "effect",
        "Enumerate installed After Effects effects and their stable matchName identifiers and versions.",
        "FULL",
        [],
      ),
      capability(
        snapshot,
        environmentFingerprint,
        "ae.property.graph.inspect",
        "property",
        "Inspect existing layer/property hierarchies, stable matchName identifiers and writable/animatable metadata.",
        "PARTIAL",
        propertyLimitations,
      ),
    ],
  };
};
