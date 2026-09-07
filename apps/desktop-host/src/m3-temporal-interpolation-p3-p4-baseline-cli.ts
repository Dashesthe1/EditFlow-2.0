import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17 } from "../../../packages/adapters/ae-cep/src/protocol-v1_7.js";
import { LoopbackCepBroker } from "./loopback-cep.js";

interface BridgeConfigFile {
  readonly schemaVersion: 1;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly protocolVersion: "1.1.0";
  readonly supportedProtocolVersions?: readonly string[];
  readonly extensionId: string;
  readonly extensionVersion: string;
}

interface BaselineFile {
  readonly schemaVersion: 1;
  readonly proofId: "M3_TEMPORAL_INTERPOLATION_P3_P4_BASELINE";
  readonly projectFingerprint: string;
  readonly itemCount: number;
  readonly filePath: string | null;
}

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

const requireArgument = (name: string): string => {
  const value = argument(name);
  if (value === null || value.length === 0) throw new Error(`Missing required argument ${name}.`);
  return value;
};

const stripUtf8Bom = (value: string): string => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;

const parseConfig = (value: unknown): BridgeConfigFile => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Bridge config must be an object.");
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Bridge config schema/host is invalid.");
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1 || (candidate["port"] as number) > 65535) throw new Error("Bridge config port is invalid.");
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("Bridge token is invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("Bridge legacy protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported)
      || !supported.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("Bridge config does not advertise required 1.7 and 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0) throw new Error("Bridge extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) throw new Error("Bridge extensionVersion is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const parseBaseline = (value: unknown): BaselineFile => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Baseline file must be an object.");
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== 1 || candidate["proofId"] !== "M3_TEMPORAL_INTERPOLATION_P3_P4_BASELINE") throw new Error("Baseline file identity is invalid.");
  if (typeof candidate["projectFingerprint"] !== "string" || candidate["projectFingerprint"].length === 0) throw new Error("Baseline fingerprint is missing.");
  if (!Number.isInteger(candidate["itemCount"]) || (candidate["itemCount"] as number) < 0) throw new Error("Baseline itemCount is invalid.");
  if (candidate["filePath"] !== null && typeof candidate["filePath"] !== "string") throw new Error("Baseline filePath is invalid.");
  return candidate as unknown as BaselineFile;
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const requestIdFactory = (() => {
  let sequence = 0;
  return (): string => {
    sequence += 1;
    return `m3-temporal-p34-baseline-${Date.now()}-${sequence}`;
  };
})();

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const outputPath = requireArgument("--output");
  const expectedPath = argument("--expected");
  const artifactDir = path.dirname(outputPath);
  const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);

  const broker = new LoopbackCepBroker({
    port: config.port,
    token: config.token,
    commandTimeoutMs: 30_000,
    commandLeaseMs: 2_000,
    expectedExtensionId: config.extensionId,
    supportedProtocolVersions: [AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17, AE_ADAPTER_PROTOCOL_VERSION_V11],
  });

  try {
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);
    const panel = await broker.waitForPanel(30_000);
    if (panel.protocolVersion !== AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17
        || !panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
      throw new Error("Baseline verification requires negotiated protocol 1.7 with protocol 1.1 compatibility.");
    }
    const client = new AeCepAdapterClientV11(
      broker,
      requestIdFactory,
      new AeFilesystemPolicyV11([artifactDir]),
    );
    const environment = await client.probe();
    if (environment.hostName !== "Adobe After Effects") throw new Error("Baseline verification is not connected to After Effects.");
    const observed = await client.observe("m3-temporal-interpolation-p3-p4-baseline");
    const baseline: BaselineFile = {
      schemaVersion: 1,
      proofId: "M3_TEMPORAL_INTERPOLATION_P3_P4_BASELINE",
      projectFingerprint: observed.observed.projectFingerprint,
      itemCount: observed.project.itemCount,
      filePath: observed.project.filePath,
    };
    if (expectedPath === null) {
      if (baseline.itemCount !== 0 || baseline.filePath !== null) throw new Error("Temporal P3/P4 baseline must be a blank unsaved project.");
      await writeJson(outputPath, {
        ...baseline,
        status: "CAPTURED",
        hostVersion: environment.hostVersion,
        hostBuild: environment.hostBuild,
        panelProtocolVersion: panel.protocolVersion,
      });
      return;
    }

    const expected = parseBaseline(JSON.parse(stripUtf8Bom(await readFile(expectedPath, "utf8"))) as unknown);
    const exact = baseline.projectFingerprint === expected.projectFingerprint
      && baseline.itemCount === expected.itemCount
      && baseline.filePath === expected.filePath;
    await writeJson(outputPath, {
      ...baseline,
      status: exact ? "EXACT_MATCH" : "MISMATCH",
      expectedProjectFingerprint: expected.projectFingerprint,
      expectedItemCount: expected.itemCount,
      expectedFilePath: expected.filePath,
      exact,
      hostVersion: environment.hostVersion,
      hostBuild: environment.hostBuild,
      panelProtocolVersion: panel.protocolVersion,
    });
    if (!exact) process.exitCode = 1;
  } finally {
    await broker.stop();
  }
};

void main().catch(async (error) => {
  const outputPath = argument("--output");
  if (outputPath) {
    try {
      await writeJson(outputPath, {
        schemaVersion: 1,
        proofId: "M3_TEMPORAL_INTERPOLATION_P3_P4_BASELINE",
        status: "FAILURE",
        exact: false,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      });
    } catch (_) {}
  }
  console.error(error);
  process.exitCode = 1;
});
