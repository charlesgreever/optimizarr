import { describe, expect, it } from "vitest";
import { shouldQueueNewImport } from "./auto-queue.ts";
import { DEFAULT_SETTINGS, type Suggestion } from "./types.ts";

const suggestion: Suggestion = {
  id: "s1",
  itemId: "m1",
  actions: ["tracks"],
  reasons: ["Drop extra audio."],
  warning: null,
  category: "movie1080p",
  estimatedSavingsBytes: null,
  now: { codec: "h264", quality: "WEBDL-1080p", sizeBytes: 1, sizePerHourGb: 1 },
  after: { codec: "h264", quality: null, sizeBytes: null, sizePerHourGb: null },
  dismissed: false,
  keepAudio: [1],
  stripAudio: [2],
  keepSubs: [],
  stripSubs: [],
};

function settings(over: { queueNewImports?: boolean; queueNewImportsSince?: number; languageConfirmed?: boolean; reviewPath?: string } = {}) {
  return {
    ...DEFAULT_SETTINGS,
    languageConfirmed: over.languageConfirmed ?? true,
    reviewPath: over.reviewPath ?? "/review",
    queueNewImportsSince: over.queueNewImportsSince ?? 1_000,
    suggestionDefaults: {
      ...DEFAULT_SETTINGS.suggestionDefaults,
      queueNewImports: over.queueNewImports ?? true,
    },
  };
}

describe("auto-queue new Arr imports", () => {
  it("queues a sidecar only for files first seen or changed after the setting was turned on", () => {
    expect(shouldQueueNewImport({
      settings: settings({ queueNewImports: false }),
      item: { firstSeenAt: 2_000, fileChangedAt: 2_000 },
      suggestion,
    })).toBe(false);
    expect(shouldQueueNewImport({
      settings: settings({ queueNewImports: true, queueNewImportsSince: 0 }),
      item: { firstSeenAt: 2_000, fileChangedAt: 2_000 },
      suggestion,
    })).toBe(false);
    expect(shouldQueueNewImport({
      settings: settings(),
      item: { firstSeenAt: 0, fileChangedAt: 0 },
      suggestion,
    })).toBe(false);
    expect(shouldQueueNewImport({
      settings: settings(),
      item: { firstSeenAt: 2_000, fileChangedAt: 2_000 },
      suggestion: null,
    })).toBe(false);
    expect(shouldQueueNewImport({
      settings: settings(),
      item: { firstSeenAt: 2_000, fileChangedAt: 2_000 },
      suggestion: { ...suggestion, actions: ["search_language"], stripAudio: [], keepAudio: [1] },
    })).toBe(false);
    expect(shouldQueueNewImport({
      settings: settings(),
      item: { firstSeenAt: 2_000, fileChangedAt: 500 },
      suggestion,
    })).toBe(true);
    expect(shouldQueueNewImport({
      settings: settings(),
      item: { firstSeenAt: 0, fileChangedAt: 2_000 },
      suggestion,
    })).toBe(true);
    expect(shouldQueueNewImport({
      settings: settings({ languageConfirmed: false }),
      item: { firstSeenAt: 2_000, fileChangedAt: 2_000 },
      suggestion,
    })).toBe(false);
  });
});
