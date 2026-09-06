import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import { LoopbackCepBroker } from "./loopback-cep.js";

interface BridgeConfigFile {
  readonly schemaVersion: 1;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly protocolVersion: "1.1.0";
  readonly extensionId: string;
  readonly extensionVersion: string;
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
  if (candidate["schemaVersion"] !== 1) throw new Error("Unsupported bridge config schemaVersion.");
  if (candidate["host"] !== "127.0.0.1") throw new Error("CEP bridge config host must be 127.0.0.1.");
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1 || (candidate["port"] as number) > 65535) {
    throw new Error("CEP bridge config port is invalid.");
  }
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("CEP bridge token is invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("CEP bridge protocolVersion mismatch.");
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0) throw new Error("CEP extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) throw new Error("CEP extensionVersion is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const writeResult = async (resultPath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "90000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error("--timeout-ms must be at least 1000.");

  const startedAt = new Date().toISOString();
  let broker: LoopbackCepBroker | null = null;
  try {
    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    const session = await broker.waitForPanel(timeoutMs);
    if (session.protocolVersion !== config.protocolVersion) throw new Error("Registered CEP panel protocol mismatch.");
    if (session.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${session.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    let requestCounter = 0;
    const client = new AeCepAdapterClientV11(broker, () => `cep-smoke-${++requestCounter}`);
    const environment = await client.probe();
    const project = await client.inspectProject();
    const observed = await client.observe("m2-cep-smoke");

    const ok = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11
      && observed.environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11
      && observed.project.hostRevision === project.hostRevision;

    await writeResult(resultPath, {
      proofId: "M2_CEP_TRANSPORT_SMOKE",
      status: ok ? "PASS" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
      panel: session,
      environment,
      project: {
        hostRevision: project.hostRevision,
        itemCount: project.itemCount,
        filePath: project.filePath,
      },
      observed: observed.observed,
      safety: {
        readOnly: true,
        commands: ["host.probe", "project.inspect"],
        adobeWritesPerformed: false,
        brokerHost: "127.0.0.1",
      },
    });

    if (!ok) process.exitCode = 1;
  } catch (error) {
    await writeResult(resultPath, {
      proofId: "M2_CEP_TRANSPORT_SMOKE",
      status: "FAILED",
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      safety: { readOnly: true, adobeWritesPerformed: false },
    });
    process.exitCode = 1;
  } finally {
    if (broker !== null) await broker.stop();
  }
};

await main();
