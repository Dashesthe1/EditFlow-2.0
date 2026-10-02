import { AsyncLocalStorage } from "node:async_hooks";

/** Only the durable writer lends this scope to its capability subprocesses. */
export const productionJobScopeV1 = new AsyncLocalStorage<Readonly<Record<string, string>>>();
