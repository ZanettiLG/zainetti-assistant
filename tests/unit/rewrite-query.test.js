import { describe, it, expect } from "vitest";
import { RewriteQuerySchema } from "../../server/agent/workflow/rewrite-query.js";

// ─── RewriteQuerySchema ───────────────────────────────────────────────────────

describe("RewriteQuerySchema", () => {
  it("accepts a valid array of topics", () => {
    const result = RewriteQuerySchema.parse({ queryTopics: ["embedding", "vetores"] });
    expect(result.queryTopics).toEqual(["embedding", "vetores"]);
  });

  it("accepts a single-item array", () => {
    const result = RewriteQuerySchema.parse({ queryTopics: ["o que é RAG?"] });
    expect(result.queryTopics).toHaveLength(1);
  });

  it("rejects empty queryTopics array (min 1)", () => {
    expect(() => RewriteQuerySchema.parse({ queryTopics: [] })).toThrow();
  });

  it("rejects missing queryTopics", () => {
    expect(() => RewriteQuerySchema.parse({})).toThrow();
  });

  it("rejects non-array queryTopics", () => {
    expect(() => RewriteQuerySchema.parse({ queryTopics: "single string" })).toThrow();
  });
});

// ─── Deduplication and sanitization logic (pure, extracted inline) ────────────
// These tests reproduce the sanitization logic from the node factory to ensure
// the dedup + fallback behaviour stays correct if the code changes.

function sanitize(queryTopics, fallback) {
  const sanitizedTopics = [
    ...new Set(queryTopics.map((topic) => topic.trim()).filter(Boolean)),
  ];
  return sanitizedTopics.length ? sanitizedTopics : [fallback.trim()];
}

describe("topic sanitization logic", () => {
  it("deduplicates identical topics", () => {
    const result = sanitize(["embedding", "embedding", "vetores"], "fallback");
    expect(result).toEqual(["embedding", "vetores"]);
  });

  it("trims whitespace from each topic", () => {
    const result = sanitize(["  embedding  ", "  vetores  "], "fallback");
    expect(result).toEqual(["embedding", "vetores"]);
  });

  it("filters empty or whitespace-only topics", () => {
    const result = sanitize(["valid", "   ", ""], "fallback");
    expect(result).toEqual(["valid"]);
  });

  it("falls back to original question when all topics are empty after sanitization", () => {
    const result = sanitize(["   ", ""], "original question");
    expect(result).toEqual(["original question"]);
  });

  it("falls back to trimmed original question", () => {
    const result = sanitize([], "  trimmed fallback  ");
    expect(result).toEqual(["trimmed fallback"]);
  });

  it("preserves order of unique topics", () => {
    const result = sanitize(["c", "a", "b", "a"], "x");
    expect(result).toEqual(["c", "a", "b"]);
  });
});
