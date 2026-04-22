/**
 * configs.test.js
 *
 * Testa a lógica de parsing de providers em server/configs/index.js.
 * Como o módulo usa `process.env` diretamente via dotenv, manipulamos
 * process.env antes de cada teste e reimportamos o módulo via vi.resetModules().
 * O dotenv é mockado para evitar que o .env do disco sobrescreva as vars do teste.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

// Mock dotenv so it doesn't reload .env from disk on each module re-import
vi.mock("dotenv", () => ({ config: () => {} }));

const originalEnv = { ...process.env };

const PROVIDER_KEYS = [
  "PROVIDERS", "CHAT_PROVIDER", "EMBEDDING_PROVIDER",
  "NVIDIA_API_KEY", "NVIDIA_API_URL", "NVIDIA_CHAT_MODEL", "NVIDIA_CHAT_MODEL_FALLBACK", "NVIDIA_EMBEDDING_MODEL",
  "OPENAI_API_KEY", "OPENAI_API_URL", "OPENAI_CHAT_MODEL", "OPENAI_EMBEDDING_MODEL",
  "OLLAMA_API_KEY", "OLLAMA_API_URL", "OLLAMA_CHAT_MODEL", "OLLAMA_EMBEDDING_MODEL",
];

function cleanProviderEnv() {
  for (const k of PROVIDER_KEYS) delete process.env[k];
}

async function loadConfigs() {
  vi.resetModules();
  const mod = await import("../../server/configs/index.js");
  return mod;
}

afterEach(() => {
  // Restore env to its original state
  for (const k of PROVIDER_KEYS) {
    if (k in originalEnv) {
      process.env[k] = originalEnv[k];
    } else {
      delete process.env[k];
    }
  }
});

// ─── PROVIDERS parsing ────────────────────────────────────────────────────────

describe("PROVIDERS parsing", () => {
  it("defaults to 'nvidia' when PROVIDERS not set", async () => {
    cleanProviderEnv();
    const { providerConfigs } = await loadConfigs();
    // Without PROVIDERS set, only nvidia should be configured
    expect(Object.keys(providerConfigs)).toEqual(["nvidia"]);
  });

  it("parses single provider", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "openai";
    const { providerConfigs } = await loadConfigs();
    expect(Object.keys(providerConfigs)).toEqual(["openai"]);
  });

  it("parses comma-separated provider list preserving order", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "openai,nvidia,ollama";
    const { providerConfigs } = await loadConfigs();
    expect(Object.keys(providerConfigs)).toEqual(["openai", "nvidia", "ollama"]);
  });

  it("trims whitespace around provider names", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = " nvidia , openai ";
    const { providerConfigs } = await loadConfigs();
    expect(Object.keys(providerConfigs)).toContain("nvidia");
    expect(Object.keys(providerConfigs)).toContain("openai");
  });
});

// ─── buildProviderConfig ──────────────────────────────────────────────────────

describe("buildProviderConfig — nvidia defaults", () => {
  it("applies NVIDIA default baseURL when env var not set", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia";
    const { activeChatProvider } = await loadConfigs();
    expect(activeChatProvider.baseURL).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("overrides baseURL from NVIDIA_API_URL", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia";
    process.env.NVIDIA_API_URL = "https://custom.url/v1";
    const { activeChatProvider } = await loadConfigs();
    expect(activeChatProvider.baseURL).toBe("https://custom.url/v1");
  });

  it("reads NVIDIA_API_KEY", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia";
    process.env.NVIDIA_API_KEY = "test-key";
    const { activeChatProvider } = await loadConfigs();
    expect(activeChatProvider.apiKey).toBe("test-key");
  });

  it("reads NVIDIA_CHAT_MODEL", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia";
    process.env.NVIDIA_CHAT_MODEL = "nvidia/custom-model";
    const { activeChatProvider } = await loadConfigs();
    expect(activeChatProvider.chatModel).toBe("nvidia/custom-model");
  });

  it("reads NVIDIA_CHAT_MODEL_FALLBACK", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia";
    process.env.NVIDIA_CHAT_MODEL_FALLBACK = "nvidia/fallback-model";
    const { activeChatProvider } = await loadConfigs();
    expect(activeChatProvider.chatModelFallback).toBe("nvidia/fallback-model");
  });

  it("reads NVIDIA_EMBEDDING_MODEL", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia";
    process.env.NVIDIA_EMBEDDING_MODEL = "nvidia/custom-embed";
    const { activeEmbeddingProvider } = await loadConfigs();
    expect(activeEmbeddingProvider.embeddingModel).toBe("nvidia/custom-embed");
  });
});

describe("buildProviderConfig — openai defaults", () => {
  it("applies null baseURL for openai by default", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "openai";
    process.env.CHAT_PROVIDER = "openai";
    const { activeChatProvider } = await loadConfigs();
    expect(activeChatProvider.baseURL).toBeNull();
  });

  it("applies ollama non-null apiKey default", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "ollama";
    process.env.CHAT_PROVIDER = "ollama";
    const { activeChatProvider } = await loadConfigs();
    // Ollama default apiKey is 'ollama' (SDK requires non-empty)
    expect(activeChatProvider.apiKey).toBe("ollama");
  });
});

// ─── CHAT_PROVIDER / EMBEDDING_PROVIDER selection ────────────────────────────

describe("CHAT_PROVIDER selection", () => {
  it("defaults to first provider in PROVIDERS list", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "openai,nvidia";
    // No CHAT_PROVIDER set — should default to first in list
    const { activeChatProvider } = await loadConfigs();
    expect(activeChatProvider.name).toBe("openai");
  });

  it("respects explicit CHAT_PROVIDER override", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "openai,nvidia";
    process.env.CHAT_PROVIDER = "nvidia";
    const { activeChatProvider } = await loadConfigs();
    expect(activeChatProvider.name).toBe("nvidia");
  });
});

describe("EMBEDDING_PROVIDER selection", () => {
  it("defaults to first provider in PROVIDERS list", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia,openai";
    const { activeEmbeddingProvider } = await loadConfigs();
    expect(activeEmbeddingProvider.name).toBe("nvidia");
  });

  it("respects explicit EMBEDDING_PROVIDER override", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia,openai";
    process.env.EMBEDDING_PROVIDER = "openai";
    const { activeEmbeddingProvider } = await loadConfigs();
    expect(activeEmbeddingProvider.name).toBe("openai");
  });
});

// ─── chatFallbackProviders ────────────────────────────────────────────────────

describe("chatFallbackProviders", () => {
  it("excludes the active chat provider", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia,openai,ollama";
    process.env.CHAT_PROVIDER = "nvidia";
    const { chatFallbackProviders } = await loadConfigs();
    const names = chatFallbackProviders.map((p) => p.name);
    expect(names).not.toContain("nvidia");
    expect(names).toContain("openai");
    expect(names).toContain("ollama");
  });

  it("preserves order of PROVIDERS list in fallbacks", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia,openai,ollama";
    process.env.CHAT_PROVIDER = "nvidia";
    const { chatFallbackProviders } = await loadConfigs();
    expect(chatFallbackProviders.map((p) => p.name)).toEqual(["openai", "ollama"]);
  });

  it("returns empty array when only one provider is configured", async () => {
    cleanProviderEnv();
    process.env.PROVIDERS = "nvidia";
    const { chatFallbackProviders } = await loadConfigs();
    expect(chatFallbackProviders).toHaveLength(0);
  });
});
