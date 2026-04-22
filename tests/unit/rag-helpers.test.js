import { describe, it, expect } from "vitest";
import {
  splitContextualContent,
  reciprocalRankFusion,
  keyOf,
  fts5Escape,
  normalizeQuery,
  truncateForEmbedding,
  bufferToFloat64Array,
  safeParseArray,
} from "../../server/agent/rag-helpers.js";

// ─── splitContextualContent ───────────────────────────────────────────────────

describe("splitContextualContent", () => {
  it("splits enriched content at double newline after [Resumo da aula:]", () => {
    const content = "[Resumo da aula: Overview]\n\nThe real content here.";
    const { original, enriched } = splitContextualContent(content);
    expect(original).toBe("The real content here.");
    expect(enriched).toBe(content);
  });

  it("returns original === enriched when no [Resumo da aula:] marker", () => {
    const content = "Just plain content without marker.";
    const { original, enriched } = splitContextualContent(content);
    expect(original).toBe(content);
    expect(enriched).toBe(content);
  });

  it("returns original === enriched when separator not found after marker", () => {
    const content = "[Resumo da aula: Summary without double newline]";
    const { original, enriched } = splitContextualContent(content);
    expect(original).toBe(content);
    expect(enriched).toBe(content);
  });

  it("handles full contextual chunk format", () => {
    const content = [
      "[Módulo: M1]",
      "[Aula: Intro]",
      "[Tópicos da aula: a, b]",
      "[Resumo da aula: The summary]",
      "",
      "Content body goes here.",
    ].join("\n");
    const { original, enriched } = splitContextualContent(content);
    expect(original).toBe("Content body goes here.");
    expect(enriched).toBe(content);
  });
});

// ─── reciprocalRankFusion ─────────────────────────────────────────────────────

const doc = (id, content = "") => ({
  metadata: { chunk_id: id },
  pageContent: content || `content-${id}`,
});

describe("reciprocalRankFusion", () => {
  it("returns topK results", () => {
    const a = [doc("a"), doc("b"), doc("c")];
    const b = [doc("d"), doc("e"), doc("f")];
    const result = reciprocalRankFusion(a, b, 2);
    expect(result).toHaveLength(2);
  });

  it("ranks docs that appear in both lists higher", () => {
    const a = [doc("shared"), doc("only-a")];
    const b = [doc("shared"), doc("only-b")];
    const result = reciprocalRankFusion(a, b, 3);
    expect(result[0].metadata.chunk_id).toBe("shared");
  });

  it("deduplicates — same doc appears once in output", () => {
    const a = [doc("x"), doc("y")];
    const b = [doc("x"), doc("z")];
    const result = reciprocalRankFusion(a, b, 10);
    const ids = result.map((d) => d.metadata.chunk_id);
    expect(ids.filter((id) => id === "x")).toHaveLength(1);
  });

  it("handles empty listA", () => {
    const b = [doc("a"), doc("b")];
    const result = reciprocalRankFusion([], b, 5);
    expect(result).toHaveLength(2);
  });

  it("handles empty listB", () => {
    const a = [doc("a"), doc("b")];
    const result = reciprocalRankFusion(a, [], 5);
    expect(result).toHaveLength(2);
  });

  it("handles both lists empty", () => {
    expect(reciprocalRankFusion([], [], 5)).toHaveLength(0);
  });

  it("respects topK even when merged list is larger", () => {
    const a = Array.from({ length: 10 }, (_, i) => doc(`a${i}`));
    const b = Array.from({ length: 10 }, (_, i) => doc(`b${i}`));
    expect(reciprocalRankFusion(a, b, 5)).toHaveLength(5);
  });
});

// ─── keyOf ────────────────────────────────────────────────────────────────────

describe("keyOf", () => {
  it("returns chunk_id when present", () => {
    expect(keyOf({ metadata: { chunk_id: "abc" }, pageContent: "text" })).toBe("abc");
  });

  it("falls back to pageContent when chunk_id is absent", () => {
    expect(keyOf({ metadata: {}, pageContent: "fallback" })).toBe("fallback");
  });

  it("falls back to pageContent when metadata is absent", () => {
    expect(keyOf({ pageContent: "only content" })).toBe("only content");
  });
});

