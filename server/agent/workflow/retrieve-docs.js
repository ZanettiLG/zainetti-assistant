import { getWriter } from "@langchain/langgraph";

const TOP_LESSONS = 3;
const MIN_DISTINCT_LESSONS_BROAD = 2;
const MAX_CHUNKS_PER_LESSON_BROAD = 3;
const CHUNKS_PER_LESSON_PER_QUERY = 3;
const BROAD_INTENTS = new Set(["ampla", "comparativa"]);

export default ({ rag }) => {
  return async (state) => {
    const writer = getWriter();
    const isBroad = BROAD_INTENTS.has(state.intent);

    const queries =
      state.queryTopics && state.queryTopics.length
        ? state.queryTopics
        : [state.question];

    writer({
      step: "retrieve",
      status: "running",
      message: `Buscando em ${queries.length} ${queries.length === 1 ? "tópico" : "tópicos"} (${isBroad ? "hierárquico" : "híbrido"})...`,
    });

    let allDocs;

    if (isBroad) {
      // ── Retrieval hierárquico: aulas primeiro, chunks depois ─────────────
      writer({
        step: "retrieve",
        status: "running",
        progress: "Identificando aulas relevantes...",
      });

      const lessonDocs = await rag.retrieveLessons(state.question, TOP_LESSONS);
      const lessonIds = lessonDocs.map((d) => d.metadata.lesson_id);
      const lessonTitles = lessonDocs.map((d) => d.metadata.lesson_title);

      writer({
        step: "retrieve",
        status: "running",
        progress: `${lessonIds.length} aula(s): ${lessonTitles.join(", ")}`,
      });

      // Para cada subconsulta, buscar chunks dentro das aulas candidatas
      const groups = await Promise.all(
        queries.map(async (query) => {
          writer({
            step: "retrieve",
            status: "running",
            progress: `Chunks para "${query}"`,
          });
          const docs = await rag.retrieveChunksInLessons(
            query,
            lessonIds,
            CHUNKS_PER_LESSON_PER_QUERY,
          );
          return docs.map((doc) => ({ ...doc, _origin_query: query }));
        }),
      );

      allDocs = dedup(groups.flat());

      // Enforçar diversidade: no máximo N chunks por aula
      const perLesson = new Map();
      const diversified = [];
      for (const doc of allDocs) {
        const key = doc.metadata?.lesson_id ?? "__no_lesson__";
        const count = perLesson.get(key) ?? 0;
        if (count < MAX_CHUNKS_PER_LESSON_BROAD) {
          diversified.push(doc);
          perLesson.set(key, count + 1);
        }
      }
      allDocs = diversified;
    } else {
      // ── Retrieval híbrido direto (vetor + BM25 + RRF) ───────────────────
      const groups = await Promise.all(
        queries.map(async (query) => {
          writer({
            step: "retrieve",
            status: "running",
            progress: `Buscando: "${query}"`,
          });
          const docs = await rag.retrieveHybrid(query, { topK: 8 });
          writer({
            step: "retrieve",
            status: "running",
            progress: `${docs.length} trechos para "${query}"`,
          });
          return docs.map((doc) => ({ ...doc, _origin_query: query }));
        }),
      );

      allDocs = dedup(groups.flat());
    }

    const distinctLessonIds = [
      ...new Set(
        allDocs
          .map((d) => d.metadata?.lesson_id)
          .filter((id) => id !== undefined && id !== null),
      ),
    ];

    const sufficient = isBroad
      ? distinctLessonIds.length >= MIN_DISTINCT_LESSONS_BROAD
      : allDocs.length > 0;

    writer({
      step: "retrieve",
      status: "done",
      message: `${allDocs.length} segmentos de ${distinctLessonIds.length} aula(s).`,
      data: {
        count: allDocs.length,
        lessons: distinctLessonIds.length,
        sufficient,
      },
    });

    return {
      documents: allDocs,
      coverage: {
        lesson_ids: distinctLessonIds,
        sufficient,
      },
    };
  };
};

/** Deduplica docs por chunk_id preservando ordem. */
export function dedup(docs) {
  const seen = new Set();
  const result = [];
  for (const doc of docs) {
    const id = doc.metadata?.chunk_id ?? doc.pageContent;
    if (!seen.has(id)) {
      seen.add(id);
      result.push(doc);
    }
  }
  return result;
}
