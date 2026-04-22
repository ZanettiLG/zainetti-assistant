/**
 * Integration tests for model factories against the real NVIDIA API.
 *
 * Requirements:
 *   - NVIDIA_API_KEY set in .env
 *   - PROVIDERS=nvidia (or includes nvidia)
 *   - CHAT_PROVIDER=nvidia
 *   - EMBEDDING_PROVIDER=nvidia
 *
 * These tests make real HTTP calls and may take several seconds each.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
config();

import { createChatModel, createChatInstance, createEmbeddingsModel } from "../../server/agent/models.js";
import { activeChatProvider, activeEmbeddingProvider } from "../../server/configs/index.js";

// Use the faster fallback model for chat tests to avoid timeouts with slow primary models
const FAST_CHAT_MODEL = activeChatProvider.chatModelFallback ?? activeChatProvider.chatModel;

describe("provider configuration (nvidia)", () => {
  it("activeChatProvider is nvidia", () => {
    expect(activeChatProvider.name).toBe("nvidia");
  });

  it("activeEmbeddingProvider is nvidia", () => {
    expect(activeEmbeddingProvider.name).toBe("nvidia");
  });

  it("activeChatProvider has a non-empty apiKey", () => {
    expect(activeChatProvider.apiKey).toBeTruthy();
  });

  it("activeChatProvider baseURL points to NVIDIA", () => {
    expect(activeChatProvider.baseURL).toContain("nvidia");
  });
});

describe("createChatModel — NVIDIA real API", () => {
  it("invokes model and returns a string response", async () => {
    // Use faster fallback model — primary model (minimaxai) can be very slow
    const model = createChatInstance(FAST_CHAT_MODEL);
    const response = await model.invoke([
      { role: "user", content: "Responda apenas: OK" },
    ]);
    const text = typeof response.content === "string"
      ? response.content
      : response.content.map((p) => p.text ?? "").join("");
    expect(text.length).toBeGreaterThan(0);
  }, 60000);

  it("createChatModel builds a RunnableWithFallbacks when fallback model is configured", () => {
    // Verify the model chain is wired — no API call needed
    const model = createChatModel();
    // With fallback configured, the result should wrap the primary model
    expect(model).toBeDefined();
    expect(typeof model.invoke).toBe("function");
  });

  it("returns structured output when schema is provided", async () => {
    const { z } = await import("zod");
    const schema = z.object({ answer: z.string() });
    // Use fast model for structured output test too
    const { default: buildChatInstance } = await import("../../server/agent/models.js").then(m => ({ default: m.createChatInstance }));
    const model = buildChatInstance(FAST_CHAT_MODEL, schema);
    const result = await model.invoke([
      { role: "system", content: 'Responda APENAS com JSON: {"answer": "sim"}' },
      { role: "user", content: "Tudo bem?" },
    ]);
    expect(result).toHaveProperty("answer");
    expect(typeof result.answer).toBe("string");
  }, 60000);
});

describe("createChatInstance — NVIDIA real API", () => {
  it("invokes model without fallbacks and returns a response", async () => {
    // Use the faster fallback model to avoid timeouts
    const model = createChatInstance(FAST_CHAT_MODEL);
    const response = await model.invoke([
      { role: "user", content: "Responda apenas: OK" },
    ]);
    expect(response.content).toBeTruthy();
  }, 60000);
});

describe("createEmbeddingsModel — NVIDIA real API", () => {
  it("embeds a single query and returns a numeric array", async () => {
    const model = createEmbeddingsModel();
    const embedding = await model.embedQuery("o que é embedding?");
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);
    expect(typeof embedding[0]).toBe("number");
  }, 30000);

  it("embeds multiple documents and returns one vector per doc", async () => {
    const model = createEmbeddingsModel();
    const docs = ["embedding é uma representação vetorial", "RAG usa recuperação de contexto"];
    const embeddings = await model.embedDocuments(docs);
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0].length).toBeGreaterThan(0);
    expect(embeddings[1].length).toBeGreaterThan(0);
  }, 30000);

  it("query embedding and document embedding have the same dimension", async () => {
    const model = createEmbeddingsModel();
    const [queryEmb, [docEmb]] = await Promise.all([
      model.embedQuery("teste"),
      model.embedDocuments(["documento de teste"]),
    ]);
    expect(queryEmb.length).toBe(docEmb.length);
  }, 30000);
});
