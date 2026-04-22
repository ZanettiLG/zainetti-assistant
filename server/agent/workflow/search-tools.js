export const searchHybridTool = {
  type: "function",
  function: {
    name: "search_hybrid",
    description: "Busca vetorial + BM25 (RRF) para encontrar trechos relevantes nas aulas.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Query de busca" },
        topK: { type: "number", description: "Número de resultados (default 8)" }
      },
      required: ["query"]
    }
  }
};

export const searchLessonsTool = {
  type: "function",
  function: {
    name: "search_lessons",
    description: "Identifica as aulas mais relevantes para um tema. Use para intents 'ampla' ou 'comparativa'.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Tema para identificar aulas" },
        limit: { type: "number", description: "Número de aulas (default 3)" }
      },
      required: ["query"]
    }
  }
};

export function createToolExecutors(rag, writer) {
  async function executeSearchHybrid({ query, topK = 8 }) {
    writer({
      step: `Busca: "${query}"`,
      status: "running",
      progress: `Buscando "${query}"...`,
    });

    const docs = await rag.retrieveHybrid(query, { topK });

    writer({
      step: `Busca: "${query}"`,
      status: "done",
      message: `${docs.length} trechos encontrados`,
    });

    if (!docs.length) return "(nenhum trecho encontrado para esta busca)";

    return docs
      .map((doc) => {
        const title = doc.metadata?.lesson_title ?? "Aula desconhecida";
        const mod = doc.metadata?.lesson_module ?? "-";
        const content = doc.metadata?.enrichedContent ?? doc.pageContent;
        return `[Aula: ${title} | Módulo: ${mod}]\n${content}`;
      })
      .join("\n\n---\n\n");
  }

  async function executeSearchLessons({ query, limit = 3 }) {
    writer({
      step: `Busca: "${query}"`,
      status: "running",
      progress: `Identificando aulas para "${query}"...`,
    });

    const docs = await rag.retrieveLessons(query, limit);

    writer({
      step: `Busca: "${query}"`,
      status: "done",
      message: `${docs.length} aulas identificadas`,
    });

    if (!docs.length) return "(nenhuma aula encontrada para este tema)";

    return docs
      .map((doc) => {
        const title = doc.metadata?.lesson_title ?? "Aula desconhecida";
        const mod = doc.metadata?.lesson_module ?? "-";
        return `[Aula: ${title} | Módulo: ${mod}]\n${doc.pageContent}`;
      })
      .join("\n\n---\n\n");
  }

  return { executeSearchHybrid, executeSearchLessons };
}
