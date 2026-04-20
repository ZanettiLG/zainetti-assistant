import { OpenAI } from "openai";
import { env } from "../configs/index.js";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

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

function createNvidiaChat(model, schema) {
  if(!schema) {
    return new ChatOpenAI({
      model,
      maxRetries: 2,
      timeout: 120000,
      apiKey: env.NVIDIA_API_KEY,
      ...(env.PROVIDER_URL && {
        configuration: {
          baseURL: env.PROVIDER_URL,
        },
      }),
    });
  }
  return new ChatOpenAI({
    model,
    maxRetries: 2,
    timeout: 120000,
    apiKey: env.NVIDIA_API_KEY,
    ...(env.PROVIDER_URL && {
      configuration: {
        baseURL: env.PROVIDER_URL,
      },
    }),
  }).withStructuredOutput(schema);
}

function createNvidiaModel(schema) {
  const primary = createNvidiaChat(env.CHAT_MODEL, schema);

  if (env.CHAT_MODEL_FALLBACK) {
    const fallback = createNvidiaChat(env.CHAT_MODEL_FALLBACK, schema);
    return primary.withFallbacks({ fallbacks: [fallback] });
  }

  return primary;
}

function createEmbeddingsModel() {
  return new NvidiaEmbeddings({
    model: env.EMBEDDING_MODEL,
    apiKey: process.env.NVIDIA_API_KEY,
    ...(env.PROVIDER_URL && {
      configuration: {
        baseURL: env.PROVIDER_URL,
      },
    }),
  });
}

export {
    createEmbeddingsModel,
    createNvidiaModel,
}