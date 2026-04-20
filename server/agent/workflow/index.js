import * as z from "zod";
import ClassifyIntent from "./classify-intent.js";
import RetrieveDocs from "./retrieve-docs.js";
import RewriteQuery from "./rewrite-query.js";
import SynthesizeAnswer from "./synthesize-answer.js";
import BroadContext, { MAX_LESSONS_FOR_BROAD } from "./broad-context.js";
import { createNvidiaModel } from "../models.js";
import {
  StateSchema,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";

const retryPolicy = {
  maxAttempts: 3,
  initialInterval: 1,
  backoffFactor: 2,
};

const WorkflowState = new StateSchema({
  question: z.string(),
  intent: z.string().optional(),
  answer: z.string().optional(),
  documents: z.array(z.any()).default([]),
  queryTopics: z.array(z.string()).default([]),
  lessonsOverview: z.array(z.any()).optional(),
  coverage: z
    .object({
      lesson_ids: z.array(z.number()),
      sufficient: z.boolean(),
    })
    .optional(),
});

export const createWorkflow = ({ rag }) => {
  const model = createNvidiaModel();

  // Cache lesson count to avoid repeated DB calls
  let _lessonCount = null;
  const getLessonCount = async () => {
    if (_lessonCount == null) _lessonCount = await rag.getLessonCount();
    return _lessonCount;
  };

  const [classifyIntent, rewriteQuery, retrieveDocs, synthesizeAnswer, broadContext] = [
    ClassifyIntent({ model, rag }),
    RewriteQuery({ model, rag }),
    RetrieveDocs({ model, rag }),
    SynthesizeAnswer({ model, rag }),
    BroadContext({ model, rag }),
  ];

  /**
   * Roteamento pós-classify:
   * - pontual → retrieve (direto, sem rewrite)
   * - ampla + corpus pequeno → broad-context (mapa completo)
   * - ampla/comparativa/localizadora → rewrite (decomposição)
   */
  const routeAfterClassify = async (state) => {
    if (state.intent === "pontual") return "retrieve";

    if (state.intent === "ampla") {
      const count = await getLessonCount();
      if (count <= MAX_LESSONS_FOR_BROAD) return "broad-context";
    }

    return "rewrite";
  };

  const workflow = new StateGraph(WorkflowState)
    .addNode("classify", classifyIntent, { retryPolicy })
    .addNode("rewrite", rewriteQuery, { retryPolicy })
    .addNode("retrieve", retrieveDocs, { retryPolicy })
    .addNode("broad-context", broadContext, { retryPolicy })
    .addNode("synthesize", synthesizeAnswer, { retryPolicy })
    .addEdge(START, "classify")
    .addConditionalEdges("classify", routeAfterClassify)
    .addEdge("rewrite", "retrieve")
    .addEdge("retrieve", "synthesize")
    .addEdge("broad-context", "synthesize")
    .addEdge("synthesize", END)
    .compile();

  return workflow;
};

export default createWorkflow;
