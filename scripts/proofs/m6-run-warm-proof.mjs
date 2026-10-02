import { productionRequest } from "../production-job-client.mjs";
import path from "node:path";

const argv = process.argv.slice(2);
const value = (name) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) throw new Error(`Missing ${name}`);
  return argv[i + 1];
};
const scriptPath = path.resolve(value("--script"));
const endpoint = "@PROOF_SCRIPT";
const response = await productionRequest("http://127.0.0.1:32146", endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ scriptPath }),
});
const payload = await response.json();
if (!response.ok || payload?.ok !== true) {
  throw new Error(`Warm CEP proof dispatch failed: ${JSON.stringify(payload)}`);
}
console.log(JSON.stringify(payload));
