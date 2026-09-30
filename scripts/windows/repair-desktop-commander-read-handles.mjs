import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Desktop Commander 0.2.52 closes readline but leaks its input on partial reads.
export function patchReadlineCleanup(source) {
  if (source.includes("EDITFLOW_CLOSED_TEXT_READ_V1")) return source;
  const prefix = source.indexOf("    async readFromEndWithReadline(");
  if (prefix < 0) throw new Error("Unsupported Desktop Commander text reader; no changes made.");
  let before = source.slice(0, prefix), body = source.slice(prefix);
  body = body.replace(/const rl = createInterface\(\{\s*input: createReadStream\(filePath, (\{[^\n]+\})\),/g,
    "const input = createReadStream(filePath, $1);\n        const rl = createInterface({\n            input,");
  const patterns = [
    [/        for await \(const line of rl\) \{[\s\S]*?        rl\.close\(\);/g, "rl", "input"],
    [/            for await \(const line of rl2\) \{[\s\S]*?            rl2\.close\(\);/g, "rl2", "stream"],
  ];
  let count = 0;
  for (const [pattern, rl, stream] of patterns) body = body.replace(pattern, (block) => {
    count++;
    const indent = block.match(/^ */)[0];
    const loop = block.slice(0, block.lastIndexOf(indent + rl + ".close();")).trimEnd();
    return indent + "try {\n" + loop.split("\n").map(line => "    " + line).join("\n")
      + "\n" + indent + "} finally {\n" + indent + "    await closeTextRead(" + rl + ", " + stream + ");\n" + indent + "}";
  });
  if (count !== 4) throw new Error("Unsupported Desktop Commander reader shape (" + count + "); no changes made.");
  const helper = `// EDITFLOW_CLOSED_TEXT_READ_V1: release Windows file handles before returning.
const closeTextRead = async (rl, input) => {
    rl.close();
    if (input.closed) return;
    await new Promise((resolve) => {
        input.once("close", resolve);
        input.destroy();
    });
};
`;
  return (before + body).replace("export class TextFileHandler {", helper + "export class TextFileHandler {");
}

async function main() {
  const roots = new Set();
  if (process.argv[2]) roots.add(path.resolve(process.argv[2]));
  else {
    const cache = path.join(process.env.LOCALAPPDATA ?? "", "npm-cache", "_npx");
    for (const entry of await readdir(cache).catch(() => []))
      roots.add(path.join(cache, entry, "node_modules", "@wonderwhy-er", "desktop-commander"));
    roots.add(path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@wonderwhy-er", "desktop-commander"));
  }
  for (const root of roots) {
    const file = path.join(root, "dist", "utils", "files", "text.js");
    const source = await readFile(file, "utf8").catch(() => null);
    if (source === null) continue;
    // A future package that already explicitly destroys its inputs needs no patch.
    if (source.includes("input.destroy()") && !source.includes("EDITFLOW_CLOSED_TEXT_READ_V1")) continue;
    const next = patchReadlineCleanup(source);
    if (next !== source) {
      execFileSync(process.execPath, ["--check", "--input-type=module"], { input: next, stdio: ["pipe", "pipe", "pipe"] });
      await writeFile(file + ".editflow-original", source, { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
      await writeFile(file, next, "utf8");
    }
    console.log(JSON.stringify({ event: "DESKTOP_COMMANDER_READER_REPAIRED", root, changed: next !== source }));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
