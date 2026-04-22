import * as z from "zod";
import ClassifyIntent from "./classify-intent.js";
import SynthesizeAnswer from "./synthesize-answer.js";
import { createChatModel, createChatInstance } from "../models.js";
import { activeChatProvider } from "../../configs/index.js";
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
});

export const createWorkflow = ({ rag }) => {
  const classifyModel = createChatModel();
  const synthesizeModel = createChatInstance(activeChatProvider.chatModel);

  const classifyIntent = ClassifyIntent({ model: classifyModel });
  const synthesizeAnswer = SynthesizeAnswer({ model: synthesizeModel, rag });

  const workflow = new StateGraph(WorkflowState)
    .addNode("classify", classifyIntent, { retryPolicy })
    .addNode("synthesize", synthesizeAnswer, { retryPolicy })
    .addEdge(START, "classify")
    .addEdge("classify", "synthesize")
    .addEdge("synthesize", END)
    .compile();

  return workflow;
};

export default createWorkflow;
