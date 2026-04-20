import { config } from "dotenv";

config();

const env = {
  PORT: 3000,
  NGROK_API_KEY: "",
  NVIDIA_API_KEY: "",
  CHAT_MODEL: "minimaxai/minimax-m2.7",
  CHAT_MODEL_FALLBACK: "meta/llama-3.3-70b-instruct",
  EMBEDDING_MODEL: "nvidia/nv-embedqa-e5-v5",
  PROVIDER_URL: "https://integrate.api.nvidia.com/v1",
  ...process.env,
};

export { env };