import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL(
  "../packages/adapters/ae-cep/extension/CSXS/manifest.xml",
  import.meta.url,
);

const CEP_VERSION_RE = /^\d{1,9}(?:\.\d{1,9}(?:\.\d{1,9}(?:\.[A-Za-z0-9_-]+)?)?)?$/;

function getAttribute(xml, elementPattern, attribute) {
  const element = xml.match(elementPattern)?.[0];
  assert.ok(element, `Expected manifest element matching ${elementPattern}`);
  const match = element.match(new RegExp(`${attribute}="([^"]+)"`));
  assert.ok(match, `Expected ${attribute} on ${element}`);
  return match[1];
}

test("CEP manifest uses CEP-compatible versions and targets AE/CSXS 12", async () => {
  const xml = await readFile(manifestPath, "utf8");

  const bundleVersion = getAttribute(xml, /<ExtensionManifest[\s\S]*?>/, "ExtensionBundleVersion");
  const extensionVersion = getAttribute(
    xml,
    /<Extension\s+Id="com\.editflow2\.bridge\.panel"\s+Version="[^"]+"\s*\/>/,
    "Version",
  );

  assert.match(bundleVersion, CEP_VERSION_RE);
  assert.match(extensionVersion, CEP_VERSION_RE);
  assert.match(xml, /<ExtensionManifest[\s\S]*?Version="12\.0"/);
  assert.match(xml, /<Host\s+Name="AEFT"\s+Version="\[23\.0,99\.9\]"\s*\/>/);
  assert.match(xml, /<RequiredRuntime\s+Name="CSXS"\s+Version="12\.0"\s*\/>/);
  assert.match(xml, /<Menu>EditFlow 2\.0 Bridge<\/Menu>/);
});
