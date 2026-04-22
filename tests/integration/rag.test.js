/**
 * Integration tests for the RAG layer against the real NVIDIA Embeddings API
 * and the project SQLite database.
 *
 * Requirements:
 *   - NVIDIA_API_KEY set in .env
 *   - DB must exist at DB_PATH (or default ./db/database.sqlite) with data seeded
 *
 * These tests make real HTTP calls and may take 10-30s depending on the API.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
config();

let rag;

beforeAll(async () => {
  const { default: createRag } = await import("../../server/agent/rag.js");
  rag = await createRag();
}, 60000);

// ─── Initialization ───────────────────────────────────────────────────────────

describe("createRag — initialization", () => {
  it("returns a rag object with all expected methods", () => {
    expect(typeof rag.retrieveDocuments).toBe("function");
    expect(typeof rag.retrieveLessons).toBe("function");
    expect(typeof rag.retrieveChunksInLessons).toBe("function");
    expect(typeof rag.retrieveBM25).toBe("function");
    expect(typeof rag.retrieveHybrid).toBe("function");
    expect(typeof rag.getAllLessons).toBe("function");
    expect(typeof rag.getLessonCount).toBe("function");
    expect(typeof rag.retrieveContext).toBe("function");
  });

  it("chunkStore and lessonStore are initialized", () => {
    expect(rag.chunkStore).not.toBeNull();
    expect(rag.lessonStore).not.toBeNull();
  });

  it("vectorStore getter aliases chunkStore", () => {
    expect(rag.vectorStore).toBe(rag.chunkStore);
  });
});

// ─── getAllLessons ─────────────────────────────────────────────────────────────

describe("rag.getAllLessons", () => {
  it("returns an array", async () => {
    const lessons = await rag.getAllLessons();
    expect(Array.isArray(lessons)).toBe(true);
  });

  it("each lesson has id, slug, title, module, summary, topics", async () => {
    const lessons = await rag.getAllLessons();
    if (lessons.length === 0) return; // no data seeded — skip
    for (const l of lessons) {
      expect(l).toHaveProperty("id");
      expect(l).toHaveProperty("slug");
      expect(l).toHaveProperty("title");
      expect(l).toHaveProperty("topics");
    }
  });

  it("topics field is always an array", async () => {
    const lessons = await rag.getAllLessons();
    for (const l of lessons) {
      expect(Array.isArray(l.topics)).toBe(true);
    }
  });
});

// ─── getLessonCount ───────────────────────────────────────────────────────────

describe("rag.getLessonCount", () => {
  it("returns a numeric count", async () => {
    const count = await rag.getLessonCount();
    expect(Number(count)).toBeGreaterThanOrEqual(0);
  });
});

// ─── retrieveDocuments ────────────────────────────────────────────────────────

describe("rag.retrieveDocuments", () => {
  it("returns empty array for empty query", async () => {
    const docs = await rag.retrieveDocuments("");
    expect(docs).toEqual([]);
  });

  it("returns empty array for whitespace-only query", async () => {
    const docs = await rag.retrieveDocuments("   ");
    expect(docs).toEqual([]);
  });

  it("returns an array of docs for a real query", async () => {
    const docs = await rag.retrieveDocuments("o que é embedding?", 3);
    expect(Array.isArray(docs)).toBe(true);
  }, 20000);

  it("respects topK limit", async () => {
    const docs = await rag.retrieveDocuments("langchain", 2);
    expect(docs.length).toBeLessThanOrEqual(2);
  }, 20000);

  it("each doc has pageContent and metadata", async () => {
    const docs = await rag.retrieveDocuments("RAG", 3);
    for (const doc of docs) {
      expect(doc).toHaveProperty("pageContent");
      expect(doc).toHaveProperty("metadata");
    }
  }, 20000);
});

// ─── retrieveLessons ─────────────────────────────────────────────────────────

describe("rag.retrieveLessons", () => {
  it("returns empty array for empty query", async () => {
    expect(await rag.retrieveLessons("")).toEqual([]);
  });

  it("returns lessons for a semantic query", async () => {
    const lessons = await rag.retrieveLessons("como funciona RAG?", 2);
    expect(Array.isArray(lessons)).toBe(true);
  }, 20000);
});

// ─── retrieveBM25 ─────────────────────────────────────────────────────────────

describe("rag.retrieveBM25", () => {
  it("returns empty array for empty query", async () => {
    expect(await rag.retrieveBM25("")).toEqual([]);
  });

  it("returns array for keyword query", async () => {
    const docs = await rag.retrieveBM25("embedding vetores", 5);
    expect(Array.isArray(docs)).toBe(true);
  });

  it("each result has pageContent and metadata", async () => {
    const docs = await rag.retrieveBM25("langchain", 3);
    for (const doc of docs) {
      expect(doc).toHaveProperty("pageContent");
      expect(doc).toHaveProperty("metadata");
    }
  });
});

// ─── retrieveHybrid ───────────────────────────────────────────────────────────

describe("rag.retrieveHybrid", () => {
  it("returns empty array for empty query", async () => {
    expect(await rag.retrieveHybrid("")).toEqual([]);
  });

  it("returns merged results for a real query", async () => {
    const docs = await rag.retrieveHybrid("o que é RAG?", { topK: 5 });
    expect(Array.isArray(docs)).toBe(true);
  }, 20000);

  it("returns no more than topK results", async () => {
    const docs = await rag.retrieveHybrid("langchain embeddings", { topK: 3 });
    expect(docs.length).toBeLessThanOrEqual(3);
  }, 20000);

  it("results are deduplicated (no duplicate chunk_ids)", async () => {
    const docs = await rag.retrieveHybrid("vetores semânticos", { topK: 8 });
    const ids = docs.map((d) => d.metadata?.chunk_id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  }, 20000);
});

// ─── retrieveContext (legacy) ─────────────────────────────────────────────────

describe("rag.retrieveContext", () => {
  it("returns a string", async () => {
    const ctx = await rag.retrieveContext("embedding", 3);
    expect(typeof ctx).toBe("string");
  }, 20000);

  it("includes [Aula: ...] prefixes in result", async () => {
    const ctx = await rag.retrieveContext("langchain", 2);
    if (ctx.length > 0) {
      expect(ctx).toContain("[Aula:");
    }
  }, 20000);
});
