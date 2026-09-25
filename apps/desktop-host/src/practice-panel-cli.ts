import { readFile } from "node:fs/promises";
import path from "node:path";

import { LoopbackCepBroker } from "./loopback-cep.js";
import { PracticePanelServerV1 } from "./practice-panel-server.js";
import { resolvePracticeStatePathsV1 } from "./practice-state-paths.js";

interface BridgeConfigFile {
  readonly schemaVersion: 1;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly protocolVersion: string;
  readonly supportedProtocolVersions?: readonly string[];
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly productPort?: number;
}

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

const requiredArgument = (name: string): string => {
  const value = argument(name);
  if (value === null || value.trim().length === 0) {
    throw new Error("Missing required argument " + name + ".");
  }
  return value;
};

const parsePort = (value: string | null, fallback: number): number => {
  const port = value === null ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be an integer from 1 through 65535.");
  }
  return port;
};

const parseConfig = (value: unknown): BridgeConfigFile => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bridge config must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") {
    throw new Error("Unsupported CEP bridge config.");
  }
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1) {
    throw new Error("CEP bridge config port is invalid.");
  }
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) {
    throw new Error("CEP bridge token is invalid.");
  }
  if (typeof candidate["extensionId"] !== "string"
    || typeof candidate["extensionVersion"] !== "string") {
    throw new Error("CEP bridge extension metadata is incomplete.");
  }
  return candidate as unknown as BridgeConfigFile;
};

const main = async (): Promise<void> => {
  const configPath = path.resolve(requiredArgument("--config"));
  const repositoryRoot = path.resolve(requiredArgument("--repository-root"));
  const artifactDir = path.resolve(requiredArgument("--artifact-dir"));
  const statePaths = resolvePracticeStatePathsV1(argument("--state-dir"));
  const raw = await readFile(configPath, "utf8");
  const config = parseConfig(JSON.parse(
    raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw,
  ) as unknown);
  const productPort = parsePort(
    argument("--product-port"),
    config.productPort ?? config.port + 1,
  );
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new Error("--timeout-ms must be an integer >= 1000.");
  }

  const broker = new LoopbackCepBroker({
    port: config.port,
    token: config.token,
    commandTimeoutMs: Math.max(30_000, timeoutMs),
    commandLeaseMs: 2_000,
    expectedExtensionId: config.extensionId,
    supportedProtocolVersions: config.supportedProtocolVersions ?? [config.protocolVersion],
  });
  const panel = new PracticePanelServerV1({
    port: productPort,
    token: config.token,
    repositoryRoot,
    artifactDir,
    learningMemoryFilePath: statePaths.learningMemoryFilePath,
    editTypeRegistryFilePath: statePaths.editTypeRegistryFilePath,
    ...(argument("--retained-truth-manifest") === null
      ? {}
      : { retainedTruthManifestPath: path.resolve(argument("--retained-truth-manifest") ?? "") }),
    broker,
    ...(argument("--ffmpeg") === null ? {} : { ffmpegPath: path.resolve(argument("--ffmpeg") ?? "") }),
    renderTimeoutMs: timeoutMs,
  });

  await broker.start();
  try {
    await panel.start();
    process.stdout.write(
      "EditFlow Practice service ready on 127.0.0.1:" + String(panel.port)
      + "; AE bridge on 127.0.0.1:" + String(broker.port) + ".\n",
    );
    process.stdout.write("Persistent Practice state: " + statePaths.stateDir + ".\n");
    process.stdout.write("Open Window > Extensions > EditFlow 2.0 Bridge in After Effects.\n");
    await new Promise<void>((resolve) => {
      const stop = (): void => resolve();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  } finally {
    await panel.stop();
    await broker.stop();
  }
};

await main();
