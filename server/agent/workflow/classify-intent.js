import * as z from "zod";
import { getWriter } from "@langchain/langgraph";
import {
  joinRules,
  getMessageText,
  parseStructuredOutput,
} from "./utils.js";

export const IntentEnum = z.enum([
  "pontual",
  "ampla",
  "comparativa",
  "localizadora",
]);

const VALID_INTENTS = new Set(IntentEnum.options);
const DEFAULT_INTENT = "pontual";

/**
 * Schema com fallback: se o modelo retornar um valor fora do enum,
 * transforma para o default em vez de lançar ZodError.
 */
export const IntentSchema = z.object({
  intent: z.string().transform((val) => {
    const normalized = val.trim().toLowerCase();
    return VALID_INTENTS.has(normalized) ? normalized : DEFAULT_INTENT;
  }),
  rationale: z.string(),
});

const prompt = joinRules([
  "Responda SEMPRE em português brasileiro",
  "Classifique a intenção da pergunta do aluno em EXATAMENTE uma destas 4 categorias (use a palavra exata, sem variações):",
  "pontual — busca uma definição, fato específico ou explicação direta de um único conceito (ex.: 'o que é embedding?')",
  "ampla — pede síntese global sobre um tema do curso, exige olhar várias aulas (ex.: 'como o curso aborda autenticação?')",
  "comparativa — pede comparar abordagens, conceitos ou tópicos (ex.: 'qual a diferença entre A e B nas aulas?')",
  "localizadora — pergunta em qual aula/seção um assunto é tratado (ex.: 'em que aula se fala de OAuth2?')",
  "IMPORTANTE: o campo intent DEVE ser uma dessas 4 palavras exatas: pontual, ampla, comparativa, localizadora. Não use nenhum outro valor",
  "Se a pergunta não se encaixar bem em nenhuma, use 'pontual' como padrão",
  'Responda APENAS com JSON no formato: {"intent": "pontual|ampla|comparativa|localizadora", "rationale": "..."}',
  "rationale deve ser uma frase curta em português justificando a escolha",
]);

export default ({ model }) => {
  return async (state) => {
    const writer = getWriter();

    writer({
      step: "classify",
      status: "running",
      message: "Classificando intenção da pergunta...",
    });

    const response = await model.invoke([
      { role: "system", content: prompt },
      { role: "user", content: state.question },
    ]);

    const { intent, rationale } = parseStructuredOutput(
      getMessageText(response),
      IntentSchema,
    );

    writer({
      step: "classify",
      status: "done",
      message: `Intenção: ${intent}`,
      data: { intent, rationale },
    });

    return { intent };
  };
};
