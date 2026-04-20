import db from "../database.js";
import { createEmbeddingsModel } from "./models.js";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Separa conteúdo enriquecido (prefixo contextual) do original.
 * O prefixo termina com uma linha vazia após "[Resumo da aula: ...]".
 */
function splitContextualContent(content) {
  const separator = "\n\n";
  const idx = content.indexOf(separator, content.indexOf("[Resumo da aula:"));
  if (idx === -1) return { original: content, enriched: content };
  return {
    original: content.slice(idx + separator.length),
    enriched: content,
  };
}

/**
 * Reciprocal Rank Fusion — combina duas listas rankeadas em uma.
 */
function reciprocalRankFusion(listA, listB, topK, k = 60) {
  const scores = new Map();
  const docMap = new Map();

  for (const [i, doc] of listA.entries()) {
    const key = keyOf(doc);
    scores.set(key, (scores.get(key) ?? 0) + 1 / (k + i + 1));
    if (!docMap.has(key)) docMap.set(key, doc);
  }
  for (const [i, doc] of listB.entries()) {
    const key = keyOf(doc);
    scores.set(key, (scores.get(key) ?? 0) + 1 / (k + i + 1));
    if (!docMap.has(key)) docMap.set(key, doc);
  }

  return [...scores.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, topK)
    .map(([key]) => docMap.get(key));
}

function keyOf(doc) {
  return doc.metadata?.chunk_id ?? doc.pageContent;
}

/**
 * Escapa uma query para FTS5 MATCH.
 */
function fts5Escape(query) {
  return query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => `"${t}"`)
    .join(" OR ");
}

/**
 * Trunca texto para caber no limite de tokens do modelo de embeddings.
 * Estimativa conservadora: ~4 chars por token, limite 512 tokens → ~1800 chars.
 */
function truncateForEmbedding(text, maxChars = 1400) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

/**
 * Converte Buffer (BLOB) de volta para Float64Array (que é o que MemoryVectorStore usa).
 * Os embeddings são armazenados como Float32Array para economia de espaço.
 */
function bufferToFloat64Array(buf) {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}

// ─── RAG Factory ────────────────────────────────────────────────────────────

