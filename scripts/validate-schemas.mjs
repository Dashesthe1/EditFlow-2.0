import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const manifestPath = path.join(root, "spec/fixtures/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const schemaPaths = [...new Set(manifest.map((entry) => entry.schema))];
const schemas = new Map();
const ajv = new Ajv2020({ allErrors: true, strict: false });

for (const relativePath of schemaPaths) {
  const schema = JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
  if (!schema.$id) {
    throw new Error(`Schema ${relativePath} is missing $id`);
  }
  schemas.set(relativePath, schema);
  ajv.addSchema(schema, schema.$id);
}

let failures = 0;

for (const entry of manifest) {
  const schema = schemas.get(entry.schema);
  if (!schema) {
    throw new Error(`Fixture references unknown schema: ${entry.schema}`);
  }

  const validate = ajv.getSchema(schema.$id);
  if (!validate) {
    throw new Error(`AJV did not register schema ${schema.$id}`);
  }

  const data = JSON.parse(await readFile(path.join(root, entry.fixture), "utf8"));
  const actual = Boolean(validate(data));

  if (actual !== entry.valid) {
    failures += 1;
    console.error(`FAIL ${entry.fixture}: expected valid=${entry.valid}, got ${actual}`);
    if (validate.errors) {
      console.error(JSON.stringify(validate.errors, null, 2));
    }
  } else {
    console.log(`PASS ${entry.fixture} (${entry.valid ? "valid" : "invalid as expected"})`);
  }
}

if (failures > 0) {
  console.error(`Schema fixture validation failed: ${failures} mismatch(es)`);
  process.exit(1);
}

console.log(`Validated ${manifest.length} contract fixtures successfully.`);
