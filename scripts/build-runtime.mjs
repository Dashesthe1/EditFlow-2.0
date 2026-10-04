import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
// A clean runtime guarantees deleted decision engines cannot survive as emitted JS.
rmSync(".tmp/runtime", { recursive: true, force: true });
rmSync(".tmp/runtime.tsbuildinfo", { force: true });
const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.runtime.json"], { stdio: "inherit" });
process.exit(result.status ?? 1);