export const createRag = async () => {
  const embeddingsModel = createEmbeddingsModel();

  const rag = {
    model: embeddingsModel,
    chunkStore: null,
    lessonStore: null,
  };

  // ─── Lookup maps (chunk_id → metadata completa) ──────────────────────────
  const chunkMetaMap = new Map();

  // ─── Init ────────────────────────────────────────────────────────────────

  async function init() {
    console.log("Loading data and building vector stores...");

    // ── Lessons index (resumo por aula → embedding) ────────────────────────
    const lessons = await db("lessons").select(
      "id",
      "slug",
      "title",
      "module",
      "summary",
      "topics",
      "embedding",
      "embedding_dim",
    );

    rag.lessonStore = new MemoryVectorStore(embeddingsModel);

    if (lessons.length > 0) {
      const hasPersistedEmbeddings = lessons.every((l) => l.embedding != null);

      if (hasPersistedEmbeddings) {
        // Carrega embeddings do DB — sem chamadas à API
        console.log("  Loading lesson embeddings from database (no API calls)...");
        for (const l of lessons) {
          const topics =
            typeof l.topics === "string" ? safeParseArray(l.topics) : l.topics;
          const doc = {
            pageContent: `${l.title}. ${l.summary} Tópicos: ${topics.join(", ")}`,
            metadata: {
              lesson_id: l.id,
              lesson_slug: l.slug,
              lesson_title: l.title,
              lesson_module: l.module,
            },
          };
          const embedding = bufferToFloat64Array(l.embedding);
          rag.lessonStore.memoryVectors.push({
            content: doc.pageContent,
            embedding,
            metadata: doc.metadata,
          });
        }
      } else {
        // Fallback: computar via API (primeiro uso antes do seed com embeddings)
        console.log("  Computing lesson embeddings via API (no persisted embeddings)...");
        const lessonDocs = lessons.map((l) => {
          const topics =
            typeof l.topics === "string" ? safeParseArray(l.topics) : l.topics;
          const text = `${l.title}. ${l.summary} Tópicos: ${topics.join(", ")}`;
          return {
            pageContent: truncateForEmbedding(text),
            metadata: {
              lesson_id: l.id,
              lesson_slug: l.slug,
              lesson_title: l.title,
              lesson_module: l.module,
            },
          };
        });
        await rag.lessonStore.addDocuments(lessonDocs);
      }
      console.log(`  Lesson store: ${lessons.length} lesson(s).`);
    }

    // ── Chunks index (conteúdo original → embedding) ───────────────────────
    const rows = await db("chunks as c")
      .leftJoin("lessons as l", "l.id", "c.lesson_id")
      .select(
        "c.id as chunk_id",
        "c.content",
        "c.chunk_index",
        "c.source_file",
        "c.lesson_id",
        "c.embedding",
        "c.embedding_dim",
        "l.slug as lesson_slug",
        "l.title as lesson_title",
        "l.module as lesson_module",
      );

    rag.chunkStore = new MemoryVectorStore(embeddingsModel);

    const hasPersistedChunkEmbeddings = rows.length > 0 && rows.every((r) => r.embedding != null);

    if (hasPersistedChunkEmbeddings) {
      console.log("  Loading chunk embeddings from database (no API calls)...");
      for (const r of rows) {
        const { original, enriched } = splitContextualContent(r.content);
        const meta = {
          chunk_id: r.chunk_id,
          chunk_index: r.chunk_index,
          lesson_id: r.lesson_id,
          lesson_slug: r.lesson_slug,
          lesson_title: r.lesson_title ?? "Aula desconhecida",
          lesson_module: r.lesson_module ?? null,
          source: r.source_file,
          enrichedContent: enriched,
        };
        chunkMetaMap.set(r.chunk_id, meta);

        const embedding = bufferToFloat64Array(r.embedding);
        rag.chunkStore.memoryVectors.push({
          content: original,
          embedding,
          metadata: meta,
        });
      }
    } else {
      console.log("  Computing chunk embeddings via API (no persisted embeddings)...");
      const chunkDocs = rows.map((r) => {
        const { original, enriched } = splitContextualContent(r.content);
        const meta = {
          chunk_id: r.chunk_id,
          chunk_index: r.chunk_index,
          lesson_id: r.lesson_id,
          lesson_slug: r.lesson_slug,
          lesson_title: r.lesson_title ?? "Aula desconhecida",
          lesson_module: r.lesson_module ?? null,
          source: r.source_file,
          enrichedContent: enriched,
        };
        chunkMetaMap.set(r.chunk_id, meta);
        return { pageContent: truncateForEmbedding(original), metadata: meta };
      });

      if (chunkDocs.length > 0) {
        await rag.chunkStore.addDocuments(chunkDocs);
      }
    }

    console.log(
      `  Chunk store: ${rows.length} chunk(s) from ${lessons.length} lesson(s).`,
    );
  }

  // ─── Retrieval: vetorial direto em chunks ────────────────────────────────

  rag.retrieveDocuments = async (query, topK = 5) => {
    const docs = await rag.chunkStore.similaritySearch(query, topK);
    return docs;
  };

  // ─── Retrieval: nível de aula ────────────────────────────────────────────

  rag.retrieveLessons = async (query, topN = 3) => {
    return rag.lessonStore.similaritySearch(query, topN);
  };

  rag.retrieveChunksInLessons = async (query, lessonIds, topK = 3) => {
    const candidates = await rag.chunkStore.similaritySearchWithScore(
      query,
      Math.max(50, topK * 5),
    );
    return candidates
      .filter(([doc]) => lessonIds.includes(doc.metadata.lesson_id))
      .slice(0, topK)
      .map(([doc]) => doc);
  };

  // ─── Retrieval: BM25 via SQLite FTS5 ────────────────────────────────────

  rag.retrieveBM25 = async (query, topK = 20) => {
    const escaped = fts5Escape(query);
    if (!escaped) return [];

    try {
      const rows = await db.raw(
        `SELECT chunk_id, lesson_id, content, bm25(chunks_fts) AS score
         FROM chunks_fts
         WHERE chunks_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
        [escaped, topK],
      );
      return rows.map((r) => {
        const meta = chunkMetaMap.get(r.chunk_id);
        const { original, enriched } = splitContextualContent(r.content);
        return {
          pageContent: original,
          metadata: meta ?? {
            chunk_id: r.chunk_id,
            lesson_id: r.lesson_id,
            enrichedContent: enriched,
          },
        };
      });
    } catch (err) {
      console.warn("BM25 search failed, falling back to empty:", err.message);
      return [];
    }
  };

  // ─── Retrieval: Hybrid (vetor + BM25 + RRF) ─────────────────────────────

  rag.retrieveHybrid = async (query, { topK = 8, vecK = 20, bmK = 20 } = {}) => {
    const [vec, bm] = await Promise.all([
      rag.chunkStore.similaritySearch(query, vecK),
      rag.retrieveBM25(query, bmK),
    ]);
    return reciprocalRankFusion(vec, bm, topK);
  };

  // ─── Retrieval: todas as aulas (para broad-context) ─────────────────────

  rag.getAllLessons = async () => {
    const rows = await db("lessons").select("id", "slug", "title", "module", "summary", "topics");
    return rows.map((r) => ({
      ...r,
      topics: typeof r.topics === "string" ? safeParseArray(r.topics) : r.topics,
    }));
  };

  rag.getLessonCount = async () => {
    const [{ count }] = await db("lessons").count("* as count");
    return count;
  };

  // ─── Legacy compat ──────────────────────────────────────────────────────

  rag.retrieveContext = async (query, topK = 5) => {
    const docs = await rag.retrieveDocuments(query, topK);
    return docs
      .map((d) => {
        const lesson = d.metadata?.lesson_title ?? "Aula desconhecida";
        return `[Aula: ${lesson}]\n${d.pageContent}`;
      })
      .join("\n\n");
  };

  Object.defineProperty(rag, "vectorStore", {
    get() {
      return rag.chunkStore;
    },
  });

  await init();

  return rag;
};

function safeParseArray(str) {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default createRag;
