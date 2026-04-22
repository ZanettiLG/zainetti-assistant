import { describe, it, expect } from "vitest";
import { dedup } from "../../server/agent/workflow/retrieve-docs.js";

const doc = (chunkId, content = "") => ({
  metadata: { chunk_id: chunkId, lesson_id: 1 },
  pageContent: content || `content-${chunkId}`,
});

const docNoId = (content) => ({
  metadata: {},
  pageContent: content,
});

// ─── dedup ────────────────────────────────────────────────────────────────────

describe("dedup", () => {
  it("removes duplicate docs by chunk_id", () => {
    const docs = [doc("a"), doc("b"), doc("a")];
    const result = dedup(docs);
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.metadata.chunk_id)).toEqual(["a", "b"]);
  });

  it("preserves insertion order (first occurrence wins)", () => {
    const docs = [doc("z"), doc("a"), doc("z")];
    const result = dedup(docs);
    expect(result[0].metadata.chunk_id).toBe("z");
    expect(result[1].metadata.chunk_id).toBe("a");
  });

  it("falls back to pageContent when chunk_id is absent", () => {
    const docs = [docNoId("same content"), docNoId("same content"), docNoId("different")];
    const result = dedup(docs);
    expect(result).toHaveLength(2);
    expect(result[0].pageContent).toBe("same content");
    expect(result[1].pageContent).toBe("different");
  });

  it("handles empty array", () => {
    expect(dedup([])).toEqual([]);
  });

  it("handles single doc", () => {
    expect(dedup([doc("x")])).toHaveLength(1);
  });

  it("returns all docs when none are duplicates", () => {
    const docs = [doc("a"), doc("b"), doc("c")];
    expect(dedup(docs)).toHaveLength(3);
  });
});

// ─── coverage logic (pure, reproduced inline) ────────────────────────────────

const BROAD_INTENTS = new Set(["ampla", "comparativa"]);
const MIN_DISTINCT_LESSONS_BROAD = 2;

function computeCoverage(intent, allDocs) {
  const isBroad = BROAD_INTENTS.has(intent);
  const distinctLessonIds = [
    ...new Set(
      allDocs
        .map((d) => d.metadata?.lesson_id)
        .filter((id) => id !== undefined && id !== null)
    ),
  ];
  const sufficient = isBroad
    ? distinctLessonIds.length >= MIN_DISTINCT_LESSONS_BROAD
    : allDocs.length > 0;
  return { lesson_ids: distinctLessonIds, sufficient };
}

describe("coverage logic", () => {
  it("sufficient=true for broad intent with >= 2 distinct lessons", () => {
    const docs = [
      { metadata: { lesson_id: 1 }, pageContent: "a" },
      { metadata: { lesson_id: 2 }, pageContent: "b" },
    ];
    const { sufficient } = computeCoverage("ampla", docs);
    expect(sufficient).toBe(true);
  });

  it("sufficient=false for broad intent with < 2 distinct lessons", () => {
    const docs = [{ metadata: { lesson_id: 1 }, pageContent: "a" }];
    expect(computeCoverage("ampla", docs).sufficient).toBe(false);
    expect(computeCoverage("comparativa", docs).sufficient).toBe(false);
  });

  it("sufficient=true for non-broad intent when docs.length > 0", () => {
    const docs = [{ metadata: { lesson_id: 1 }, pageContent: "a" }];
    expect(computeCoverage("pontual", docs).sufficient).toBe(true);
    expect(computeCoverage("localizadora", docs).sufficient).toBe(true);
  });

  it("sufficient=false for non-broad intent when docs is empty", () => {
    expect(computeCoverage("pontual", []).sufficient).toBe(false);
  });

  it("lesson_ids contains only unique IDs", () => {
    const docs = [
      { metadata: { lesson_id: 1 } },
      { metadata: { lesson_id: 1 } },
      { metadata: { lesson_id: 2 } },
    ];
    const { lesson_ids } = computeCoverage("pontual", docs);
    expect(lesson_ids).toEqual([1, 2]);
  });

  it("lesson_ids excludes null/undefined lesson_id", () => {
    const docs = [
      { metadata: { lesson_id: null } },
      { metadata: {} },
      { metadata: { lesson_id: 1 } },
    ];
    const { lesson_ids } = computeCoverage("pontual", docs);
    expect(lesson_ids).toEqual([1]);
  });
});
