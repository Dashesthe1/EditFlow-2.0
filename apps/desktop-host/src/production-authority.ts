export const PRIMARY_EDIT_PRODUCTION_SYSTEM_V1 = "DURABLE_PRODUCTION_QUEUE_V1" as const;

// Tombstones identify removed APIs; no handler or alias executes these paths.
export const RETIRED_EDIT_EXECUTION_PATHS_V1 = new Set([
  "/run", "/run-batch", "/run-transaction", "/run-correction-transaction", "/proof-script",
  "/mutation-lease/acquire", "/mutation-lease/release",
  "/v1/product/control/run", "/v1/product/control/run-batch",
  "/v1/product/control/execute", "/v1/product/control/correction", "/v1/product/control/build-baseline",
]);

export const retiredEditExecutionResponseV1 = () => ({
  error: "EDIT_EXECUTION_PATH_REMOVED",
  primarySystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1,
  nextAction: "Submit authorized work to /v1/product/gpt/assignments/{id}/production-jobs. Do not retry a retired route.",
});
