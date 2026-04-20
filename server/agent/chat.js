async function handleChatStream(agent, req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));

  await new Promise((resolve) => {
    req.on("end", async () => {
      try {
        const { message } = JSON.parse(body);

        if (!message) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Message is required" }));
          return resolve();
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        res.write(
          `data: ${JSON.stringify({
            workflow: { steps: ["classify", "rewrite", "retrieve", "synthesize"] },
          })}\n\n`,
        );

        const stream = await agent.workflow.stream(
          { question: message },
          { streamMode: ["custom", "messages"] },
        );

        for await (const [event, data] of stream) {
          if (event === "custom") {
            res.write(`data: ${JSON.stringify({ node: data })}\n\n`);
          } else if (event === "messages") {
            const [token, metadata] = data;
            if (metadata?.langgraph_node !== "synthesize") continue;
            const text = typeof token.content === "string" ? token.content : "";
            if (text) {
              res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
            }
          }
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } catch (error) {
        console.error("Error:", error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
      resolve();
    });
  });
}

export { handleChatStream };
