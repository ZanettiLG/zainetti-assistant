import { join } from "path";
import ngrok from "@ngrok/ngrok";
import { env } from "./configs/index.js";
import { createServer } from "http";
import { serveStaticFile } from "./static.js";
import { createAgents } from "./agent/index.js";

const app = async () => {
  const agent = await createAgents();
  
  const server = createServer(async (req, res) => {
    const url = req.url;

    if (url === "/chat" && req.method === "POST") {
      return agent.handleChat(req, res);
    }

    const filePath = url === "/" ? "/index.html" : url;
    const fullPath = join(process.cwd(), "web", filePath);

    serveStaticFile(res, fullPath);
  });

  server.listen(env.PORT, async () => {
    console.log(`Server running at http://localhost:${env.PORT}`);
    if (env.NGROK_API_KEY) {
      try {
        const listener = await ngrok.forward({
          addr: env.PORT,
          authtoken: env.NGROK_API_KEY,
        });
        console.log(`Ngrok tunnel: ${listener.url()}`);
      } catch (error) {
        console.error("Failed to start ngrok tunnel:", error.message);
      }
    }
  });
}

app();