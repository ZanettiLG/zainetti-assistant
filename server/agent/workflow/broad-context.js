import { getWriter } from "@langchain/langgraph";

/**
 * Nó "broad-context" — para corpus pequeno (<=N aulas), envia todos os
 * resumos de aula como "mapa do curso" + top chunks híbridos.
 * Ativado quando intent === "ampla" e total_lessons <= MAX_LESSONS_FOR_BROAD.
 */

const MAX_LESSONS_FOR_BROAD = 10;

export default ({ rag }) => {
  return async (state) => {
    const writer = getWriter();

    writer({
      step: "broad-context",
      status: "running",
      message: "Carregando visão geral do curso (corpus pequeno)...",
    });

    // Buscar todas as aulas
    const lessons = await rag.getAllLessons();

    // Buscar top chunks via híbrido
    const topChunks = await rag.retrieveHybrid(state.question, { topK: 8 });

    // Calcular cobertura
    const lessonIds = [...new Set(topChunks.map((d) => d.metadata?.lesson_id).filter(Boolean))];

    writer({
      step: "broad-context",
      status: "done",
      message: `${lessons.length} aulas no mapa + ${topChunks.length} chunks recuperados.`,
    });

    return {
      documents: topChunks,
      lessonsOverview: lessons,
      coverage: {
        lesson_ids: lessonIds,
        sufficient: lessonIds.length >= 2,
      },
    };
  };
};

export { MAX_LESSONS_FOR_BROAD };
