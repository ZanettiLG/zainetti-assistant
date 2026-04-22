import { getWriter } from "@langchain/langgraph";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { joinContext, getMessageText, joinRules } from "./utils.js";
import {
  searchHybridTool,
  searchLessonsTool,
  createToolExecutors,
} from "./search-tools.js";

const rules = [
  "Responda SEMPRE e EXCLUSIVAMENTE em português brasileiro. Nunca use outros idiomas",
  "Responda APENAS com base nos trechos recuperados pelo uso das suas ferramentas de busca. Não extrapole e não invente conteúdo",
  "Cite explicitamente as aulas que sustentam cada afirmação no formato [Aula: <título>]",
  "Se a pergunta for ampla ou comparativa: baseie-se em pelo menos 2 aulas distintas",
  "Use as ferramentas de busca disponíveis para encontrar o conteúdo relevante antes de responder",
  "Para perguntas pontuais: use search_hybrid diretamente com a pergunta do aluno",
  "Para perguntas amplas ou comparativas: use search_lessons primeiro para identificar as aulas relevantes, depois use search_hybrid para buscar trechos específicos",
  "Se a cobertura for insuficiente, diga explicitamente que a resposta é parcial e cite em quais aulas você se apoiou",
  "Não apresente um tema como 'visão do curso' se ele aparece em uma única aula",
  "Antes de responder, organize internamente (sem mostrar ao aluno) 1) aulas usadas, 2) pontos em comum, 3) pontos exclusivos de cada aula, 4) lacunas",
  "A resposta final ao aluno deve ser fluida, gentil e com as citações no formato pedido",
  "Conclua sempre sua resposta de forma completa; não corte frases no meio",
  "Se não houver informação suficiente nos trechos recuperados, diga honestamente que não sabe com base no material recuperado",
];

const systemPrefix = `
Você é o assistente do Professor Zanetti. Seu nome é Assistente Zainetti.
Seu público são os aspirantes (alunos). Seja gentil, educado e prestativo.
Você possui ferramentas de busca para encontrar conteúdo nos materiais de aula. USE-AS antes de responder.
**REGRAS**:
`;

function formatToolResult(name, result) {
  return `Resultado da ferramenta ${name}:\n${result}`;
}

export default ({ model, rag }) => {
  const boundModel = model.bindTools([searchHybridTool, searchLessonsTool]);

  return async (state) => {
    const writer = getWriter();
    const { executeSearchHybrid, executeSearchLessons } = createToolExecutors(
      rag,
      writer,
    );

    writer({
      step: "synthesize",
      status: "running",
      message: "Iniciando busca e síntese da resposta...",
    });

    const systemContent = joinContext([systemPrefix, joinRules(rules)]);

    const intentHint =
      state.intent === "pontual"
        ? "intenção: pontual — use search_hybrid diretamente"
        : state.intent === "ampla" || state.intent === "comparativa"
          ? `intenção: ${state.intent} — use search_lessons primeiro para identificar aulas, depois search_hybrid dentro delas`
          : state.intent === "localizadora"
            ? "intenção: localizadora — use search_hybrid para localizar trechos específicos"
            : "intenção: não classificada";

    const messages = [
      { role: "system", content: systemContent },
      {
        role: "user",
        content: [
          intentHint,
          `pergunta: """${state.question}"""`,
        ].join("\n\n"),
      },
    ];

    let response = await boundModel.invoke(messages);

    while (response.tool_calls && response.tool_calls.length > 0) {
      messages.push(new AIMessage({
        content: response.content,
        tool_calls: response.tool_calls,
      }));

      for (const toolCall of response.tool_calls) {
        let result;
        if (toolCall.name === "search_hybrid") {
          result = await executeSearchHybrid(toolCall.args);
        } else if (toolCall.name === "search_lessons") {
          result = await executeSearchLessons(toolCall.args);
        } else {
          result = `Ferramenta desconhecida: ${toolCall.name}`;
        }

        messages.push(
          new ToolMessage({
            content: formatToolResult(toolCall.name, result),
            tool_call_id: toolCall.id,
          }),
        );
      }

      response = await boundModel.invoke(messages);
    }

    writer({
      step: "synthesize",
      status: "running",
      message: "Gerando resposta final...",
    });

    const answerText = getMessageText(response);
    const paragraphs = answerText
      .split(/\n\n|\n#/)
      .map((p) => p.trim())
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      writer({
        step: "final-answer",
        status: "running",
        content: paragraph,
      });
    }

    writer({
      step: "synthesize",
      status: "done",
      message: "Resposta finalizada.",
    });

    return { answer: answerText };
  };
};
