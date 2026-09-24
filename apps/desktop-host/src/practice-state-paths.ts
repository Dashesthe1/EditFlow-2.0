import os from "node:os";
import path from "node:path";

export interface PracticeStatePathsV1 {
  readonly stateDir: string;
  readonly learningMemoryFilePath: string;
  readonly editTypeRegistryFilePath: string;
}

const configuredStateDir = (): string | null => {
  const configured = process.env["EDITFLOW_PRACTICE_STATE_DIR"]?.trim();
  return configured === undefined || configured.length === 0
    ? null
    : path.resolve(configured);
};

export const defaultPracticeStateDirectoryV1 = (): string => {
  const configured = configuredStateDir();
  if (configured !== null) return configured;
  const localAppData = process.env["LOCALAPPDATA"]?.trim();
  if (localAppData !== undefined && localAppData.length > 0) {
    return path.resolve(localAppData, "EditFlow2", "practice-state");
  }
  return path.resolve(os.homedir(), ".editflow2", "practice-state");
};
export const resolvePracticeStatePathsV1 = (
  overrideStateDir?: string | null,
): PracticeStatePathsV1 => {
  const trimmed = overrideStateDir?.trim() ?? "";
  const stateDir = trimmed.length > 0
    ? path.resolve(trimmed)
    : defaultPracticeStateDirectoryV1();
  return {
    stateDir,
    learningMemoryFilePath: path.join(stateDir, "practice-learning-memory.json"),
    editTypeRegistryFilePath: path.join(stateDir, "edit-types.json"),
  };
};
