import { OpenAI } from "openai";
import { activeChatProvider, activeEmbeddingProvider, chatFallbackProviders } from "../configs/index.js";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

// ─── NvidiaEmbeddings ─────────────────────────────────────────────────────────
// NVIDIA's embeddings API requires an input_type field not supported by the
// standard OpenAIEmbeddings class, so we extend it.

class NvidiaEmbeddings extends OpenAIEmbeddings {
  async _createClient() {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.clientConfig.apiKey,
        baseURL: this.clientConfig.baseURL,
        timeout: this.timeout,
        maxRetries: 0,
      });
    }
    return this.client;
  }

  async _embedWithInputType(texts, inputType) {
    const client = await this._createClient();
    const results = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const { data } = await client.embeddings.create({
        model: this.model,
        input: this.stripNewLines
          ? batch.map((t) => t.replace(/\n/g, " "))
          : batch,
        input_type: inputType,
      });
      for (const item of data) {
        results.push(item.embedding);
      }
    }
    return results;
  }

  async embedDocuments(texts) {
    return this._embedWithInputType(texts, "passage");
  }

  async embedQuery(text) {
    const client = await this._createClient();
    const { data } = await client.embeddings.create({
      model: this.model,
      input: this.stripNewLines ? text.replace(/\n/g, " ") : text,
      input_type: "query",
    });
    return data[0].embedding;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildChatInstance(provider, model, schema) {
  const instance = new ChatOpenAI({
    model,
    maxRetries: 2,
    timeout: 120000,
    apiKey: provider.apiKey,
    ...(provider.baseURL && {
      configuration: { baseURL: provider.baseURL },
    }),
  });
  return schema ? instance.withStructuredOutput(schema) : instance;
}

// ─── createChatModel ──────────────────────────────────────────────────────────
// Returns the primary chat model with automatic fallbacks.
// Fallback chain:
//   1. chatModelFallback within the same primary provider (if configured)
//   2. All other providers listed in PROVIDERS (in order)

function createChatModel(schema) {
  const primary = buildChatInstance(activeChatProvider, activeChatProvider.chatModel, schema);

  const fallbacks = [];

  // Intra-provider fallback model (e.g. NVIDIA_CHAT_MODEL_FALLBACK)
  if (activeChatProvider.chatModelFallback) {
    fallbacks.push(
      buildChatInstance(activeChatProvider, activeChatProvider.chatModelFallback, schema)
    );
  }

  // Cross-provider fallbacks (remaining providers from PROVIDERS list)
  for (const provider of chatFallbackProviders) {
    fallbacks.push(buildChatInstance(provider, provider.chatModel, schema));
    if (provider.chatModelFallback) {
      fallbacks.push(buildChatInstance(provider, provider.chatModelFallback, schema));
    }
  }

  return fallbacks.length > 0
    ? primary.withFallbacks({ fallbacks })
    : primary;
}

// ─── createChatInstance ───────────────────────────────────────────────────────
// Returns a single chat instance for the active provider (no fallbacks).
// Useful when you want explicit control over which model is used.

function createChatInstance(model, schema) {
  return buildChatInstance(activeChatProvider, model ?? activeChatProvider.chatModel, schema);
}

// ─── createEmbeddingsModel ────────────────────────────────────────────────────

function createEmbeddingsModel() {
  const provider = activeEmbeddingProvider;

  if (provider.name === "nvidia") {
    return new NvidiaEmbeddings({
      model: provider.embeddingModel,
      apiKey: provider.apiKey,
      ...(provider.baseURL && {
        configuration: { baseURL: provider.baseURL },
      }),
    });
  }

  return new OpenAIEmbeddings({
    model: provider.embeddingModel,
    apiKey: provider.apiKey,
    ...(provider.baseURL && {
      configuration: { baseURL: provider.baseURL },
    }),
  });
}

export {
  createEmbeddingsModel,
  createChatModel,
  createChatInstance,
};
