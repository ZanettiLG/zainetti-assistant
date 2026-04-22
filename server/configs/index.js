import { config } from "dotenv";

config();

// ─── Provider defaults ────────────────────────────────────────────────────────
// Values used when the corresponding env var is not set.
const PROVIDER_DEFAULTS = {
  nvidia: {
    apiKey: "",
    baseURL: "https://integrate.api.nvidia.com/v1",
    chatModel: "meta/llama-3.3-70b-instruct",
    chatModelFallback: null,
    embeddingModel: "nvidia/nv-embedqa-e5-v5",
  },
  openai: {
    apiKey: "",
    baseURL: null, // uses OpenAI SDK default
    chatModel: "gpt-4o-mini",
    chatModelFallback: null,
    embeddingModel: "text-embedding-3-small",
  },
  ollama: {
    apiKey: "ollama", // Ollama ignores the key but OpenAI SDK requires a non-empty string
    baseURL: "http://localhost:11434/v1",
    chatModel: "llama3.2",
    chatModelFallback: null,
    embeddingModel: "nomic-embed-text",
  },
};

// ─── Build provider config map from env ──────────────────────────────────────
function buildProviderConfig(name) {
  const key = name.toUpperCase();
  const defaults = PROVIDER_DEFAULTS[name] ?? {
    apiKey: "",
    baseURL: null,
    chatModel: "",
    chatModelFallback: null,
    embeddingModel: "",
  };

  return {
    name,
    apiKey: process.env[`${key}_API_KEY`] ?? defaults.apiKey,
    baseURL: process.env[`${key}_API_URL`] ?? defaults.baseURL,
    chatModel: process.env[`${key}_CHAT_MODEL`] ?? defaults.chatModel,
    chatModelFallback: process.env[`${key}_CHAT_MODEL_FALLBACK`] ?? defaults.chatModelFallback,
    embeddingModel: process.env[`${key}_EMBEDDING_MODEL`] ?? defaults.embeddingModel,
  };
}

// Parse PROVIDERS= as ordered list; fallback to legacy behaviour
const providerNames = (process.env.PROVIDERS ?? "nvidia")
  .split(",")
  .map((p) => p.trim().toLowerCase())
  .filter(Boolean);

const providerConfigs = Object.fromEntries(
  providerNames.map((name) => [name, buildProviderConfig(name)])
);

// Active providers (first in list = primary)
const chatProviderName = (process.env.CHAT_PROVIDER ?? providerNames[0]).toLowerCase();
const embeddingProviderName = (process.env.EMBEDDING_PROVIDER ?? providerNames[0]).toLowerCase();

const activeChatProvider = providerConfigs[chatProviderName] ?? buildProviderConfig(chatProviderName);
const activeEmbeddingProvider = providerConfigs[embeddingProviderName] ?? buildProviderConfig(embeddingProviderName);

// Chat fallback providers: rest of PROVIDERS list after the active chat provider
const chatFallbackProviders = providerNames
  .filter((n) => n !== chatProviderName)
  .map((n) => providerConfigs[n]);

// ─── General env ─────────────────────────────────────────────────────────────
const env = {
  PORT: 3000,
  NGROK_API_KEY: "",
  PROVIDERS: providerNames,
  CHAT_PROVIDER: chatProviderName,
  EMBEDDING_PROVIDER: embeddingProviderName,
  ...process.env,
};

export {
  env,
  providerConfigs,
  activeChatProvider,
  activeEmbeddingProvider,
  chatFallbackProviders,
};
