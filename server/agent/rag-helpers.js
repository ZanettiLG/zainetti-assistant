/**
 * Pure helper functions extracted from rag.js for unit testing.
 * These are NOT part of the public RAG API — they live here to be importable by tests.
 */

/**
 * Separa conteúdo enriquecido (prefixo contextual) do original.
 */
export function splitContextualContent(content) {
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
export function reciprocalRankFusion(listA, listB, topK, k = 60) {
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

export function keyOf(doc) {
  return doc.metadata?.chunk_id ?? doc.pageContent;
}

/**
 * Escapa uma query para FTS5 MATCH.
 */
export function fts5Escape(query) {
  return query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => `"${t}"`)
    .join(" OR ");
}

export function normalizeQuery(query) {
  return typeof query === "string" ? query.trim() : "";
}

/**
 * Trunca texto para caber no limite de tokens do modelo de embeddings.
 */
export function truncateForEmbedding(text, maxChars = 1400) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

/**
 * Converte Buffer (BLOB) de volta para Float64Array.
 */
export function bufferToFloat64Array(buf) {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}

export function safeParseArray(str) {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