// ─── fts5Escape ───────────────────────────────────────────────────────────────

describe("fts5Escape", () => {
  it("wraps each token in quotes and joins with OR", () => {
    expect(fts5Escape("foo bar")).toBe('"foo" OR "bar"');
  });

  it("strips special characters", () => {
    const result = fts5Escape("foo! bar?");
    expect(result).not.toContain("!");
    expect(result).not.toContain("?");
  });

  it("filters tokens shorter than 2 characters", () => {
    expect(fts5Escape("a bb ccc")).toBe('"bb" OR "ccc"');
  });

  it("returns empty string for query that becomes empty after filtering", () => {
    expect(fts5Escape("! ? a")).toBe("");
  });

  it("handles unicode words", () => {
    const result = fts5Escape("embeddings são vetores");
    expect(result).toContain('"embeddings"');
    expect(result).toContain('"são"');
    expect(result).toContain('"vetores"');
  });
});

// ─── normalizeQuery ───────────────────────────────────────────────────────────

describe("normalizeQuery", () => {
  it("trims whitespace from string", () => {
    expect(normalizeQuery("  hello  ")).toBe("hello");
  });

  it("returns empty string for non-string values", () => {
    expect(normalizeQuery(null)).toBe("");
    expect(normalizeQuery(undefined)).toBe("");
    expect(normalizeQuery(42)).toBe("");
    expect(normalizeQuery({})).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(normalizeQuery("")).toBe("");
  });
});

// ─── truncateForEmbedding ─────────────────────────────────────────────────────

describe("truncateForEmbedding", () => {
  it("returns text unchanged when under limit", () => {
    const short = "Hello world";
    expect(truncateForEmbedding(short)).toBe(short);
  });

  it("truncates to maxChars when over limit", () => {
    const long = "x".repeat(2000);
    const result = truncateForEmbedding(long, 1400);
    expect(result).toHaveLength(1400);
  });

  it("accepts custom maxChars", () => {
    const text = "abcdefghij";
    expect(truncateForEmbedding(text, 5)).toBe("abcde");
  });

  it("returns text exactly at limit unchanged", () => {
    const text = "a".repeat(1400);
    expect(truncateForEmbedding(text)).toBe(text);
  });
});

// ─── bufferToFloat64Array ─────────────────────────────────────────────────────

describe("bufferToFloat64Array", () => {
  it("converts Float32 Buffer back to numeric array", () => {
    const original = new Float32Array([0.1, 0.5, -0.3, 1.0]);
    const buf = Buffer.from(original.buffer);
    const result = bufferToFloat64Array(buf);
    expect(result).toHaveLength(4);
    expect(result[0]).toBeCloseTo(0.1, 5);
    expect(result[1]).toBeCloseTo(0.5, 5);
    expect(result[2]).toBeCloseTo(-0.3, 5);
    expect(result[3]).toBeCloseTo(1.0, 5);
  });

  it("returns a plain JS array (not Float32Array)", () => {
    const f32 = new Float32Array([1, 2, 3]);
    const buf = Buffer.from(f32.buffer);
    const result = bufferToFloat64Array(buf);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── safeParseArray ───────────────────────────────────────────────────────────

describe("safeParseArray", () => {
  it("parses valid JSON array", () => {
    expect(safeParseArray('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  it("returns [] for non-array JSON", () => {
    expect(safeParseArray('{"key":"val"}')).toEqual([]);
    expect(safeParseArray('"string"')).toEqual([]);
  });

  it("returns [] for invalid JSON", () => {
    expect(safeParseArray("not json")).toEqual([]);
    expect(safeParseArray("")).toEqual([]);
  });

  it("returns [] for null or undefined", () => {
    expect(safeParseArray(null)).toEqual([]);
    expect(safeParseArray(undefined)).toEqual([]);
  });
});
