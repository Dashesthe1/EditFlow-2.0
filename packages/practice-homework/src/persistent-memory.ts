import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PracticeEpisodeV1 } from "./contracts.js";
import { PracticeLearningMemoryV1 } from "./memory.js";

interface PracticeMemoryFileV1 {
  readonly schema: "editflow.practice-learning-memory.v1";
  readonly episodes: readonly PracticeEpisodeV1[];
}

const readMemoryFile = async (filePath: string): Promise<PracticeMemoryFileV1> => {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<PracticeMemoryFileV1>;
    if (parsed.schema !== "editflow.practice-learning-memory.v1"
      || !Array.isArray(parsed.episodes)) {
      throw new TypeError("Practice learning memory file has an unsupported schema.");
    }
    return parsed as PracticeMemoryFileV1;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        schema: "editflow.practice-learning-memory.v1",
        episodes: [],
      };
    }
    throw error;
  }
};

export class PracticeLearningMemoryFileV1 {
  readonly filePath: string;
  #tail: Promise<void> = Promise.resolve();
  #sequence = 0;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async load(): Promise<PracticeLearningMemoryV1> {
    const retained = await readMemoryFile(this.filePath);
    const memory = new PracticeLearningMemoryV1();
    for (const episode of retained.episodes) {
      memory.remember(episode);
    }
    return memory;
  }

  recordEpisode = async (episode: PracticeEpisodeV1): Promise<void> => {
    const operation = this.#tail.then(async () => {
      const retained = await readMemoryFile(this.filePath);
      const bySession = new Map(
        retained.episodes.map((item) => [item.sessionId, item] as const),
      );
      bySession.set(episode.sessionId, structuredClone(episode));
      const payload: PracticeMemoryFileV1 = {
        schema: "editflow.practice-learning-memory.v1",
        episodes: [...bySession.values()]
          .sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
      };

      await mkdir(path.dirname(this.filePath), { recursive: true });
      this.#sequence += 1;
      const temporaryPath = `${this.filePath}.tmp-${process.pid}-${this.#sequence}`;
      await writeFile(
        temporaryPath,
        `${JSON.stringify(payload, null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, this.filePath);
    });
    this.#tail = operation.catch(() => undefined);
    await operation;
  };

  async snapshot(): Promise<readonly PracticeEpisodeV1[]> {
    return (await readMemoryFile(this.filePath)).episodes;
  }
}
