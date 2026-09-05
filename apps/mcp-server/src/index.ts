export const EDITFLOW_VERSION = "0.1.0-dev.0" as const;
export const EDITFLOW_PHASE = "M0_GREENFIELD_FOUNDATION" as const;

export interface McpServerStatus {
  readonly version: typeof EDITFLOW_VERSION;
  readonly phase: typeof EDITFLOW_PHASE;
  readonly adobeWritesEnabled: false;
}

export const getMcpServerStatus = (): McpServerStatus => ({
  version: EDITFLOW_VERSION,
  phase: EDITFLOW_PHASE,
  adobeWritesEnabled: false,
});
