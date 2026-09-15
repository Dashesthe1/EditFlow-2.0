import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const required = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const action = required("--action");
const requestPath = path.resolve(required("--request"));
const repoRoot = path.resolve(required("--repo"));
const cacheDir = path.resolve(required("--cache-dir"));
const environmentFingerprint = required("--environment");
const resultPath = args.get("--result") ? path.resolve(args.get("--result")) : null;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const insideRepo = (candidate) => candidate === repoRoot || candidate.startsWith(`${repoRoot}${path.sep}`);
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

const walk = async (entry) => {
  const resolved = path.resolve(repoRoot, entry);
  if (!insideRepo(resolved)) throw new Error(`Dependency escapes repository: ${entry}`);
  const info = await stat(resolved);
  if (info.isFile()) return [resolved];
  if (!info.isDirectory()) return [];
  const children = await readdir(resolved, { withFileTypes: true });
  const files = [];
  for (const child of children) {
    if (["node_modules", ".git", ".tmp"].includes(child.name)) continue;
    const childResolved = path.join(resolved, child.name);
    if (child.isDirectory()) files.push(...await walk(path.relative(repoRoot, childResolved)));
    else if (child.isFile()) files.push(childResolved);
  }
  return files;
};

const digestDependencies = async (request) => {
  const declared = Array.isArray(request.incrementalDependencies) ? request.incrementalDependencies : [];
  const entries = [request.proofScript, ...declared];
  const unique = [...new Set(entries)];
  const files = [];
  for (const entry of unique) files.push(...await walk(entry));
  files.sort((a, b) => a.localeCompare(b));
  const digests = [];
  for (const file of files) {
    const bytes = await readFile(file);
    digests.push({ id: path.relative(repoRoot, file).replaceAll("\\", "/"), sha256: sha256(bytes) });
  }
  return { digests, reusable: declared.length > 0 };
};

const request = JSON.parse(await readFile(requestPath, "utf8"));
const strategy = request.proofStrategy ?? "INCREMENTAL_FIRST";
if (!["INCREMENTAL_FIRST", "FULL_ACCEPTANCE"].includes(strategy)) throw new Error(`Unsupported proofStrategy: ${strategy}`);
const nodeId = request.incrementalNodeId ?? request.proofId;
const checkpointKey = request.checkpointKey ?? null;
const { digests, reusable } = await digestDependencies(request);
const contentKey = `IPV1_${sha256(Buffer.from(JSON.stringify(canonical({
  proofId: request.proofId,
  nodeId,
  lifecycle: request.lifecycle,
  environmentFingerprint,
  checkpointKey,
  dependencies: digests,
})), "utf8"))}`;
const cacheName = `${String(request.proofId).replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
const cachePath = path.join(cacheDir, cacheName);
await mkdir(cacheDir, { recursive: true });
let token = null;
try { token = JSON.parse(await readFile(cachePath, "utf8")); } catch {}

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
if (action === "plan") {
  if (strategy === "FULL_ACCEPTANCE") {
    emit({ action: "RUN_FULL", strategy, contentKey, reusableEvidence: false, reason: "FULL_ACCEPTANCE bypasses cached evidence." });
  } else if (request.allowEvidenceReuse === false) {
    emit({ action: "RUN_DELTA", strategy, contentKey, reusableEvidence: false, reason: "Request explicitly disables evidence reuse." });
  } else if (!reusable) {
    emit({ action: "RUN_DELTA", strategy, contentKey, reusableEvidence: false, reason: "No explicit incrementalDependencies were declared; fail closed and execute the delta proof." });
  } else if (token?.schema === "editflow.incremental-proof-token.v1" && token.classification === "PASS" && token.contentKey === contentKey) {
    emit({ action: "REUSE_PASS", strategy, contentKey, reusableEvidence: true, tokenPath: cachePath, reason: "All content-addressed proof dependencies still match." });
  } else {
    emit({ action: "RUN_DELTA", strategy, contentKey, reusableEvidence: true, reason: "No matching accepted PASS token exists for the current dependency graph." });
  }
} else if (action === "record") {
  if (!resultPath) throw new Error("--result is required for record");
  const resultBytes = await readFile(resultPath);
  const result = JSON.parse(resultBytes.toString("utf8").replace(/^\uFEFF/, ""));
  if (result.classification !== "PASS" && result.ok !== true) {
    throw new Error("Only passing proof results may create reusable proof tokens.");
  }
  const proofToken = {
    schema: "editflow.incremental-proof-token.v1",
    proofId: request.proofId,
    nodeId,
    contentKey,
    classification: "PASS",
    producedAt: new Date().toISOString(),
    resultDigest: sha256(resultBytes),
    checkpointKey,
    environmentFingerprint,
    dependencyCount: digests.length,
  };
  await writeFile(cachePath, `${JSON.stringify(proofToken, null, 2)}\n`, "utf8");
  emit({ action: "RECORDED_PASS", strategy, contentKey, tokenPath: cachePath, dependencyCount: digests.length });
} else {
  throw new Error(`Unsupported --action: ${action}`);
}
