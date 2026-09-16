import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ErrorDomain =
  | "AE" | "CEP" | "EDITFLOW" | "WINDOWS" | "NODE" | "PYTHON" | "GIT" | "SHELL" | "UNKNOWN";
export type ErrorTriageAction = "APPLY_KNOWN_FIX" | "ONLINE_LOOKUP" | "ESCALATE";
export type ErrorTriageSource = "MEMORY" | "BUILTIN" | "UNKNOWN";

export interface ErrorTriageContext {
  readonly surface?: string;
  readonly command?: string;
  readonly component?: string;
}

export interface ErrorLookupPlan {
  readonly query: string;
  readonly preferredSources: readonly string[];
  readonly budgetMs: number;
}

export interface ErrorTriageResult {
  readonly signature: string;
  readonly normalized: string;
  readonly domain: ErrorDomain;
  readonly code: string;
  readonly source: ErrorTriageSource;
  readonly confidence: number;
  readonly action: ErrorTriageAction;
  readonly resolution: string;
  readonly avoidRepeat: string;
  readonly occurrenceCount: number;
  readonly onlineLookup: ErrorLookupPlan | null;
}

export interface ErrorMemoryEntry {
  readonly signature: string;
  readonly normalized: string;
  readonly domain: ErrorDomain;
  readonly code: string;
  readonly resolution: string;
  readonly avoidRepeat: string;
  readonly occurrences: number;
  readonly successfulUses: number;
  readonly failedUses: number;
  readonly verified: boolean;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

interface ErrorMemoryFileV1 {
  readonly schema: "editflow.error-memory.v1";
  readonly entries: readonly ErrorMemoryEntry[];
}

interface BuiltinRule {
  readonly domain: ErrorDomain;
  readonly code: string;
  readonly confidence: number;
  readonly action: ErrorTriageAction;
  readonly test: (text: string) => boolean;
  readonly resolution: string;
  readonly avoidRepeat: string;
}

const lower = (value: string): string => value.toLowerCase();

export const normalizeErrorText = (value: string): string => value
  .replace(/\r\n/g, "\n")
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
  .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/gi, "<timestamp>")
  .replace(/\b[a-z]:\\[^\r\n"']+/gi, "<path>")
  .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
  .replace(/\b\d+\b/g, "<n>")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

export const errorSignature = (value: string): string =>
  `err:${createHash("sha256").update(normalizeErrorText(value)).digest("hex").slice(0, 20)}`;

const BUILTIN_RULES: readonly BuiltinRule[] = [
  {
    domain: "SHELL", code: "MISSING_RIPGREP", confidence: 0.99, action: "APPLY_KNOWN_FIX",
    test: (text) => (text.includes("rg : the term 'rg' is not recognized") || text.includes("'rg' is not recognized as an internal or external command")),
    resolution: "Do not retry ripgrep during the test loop. Use PowerShell Get-ChildItem plus Select-String, or an already available repository search tool.",
    avoidRepeat: "Do not call rg again on this workstation unless a preflight first proves it is installed.",
  },
  {
    domain: "SHELL", code: "POWERSHELL_AND_AND_UNSUPPORTED", confidence: 0.995, action: "APPLY_KNOWN_FIX",
    test: (text) => text.includes("the token '&&' is not a valid statement separator"),
    resolution: "This Windows PowerShell host does not accept &&. Sequence commands with ';' and gate dependent steps with $LASTEXITCODE, or use cmd.exe explicitly when && semantics are required.",
    avoidRepeat: "Never emit && in commands sent to this PowerShell host.",
  },
  {
    domain: "SHELL", code: "POWERSHELL_NPM_PS1_BLOCKED", confidence: 0.995, action: "APPLY_KNOWN_FIX",
    test: (text) => text.includes("npm.ps1 cannot be loaded because running scripts is disabled") && text.includes("pssecurityexception"),
    resolution: "Invoke npm.cmd directly instead of npm so PowerShell does not route through the blocked npm.ps1 shim.",
    avoidRepeat: "Use npm.cmd for repository build/test commands on this workstation unless execution policy is deliberately changed outside the test loop.",
  },
  {
    domain: "PYTHON", code: "PYTHON_WRONG_ENV_MCP", confidence: 0.99, action: "APPLY_KNOWN_FIX",
    test: (text) => text.includes("modulenotfounderror") && text.includes("no module named 'mcp'"),
    resolution: "Use the existing EditGPT virtual environment that already contains the MCP SDK; do not install packages into system Python during an AE test.",
    avoidRepeat: "Preflight the interpreter once and reuse that exact Python executable for all EditGPT/MCP sidecars in the run.",
  },
  {
    domain: "SHELL", code: "POWERSHELL_VARIABLE_STRIPPED", confidence: 0.99, action: "APPLY_KNOWN_FIX",
    test: (text) => text.includes("=join-path") && text.includes("is not recognized"),
    resolution: "Avoid nested PowerShell command strings that allow $ variables to be expanded or stripped by an outer shell. Use direct PowerShell execution, absolute paths, or a script file.",
    avoidRepeat: "Do not retry the same nested powershell -Command form; switch execution form before retrying.",
  },
  {
    domain: "EDITFLOW", code: "PATCH_GUARD_NON_UNIQUE", confidence: 0.98, action: "APPLY_KNOWN_FIX",
    test: (text) => text.includes("expected exactly one match") && text.includes("found"),
    resolution: "Treat the patch guard as a successful refusal. Inspect the matching lines and narrow the replacement anchor before running the patch once more.",
    avoidRepeat: "Never weaken an exact-match patch guard just to make the patch run; refine the anchor instead.",
  },
  {
    domain: "WINDOWS", code: "BAD_QUOTED_GATEWAY_COMMAND", confidence: 0.98, action: "APPLY_KNOWN_FIX",
    test: (text) => text.includes("windows cannot find") && text.includes("editflow shadow gateway"),
    resolution: "Do not execute the display label as a Windows command. Resolve the actual gateway launcher/process command and reuse that route.",
    avoidRepeat: "Keep display names separate from executable paths and command lines.",
  },
  {
    domain: "CEP", code: "CEP_PROTOCOL_MISMATCH", confidence: 0.97, action: "APPLY_KNOWN_FIX",
    test: (text) => text.includes("unsupported") && text.includes("protocol") && (text.includes("cep") || text.includes("editflow") || text.includes("broker")),
    resolution: "Compare the live panel supportedProtocolVersions, broker compiled protocols, and loaded host protocol. Promote or reconnect only the bridge/control route when possible; do not restart After Effects by default.",
    avoidRepeat: "Do not dispatch a protocol until the live panel and broker both advertise it.",
  },
  {
    domain: "EDITFLOW", code: "MCP_SURFACE_STALE", confidence: 0.93, action: "APPLY_KNOWN_FIX",
    test: (text) => (text.includes("unknown tool") || text.includes("tool not found") || text.includes("method not found")) && text.includes("mcp"),
    resolution: "Refresh the MCP tool surface once and use only the currently registered tool names. Do not repeatedly invoke an exposed-but-unregistered helper.",
    avoidRepeat: "Cache the refreshed tool surface for the run and invalidate it only after a gateway restart or explicit capability change.",
  },
  {
    domain: "AE", code: "AE_MODAL_ERROR", confidence: 0.90, action: "ONLINE_LOOKUP",
    test: (text) => text.includes("after effects error") || text.includes("afterfx error"),
    resolution: "Capture the exact popup text and log it. Dismiss only an unambiguous single OK/Close acknowledgement, then diagnose the captured signature instead of waiting for a timeout.",
    avoidRepeat: "Do not retry the blocked AE action until the exact modal error has been classified.",
  },
];

export const BUILTIN_ERROR_RULE_COUNT = BUILTIN_RULES.length;

const preferredSources = (domain: ErrorDomain): readonly string[] => {
  switch (domain) {
    case "AE": return ["helpx.adobe.com", "community.adobe.com", "github.com/Adobe-CEP/CEP-Resources"];
    case "CEP": return ["github.com/Adobe-CEP/CEP-Resources", "helpx.adobe.com"];
    case "WINDOWS": case "SHELL": return ["learn.microsoft.com", "learn.microsoft.com/sysinternals"];
    case "NODE": return ["nodejs.org", "docs.npmjs.com", "github.com"];
    case "PYTHON": return ["docs.python.org", "pip.pypa.io", "github.com"];
    case "GIT": return ["git-scm.com", "docs.github.com"];
    case "EDITFLOW": return ["github.com", "local EditFlow repository and retained proofs"];
    default: return ["vendor documentation", "github.com"];
  }
};

export const classifyErrorDomain = (value: string): ErrorDomain => {
  const text = lower(value);
  if (text.includes("after effects") || text.includes("afterfx")) return "AE";
  if (text.includes("cep") || text.includes("adobe_cep") || text.includes("broker")) return "CEP";
  if (text.includes("powershell") || text.includes("cmdlet") || text.includes("internal or external command")) return "SHELL";
  if (text.includes("python") || text.includes("pip") || text.includes("modulenotfounderror")) return "PYTHON";
  if (text.includes("node") || text.includes("npm ")) return "NODE";
  if (text.includes("git ") || text.includes("fatal: not a git")) return "GIT";
  if (text.includes("windows") || text.includes("win32")) return "WINDOWS";
  if (text.includes("editflow") || text.includes("mcp")) return "EDITFLOW";
  return "UNKNOWN";
};

const lookupPlan = (text: string, domain: ErrorDomain): ErrorLookupPlan => ({
  query: `${text.trim().slice(0, 500)} ${domain === "AE" || domain === "CEP" ? "After Effects CEP" : domain}`.trim(),
  preferredSources: preferredSources(domain),
  budgetMs: 10_000,
});

const builtinDiagnosis = (errorText: string): Omit<ErrorTriageResult, "signature" | "normalized" | "occurrenceCount"> | null => {
  const text = lower(errorText);
  const rule = BUILTIN_RULES.find((candidate) => candidate.test(text));
  if (!rule) return null;
  return {
    domain: rule.domain, code: rule.code, source: "BUILTIN", confidence: rule.confidence,
    action: rule.action, resolution: rule.resolution, avoidRepeat: rule.avoidRepeat,
    onlineLookup: rule.action === "ONLINE_LOOKUP" ? lookupPlan(errorText, rule.domain) : null,
  };
};

export const diagnoseError = (errorText: string): ErrorTriageResult => {
  const normalized = normalizeErrorText(errorText);
  const signature = errorSignature(errorText);
  const known = builtinDiagnosis(errorText);
  if (known) return { signature, normalized, occurrenceCount: 0, ...known };
  const domain = classifyErrorDomain(errorText);
  return {
    signature, normalized, domain, code: "UNKNOWN_SIGNATURE", source: "UNKNOWN", confidence: 0.35,
    action: "ONLINE_LOOKUP", resolution: "Run a bounded exact-signature lookup, retain the evidence, and cache a verified resolution before retrying.",
    avoidRepeat: "Do not repeat the identical failing command while the signature is unresolved.",
    occurrenceCount: 0, onlineLookup: lookupPlan(errorText, domain),
  };
};

export interface RememberErrorResolutionInput {
  readonly errorText: string;
  readonly resolution: string;
  readonly avoidRepeat?: string;
  readonly domain?: ErrorDomain;
  readonly code?: string;
  readonly verified?: boolean;
}

export class ErrorMemoryStore {
  readonly filePath: string;
  #loaded = false;
  #entries = new Map<string, ErrorMemoryEntry>();

  constructor(filePath: string) { this.filePath = filePath; }

  async diagnose(errorText: string): Promise<ErrorTriageResult> {
    await this.#load();
    const signature = errorSignature(errorText);
    const remembered = this.#entries.get(signature);
    if (remembered?.verified) {
      return {
        signature, normalized: remembered.normalized, domain: remembered.domain, code: remembered.code,
        source: "MEMORY", confidence: remembered.successfulUses > remembered.failedUses ? 0.995 : 0.90,
        action: "APPLY_KNOWN_FIX", resolution: remembered.resolution, avoidRepeat: remembered.avoidRepeat,
        occurrenceCount: remembered.occurrences, onlineLookup: null,
      };
    }
    const result = diagnoseError(errorText);
    return { ...result, occurrenceCount: remembered?.occurrences ?? 0 };
  }

  async remember(input: RememberErrorResolutionInput): Promise<ErrorMemoryEntry> {
    await this.#load();
    const signature = errorSignature(input.errorText);
    const normalized = normalizeErrorText(input.errorText);
    const prior = this.#entries.get(signature);
    const builtIn = diagnoseError(input.errorText);
    const now = new Date().toISOString();
    const verified = input.verified ?? true;
    const entry: ErrorMemoryEntry = {
      signature, normalized,
      domain: input.domain ?? prior?.domain ?? builtIn.domain,
      code: input.code?.trim() || prior?.code || builtIn.code,
      resolution: input.resolution.trim(),
      avoidRepeat: input.avoidRepeat?.trim() || prior?.avoidRepeat || builtIn.avoidRepeat,
      occurrences: (prior?.occurrences ?? 0) + 1,
      successfulUses: (prior?.successfulUses ?? 0) + (verified ? 1 : 0),
      failedUses: prior?.failedUses ?? 0,
      verified,
      firstSeenAt: prior?.firstSeenAt ?? now,
      lastSeenAt: now,
    };
    this.#entries.set(signature, entry);
    await this.#persist();
    return entry;
  }

  async recordOutcome(signature: string, success: boolean): Promise<ErrorMemoryEntry | null> {
    await this.#load();
    const prior = this.#entries.get(signature);
    if (!prior) return null;
    const next: ErrorMemoryEntry = {
      ...prior,
      occurrences: prior.occurrences + 1,
      successfulUses: prior.successfulUses + (success ? 1 : 0),
      failedUses: prior.failedUses + (success ? 0 : 1),
      verified: success ? true : prior.verified,
      lastSeenAt: new Date().toISOString(),
    };
    this.#entries.set(signature, next);
    await this.#persist();
    return next;
  }

  async list(limit = 50): Promise<readonly ErrorMemoryEntry[]> {
    await this.#load();
    return [...this.#entries.values()]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, Math.max(0, Math.floor(limit)));
  }

  async stats(): Promise<Readonly<{ entries: number; verified: number; successfulUses: number; failedUses: number }>> {
    await this.#load();
    const entries = [...this.#entries.values()];
    return {
      entries: entries.length,
      verified: entries.filter((entry) => entry.verified).length,
      successfulUses: entries.reduce((sum, entry) => sum + entry.successfulUses, 0),
      failedUses: entries.reduce((sum, entry) => sum + entry.failedUses, 0),
    };
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<ErrorMemoryFileV1>;
      if (parsed.schema !== "editflow.error-memory.v1" || !Array.isArray(parsed.entries)) return;
      for (const entry of parsed.entries) {
        if (entry && typeof entry === "object" && typeof (entry as ErrorMemoryEntry).signature === "string") {
          this.#entries.set((entry as ErrorMemoryEntry).signature, entry as ErrorMemoryEntry);
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  async #persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const value: ErrorMemoryFileV1 = { schema: "editflow.error-memory.v1", entries: [...this.#entries.values()] };
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}
