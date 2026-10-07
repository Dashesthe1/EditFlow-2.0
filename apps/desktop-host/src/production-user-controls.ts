import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PRODUCTION_USER_CONTROL_CONTRACT_V1 = {
  endpoint: "/v1/product/production/user-controls",
  chatTool: "resume_or_start_practice",
  actions: ["START_PRACTICE", "RESTART_PRACTICE", "REPLACE_CHAT", "CANCEL", "RETRY", "DISMISS", "STATUS"],
  instruction: "Only submit lifecycle actions in response to an explicit user request. No worker credential or supervisor key is required. Use one stable requestId and poll STATUS with that requestId. Report COMPLETED only from its durable receipt; a submitted prompt alone is PENDING. RESTART_PRACTICE reuses the previous inputs and requires a current preset; use START_PRACTICE for new inputs. REPLACE_CHAT retains the assignment and checkpoints. DISMISS clears a blocked request only before a replacement was created or launched; it never deletes assignments. A valid START_PRACTICE can supersede such a blocked request. RETRY validates retained inputs again.",
} as const;

export interface ProductionUserControlReceiptV1 {
  requestId: string;
  action: "START_PRACTICE" | "RESTART_PRACTICE" | "REPLACE_CHAT" | "CANCEL";
  status: "PENDING" | "COMPLETED" | "BLOCKED" | "FAILED";
  step: "QUEUED" | "STOPPING" | "DRAINING" | "PREPARING" | "LAUNCHING" | "VERIFYING" | "DONE";
  expectedAssignmentId: string | null;
  previousAssignmentId: string | null;
  assignmentId: string | null;
  sessionId: string | null;
  plannedSessionId: string | null;
  generation: number | null;
  tabId: number | null;
  input: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  completedAt: string | null;
  error: string | null;
  fingerprint: string;
}

/** User intent receipts are separate from worker authority. Only the supervisor
 * advances stop/drain/launch; public requests cannot mint a worker credential. */
export class ProductionUserControlsV1 {
  readonly filePath: string;
  #receipts: ProductionUserControlReceiptV1[];
  #tail: Promise<unknown> = Promise.resolve();
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.filePath = path.join(directory, "user-controls.json");
    this.#receipts = existsSync(this.filePath) ? JSON.parse(readFileSync(this.filePath, "utf8")) : [];
    if (!Array.isArray(this.#receipts)) throw new Error("CORRUPT_USER_CONTROL_RECEIPTS");
  }
  async exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const pending = this.#tail.catch(() => undefined).then(operation); this.#tail = pending; return await pending;
  }
  #save(): void {
    writeFileSync(this.filePath + ".tmp", JSON.stringify(this.#receipts, null, 2), { flush: true, mode: 0o600 });
    renameSync(this.filePath + ".tmp", this.filePath);
  }
  list(): ProductionUserControlReceiptV1[] { return structuredClone(this.#receipts); }
  get(id: string): ProductionUserControlReceiptV1 | null { return this.list().find(r => r.requestId === id) ?? null; }
  active(): ProductionUserControlReceiptV1 | null { return this.list().find(r => ["PENDING", "BLOCKED"].includes(r.status)) ?? null; }
  latest(): ProductionUserControlReceiptV1 | null { return this.list().at(-1) ?? null; }
  fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
  submit(receipt: ProductionUserControlReceiptV1): ProductionUserControlReceiptV1 {
    const prior = this.get(receipt.requestId);
    if (prior) {
      if (prior.fingerprint !== receipt.fingerprint) throw Object.assign(new Error("REQUEST_ID_REUSED_WITH_DIFFERENT_INTENT"), { status: 409 });
      return prior;
    }
    if (this.active()) throw Object.assign(new Error("USER_CONTROL_ALREADY_PENDING: poll or retry the existing request."), { status: 409 });
    this.#receipts.push(receipt); this.#save(); return structuredClone(receipt);
  }
  update(id: string, change: Partial<ProductionUserControlReceiptV1>): ProductionUserControlReceiptV1 {
    const index = this.#receipts.findIndex(r => r.requestId === id);
    if (index < 0) throw Object.assign(new Error("USER_CONTROL_NOT_FOUND"), { status: 404 });
    this.#receipts[index] = { ...this.#receipts[index]!, ...change, updatedAt: new Date().toISOString() };
    this.#save(); return this.get(id)!;
  }
}
