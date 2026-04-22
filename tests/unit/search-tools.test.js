import { describe, it, expect, vi } from "vitest";
import {
  searchHybridTool,
  searchLessonsTool,
  createToolExecutors,
} from "../../server/agent/workflow/search-tools.js";

// ─── Tool descriptors ─────────────────────────────────────────────────────────

describe("searchHybridTool descriptor", () => {
  it("has type 'function'", () => {
    expect(searchHybridTool.type).toBe("function");
  });

  it("has name 'search_hybrid'", () => {
    expect(searchHybridTool.function.name).toBe("search_hybrid");
  });

  it("has 'query' as required parameter", () => {
    expect(searchHybridTool.function.parameters.required).toContain("query");
  });

  it("defines 'query' and 'topK' properties", () => {
    const props = searchHybridTool.function.parameters.properties;
    expect(props).toHaveProperty("query");
    expect(props).toHaveProperty("topK");
  });
});

describe("searchLessonsTool descriptor", () => {
  it("has type 'function'", () => {
    expect(searchLessonsTool.type).toBe("function");
  });

  it("has name 'search_lessons'", () => {
    expect(searchLessonsTool.function.name).toBe("search_lessons");
  });

  it("has 'query' as required parameter", () => {
    expect(searchLessonsTool.function.parameters.required).toContain("query");
  });

  it("defines 'query' and 'limit' properties", () => {
    const props = searchLessonsTool.function.parameters.properties;
    expect(props).toHaveProperty("query");
    expect(props).toHaveProperty("limit");
  });
});

// ─── createToolExecutors ──────────────────────────────────────────────────────

function makeRag({ hybridDocs = [], lessonDocs = [] } = {}) {
  return {
    retrieveHybrid: vi.fn().mockResolvedValue(hybridDocs),
    retrieveLessons: vi.fn().mockResolvedValue(lessonDocs),
  };
}

describe("executeSearchHybrid", () => {
  it("returns fallback message when no docs found", async () => {
    const rag = makeRag({ hybridDocs: [] });
    const writer = vi.fn();
    const { executeSearchHybrid } = createToolExecutors(rag, writer);
    const result = await executeSearchHybrid({ query: "something" });
    expect(result).toBe("(nenhum trecho encontrado para esta busca)");
  });

  it("formats docs with lesson title, module and enrichedContent", async () => {
    const docs = [
      {
        metadata: { lesson_title: "Aula 1", lesson_module: "M1", enrichedContent: "Enriquecido." },
        pageContent: "Original.",
      },
    ];
    const rag = makeRag({ hybridDocs: docs });
    const writer = vi.fn();
    const { executeSearchHybrid } = createToolExecutors(rag, writer);
    const result = await executeSearchHybrid({ query: "q" });
    expect(result).toContain("[Aula: Aula 1 | Módulo: M1]");
    expect(result).toContain("Enriquecido.");
  });

  it("falls back to pageContent when enrichedContent is absent", async () => {
    const docs = [
      {
        metadata: { lesson_title: "Aula X", lesson_module: "M2" },
        pageContent: "Only page content.",
      },
    ];
    const rag = makeRag({ hybridDocs: docs });
    const writer = vi.fn();
    const { executeSearchHybrid } = createToolExecutors(rag, writer);
    const result = await executeSearchHybrid({ query: "q" });
    expect(result).toContain("Only page content.");
  });

  it("uses 'Aula desconhecida' and '-' when metadata is missing", async () => {
    const docs = [{ metadata: {}, pageContent: "content" }];
    const rag = makeRag({ hybridDocs: docs });
    const writer = vi.fn();
    const { executeSearchHybrid } = createToolExecutors(rag, writer);
    const result = await executeSearchHybrid({ query: "q" });
    expect(result).toContain("Aula desconhecida");
    expect(result).toContain("Módulo: -");
  });

  it("emits writer events (running and done)", async () => {
    const rag = makeRag({ hybridDocs: [] });
    const writer = vi.fn();
    const { executeSearchHybrid } = createToolExecutors(rag, writer);
    await executeSearchHybrid({ query: "q" });
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });

  it("passes topK to rag.retrieveHybrid", async () => {
    const rag = makeRag();
    const writer = vi.fn();
    const { executeSearchHybrid } = createToolExecutors(rag, writer);
    await executeSearchHybrid({ query: "q", topK: 5 });
    expect(rag.retrieveHybrid).toHaveBeenCalledWith("q", { topK: 5 });
  });

  it("uses default topK=8 when not provided", async () => {
    const rag = makeRag();
    const writer = vi.fn();
    const { executeSearchHybrid } = createToolExecutors(rag, writer);
    await executeSearchHybrid({ query: "q" });
    expect(rag.retrieveHybrid).toHaveBeenCalledWith("q", { topK: 8 });
  });
});

describe("executeSearchLessons", () => {
  it("returns fallback message when no docs found", async () => {
    const rag = makeRag({ lessonDocs: [] });
    const writer = vi.fn();
    const { executeSearchLessons } = createToolExecutors(rag, writer);
    const result = await executeSearchLessons({ query: "q" });
    expect(result).toBe("(nenhuma aula encontrada para este tema)");
  });

  it("formats docs with lesson title and module", async () => {
    const docs = [
      {
        metadata: { lesson_title: "Aula RAG", lesson_module: "M3" },
        pageContent: "Lesson summary.",
      },
    ];
    const rag = makeRag({ lessonDocs: docs });
    const writer = vi.fn();
    const { executeSearchLessons } = createToolExecutors(rag, writer);
    const result = await executeSearchLessons({ query: "q" });
    expect(result).toContain("[Aula: Aula RAG | Módulo: M3]");
    expect(result).toContain("Lesson summary.");
  });

  it("emits writer events (running and done)", async () => {
    const rag = makeRag({ lessonDocs: [] });
    const writer = vi.fn();
    const { executeSearchLessons } = createToolExecutors(rag, writer);
    await executeSearchLessons({ query: "q" });
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });

  it("passes limit to rag.retrieveLessons", async () => {
    const rag = makeRag();
    const writer = vi.fn();
    const { executeSearchLessons } = createToolExecutors(rag, writer);
    await executeSearchLessons({ query: "q", limit: 5 });
    expect(rag.retrieveLessons).toHaveBeenCalledWith("q", 5);
  });

  it("uses default limit=3 when not provided", async () => {
    const rag = makeRag();
    const writer = vi.fn();
    const { executeSearchLessons } = createToolExecutors(rag, writer);
    await executeSearchLessons({ query: "q" });
    expect(rag.retrieveLessons).toHaveBeenCalledWith("q", 3);
  });
});
