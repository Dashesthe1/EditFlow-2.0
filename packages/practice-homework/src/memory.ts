import type { PracticeEpisodeV1 } from "./contracts.js";

export class PracticeLearningMemoryV1 {
  readonly #episodes = new Map<string, PracticeEpisodeV1>();

  remember(episode: PracticeEpisodeV1): void {
    this.#episodes.set(episode.sessionId, structuredClone(episode));
  }

  get(sessionId: string): PracticeEpisodeV1 | null {
    const episode = this.#episodes.get(sessionId);
    return episode === undefined ? null : structuredClone(episode);
  }

  successfulExamples(styleFingerprint?: string): readonly PracticeEpisodeV1[] {
    return [...this.#episodes.values()]
      .filter((episode) => episode.mastered)
      .filter((episode) => styleFingerprint === undefined
        || episode.styleFingerprint === styleFingerprint)
      .map((episode) => structuredClone(episode));
  }

  snapshot(): readonly PracticeEpisodeV1[] {
    return [...this.#episodes.values()].map((episode) => structuredClone(episode));
  }

  get size(): number {
    return this.#episodes.size;
  }
}
