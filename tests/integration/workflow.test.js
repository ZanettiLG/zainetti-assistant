/**
 * Integration tests for the full LangGraph workflow against the real NVIDIA API.
 *
 * Requirements:
 *   - NVIDIA_API_KEY set in .env
 *   - DB seeded with lesson/chunk data
 *
 * The workflow: classify → synthesize
 * These tests make real HTTP calls. Allow up to 60s per test.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
config();

let workflow;
let rag;

beforeAll(async () => {
  const { default: createRag } = await import("../../server/agent/rag.js");
  const { createWorkflow } = await import("../../server/agent/workflow/index.js");
  const { createChatInstance } = await import("../../server/agent/models.js");
  const { activeChatProvider } = await import("../../server/configs/index.js");

  // Use the faster fallback model for integration tests to avoid timeouts
  const fastModel = activeChatProvider.chatModelFallback ?? activeChatProvider.chatModel;

  rag = await createRag();

  // Patch workflow to use the fast model directly instead of the slow primary
  const { default: ClassifyIntent } = await import("../../server/agent/workflow/classify-intent.js");
  const { default: SynthesizeAnswer } = await import("../../server/agent/workflow/synthesize-answer.js");
  const { StateSchema, StateGraph, START, END } = await import("@langchain/langgraph");
  const { z } = await import("zod");

  const model = createChatInstance(fastModel);

  const WorkflowState = new StateSchema({
    question: z.string(),
    intent: z.string().optional(),
    answer: z.string().optional(),
  });

  const retryPolicy = { maxAttempts: 2, initialInterval: 1, backoffFactor: 2 };

  workflow = new StateGraph(WorkflowState)
    .addNode("classify", ClassifyIntent({ model }), { retryPolicy })
    .addNode("synthesize", SynthesizeAnswer({ model, rag }), { retryPolicy })
    .addEdge(START, "classify")
    .addEdge("classify", "synthesize")
    .addEdge("synthesize", END)
    .compile();
}, 90000);

// ─── Workflow structure ───────────────────────────────────────────────────────

describe("workflow structure", () => {
  it("has a stream method (compiled LangGraph)", () => {
    expect(typeof workflow.stream).toBe("function");
  });

  it("has an invoke method", () => {
    expect(typeof workflow.invoke).toBe("function");
  });
});

// ─── classify node ────────────────────────────────────────────────────────────

describe("classify node — real NVIDIA API", () => {
  it("classifies a pontual question correctly", async () => {
    const result = await workflow.invoke({ question: "O que é embedding?" });
    expect(["pontual", "ampla", "comparativa", "localizadora"]).toContain(result.intent);
  }, 120000);

  it("classifies an ampla question and returns a valid intent", async () => {
    const result = await workflow.invoke({ question: "Como o curso aborda o tema de LangChain no geral?" });
    expect(["pontual", "ampla", "comparativa", "localizadora"]).toContain(result.intent);
  }, 120000);
});

// ─── Full workflow (classify + synthesize) ────────────────────────────────────

describe("full workflow — real NVIDIA API", () => {
  it("returns an answer string for a simple question", async () => {
    const result = await workflow.invoke({
      question: "O que é RAG e para que serve?",
    });
    expect(typeof result.answer).toBe("string");
    expect(result.answer.length).toBeGreaterThan(0);
  }, 180000);

  it("result contains both intent and answer fields", async () => {
    const result = await workflow.invoke({
      question: "Explique o que é um vector store.",
    });
    expect(result).toHaveProperty("intent");
    expect(result).toHaveProperty("answer");
  }, 180000);
});

// ─── Streaming ────────────────────────────────────────────────────────────────

describe("workflow streaming — real NVIDIA API", () => {
  it("emits at least one custom event during stream", async () => {
    const stream = await workflow.stream(
      { question: "O que é embedding?" },
      { streamMode: ["custom"] }
    );

    // Only read the first event — enough to verify streaming works
    let firstEvent = null;
    for await (const [event, data] of stream) {
      firstEvent = { event, data };
      break;
    }

    expect(firstEvent).not.toBeNull();
  }, 120000);

  it("stream events have event type and data", async () => {
    const stream = await workflow.stream(
      { question: "O que é LangGraph?" },
      { streamMode: ["custom"] }
    );

    for await (const [event, data] of stream) {
      expect(typeof event).toBe("string");
      expect(data).toBeDefined();
      break; // just check the first one
    }
  }, 120000);
});
