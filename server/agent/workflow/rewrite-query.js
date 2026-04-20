import * as z from "zod";
import { getWriter } from "@langchain/langgraph";
import {
  joinRules,
  getMessageText,
  parseStructuredOutput,
} from "./utils.js";

export const RewriteQuerySchema = z.object({
  queryTopics: z
    .array(z.string().describe("Some topic query of the user question"))
    .min(1),
});

const prompt = joinRules([
  "Responda SEMPRE e EXCLUSIVAMENTE em português brasileiro. Nunca use outros idiomas.",
  "Analise e sintetize a pergunta do usuario em perguntas por topicos para busca semântica de cada um sem mudar a intencao de cada pergunta em relacao a pergunta inicial.",
  "Para cada pergunta gere uma consulta curta e objetiva.",
  "Responda somente com JSON no formato: \"\"\"{\"queryTopics\": [\"...\"]}\"\"\".",
]);

export default ({ model }) => {
  return async (state) => {
    const writer = getWriter();

    writer({
      step: "rewrite",
      status: "running",
      message: "Analisando a pergunta...",
    });

    const response = await model.invoke([
      {
        role: "system",
        content: prompt,
      },
      { role: "user", content: state.question },
    ]);

    const { queryTopics } = parseStructuredOutput(
      getMessageText(response),
      RewriteQuerySchema,
    );

    console.log("queryTopics rewrite", queryTopics);

    // Streamar cada topico derivado como linha de progresso
    for (const topic of queryTopics) {
      writer({
        step: "rewrite",
        status: "running",
        progress: `Tópico: ${topic}`,
      });
    }

    writer({
      step: "rewrite",
      status: "done",
      message: `${queryTopics.length} ${queryTopics.length === 1 ? "tópico identificado" : "tópicos identificados"}.`,
      data: { queryTopics },
    });

    return { queryTopics };
  };
};
