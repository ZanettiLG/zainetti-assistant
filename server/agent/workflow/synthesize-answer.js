import { getWriter } from "@langchain/langgraph";
import { joinContext, getMessageText, joinRules } from "./utils.js";

const rules = [
  "Responda SEMPRE e EXCLUSIVAMENTE em português brasileiro. Nunca use outros idiomas",
  "Responda APENAS com base nos trechos recuperados do material de aula. Não extrapole e não invente conteúdo",
  "Cite explicitamente as aulas que sustentam cada afirmação no formato [Aula: <título>]",
  "Se a pergunta for ampla ou comparativa: baseie-se em pelo menos 2 aulas distintas",
  "Se a cobertura for insuficiente, diga explicitamente que a resposta é parcial e cite em quais aulas você se apoiou",
  "Não apresente um tema como 'visão do curso' se ele aparece em uma única aula",
  "Antes de responder, organize internamente (sem mostrar ao aluno) 1) aulas usadas, 2) pontos em comum, 3) pontos exclusivos de cada aula, 4) lacunas",
  "A resposta final ao aluno deve ser fluida, gentil e com as citações no formato pedido",
  "Se um mapa_do_curso for fornecido, use-o como visão geral para contextualizar e referencie tanto o mapa quanto os trechos específicos",
  "Conclua sempre sua resposta de forma completa; não corte frases no meio",
  "Se não houver informação suficiente nos trechos, diga honestamente que não sabe com base no material recuperado",
];

const systemPrefix = `
Você é o assistente do Professor Zanetti. Seu nome é Assistente Zainetti.
Seu público são os aspirantes (alunos). Seja gentil, educado e prestativo.
**REGRAS**:
`;

/**
 * Agrupa documentos por subconsulta para o LLM ver a estrutura da busca.
 * Se não houver subconsultas (pontual), gera lista plana.
 */
function buildSegmentsBlock(documents) {
  if (!documents.length) return "(nenhum trecho recuperado)";

  // Agrupar por _origin_query
  const byQuery = new Map();
  let counter = 0;
  for (const doc of documents) {
    const key = doc._origin_query ?? "__direct__";
    if (!byQuery.has(key)) byQuery.set(key, []);
    byQuery.get(key).push({ ...doc, _globalIdx: ++counter });
  }

  // Se há apenas um grupo "__direct__", mostrar lista plana
  if (byQuery.size === 1 && byQuery.has("__direct__")) {
    return formatDocList(documents, 1);
  }

  // Caso contrário, agrupar por subconsulta
  const blocks = [];
  for (const [query, docs] of byQuery) {
    const header =
      query === "__direct__"
        ? "== Busca direta =="
        : `== Subconsulta: "${query}" ==`;
    blocks.push(`${header}\n${formatDocList(docs, docs[0]._globalIdx)}`);
  }
  return blocks.join("\n\n");
}

function formatDocList(docs, startIdx = 1) {
  return docs
    .map((doc, i) => {
      const idx = doc._globalIdx ?? startIdx + i;
      const title = doc.metadata?.lesson_title ?? "Aula desconhecida";
      const mod = doc.metadata?.lesson_module ?? "-";
      const content = doc.metadata?.enrichedContent ?? doc.pageContent;
      return `#${idx} [Aula: ${title} | Módulo: ${mod}]\n${content}`;
    })
    .join("\n\n---\n\n");
}

export default ({ model }) => {
  return async (state) => {
    const writer = getWriter();

    writer({
      step: "synthesize",
      status: "running",
      message: `Lendo ${state.documents.length} segmentos e formulando resposta...`,
    });

    const coverage = state.coverage ?? { lesson_ids: [], sufficient: false };
    const coverageLabel = coverage.sufficient ? "suficiente" : "insuficiente";
    const lessonsCount = coverage.lesson_ids?.length ?? 0;

    const systemContent = joinContext([systemPrefix, joinRules(rules)]);

    // Se broad-context forneceu lessonsOverview, incluir mapa do curso
    let overviewBlock = "";
    if (state.lessonsOverview && state.lessonsOverview.length > 0) {
      const lines = state.lessonsOverview.map((l) => {
        const topics = Array.isArray(l.topics) ? l.topics.join(", ") : l.topics;
        return `- [${l.title}] (Módulo: ${l.module ?? "-"}) — ${l.summary}\n  Tópicos: ${topics}`;
      });
      overviewBlock = `mapa_do_curso (${state.lessonsOverview.length} aulas):\n${lines.join("\n\n")}`;
    }

    const userContent = [
      `intenção_da_pergunta: ${state.intent ?? "não_classificada"}`,
      `cobertura: ${coverageLabel} (aulas distintas recuperadas: ${lessonsCount})`,
      ...(overviewBlock ? [overviewBlock] : []),
      `pergunta: """${state.question}"""`,
      `trechos_recuperados:\n${buildSegmentsBlock(state.documents)}`,
    ].join("\n\n");

    const response = await model.invoke([
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ]);

    const answer = getMessageText(response);

    writer({
      step: "synthesize",
      status: "done",
      message: `Resposta gerada (${answer.length} caracteres).`,
    });

    return { answer };
  };
};
