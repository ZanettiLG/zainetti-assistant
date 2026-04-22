async function handleChatStream(agent, req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));

  await new Promise((resolve) => {
    req.on("end", async () => {
      try {
        const { message } = JSON.parse(body);
        const normalizedMessage =
          typeof message === "string" ? message.trim() : "";

        if (!normalizedMessage) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Message is required" }));
          return resolve();
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        let seq = 0;
        const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const now = () => new Date().toISOString();

        const send = (type, payload) => {
          seq += 1;
          res.write(
            `data: ${JSON.stringify({
              seq,
              timestamp: now(),
              turnId,
              type,
              ...payload,
            })}\n\n`,
          );
        };

        send("workflow", {
          steps: ["classify", "synthesize"],
        });

        const stream = await agent.workflow.stream(
          { question: normalizedMessage },
          { streamMode: ["custom"] },
        );

        for await (const [event, data] of stream) {
          if (event === "custom") {
            send("node", { node: data });
          }
        }

        send("node", {
          node: {
            step: "final-answer",
            status: "done",
            message: "Resposta finalizada.",
          },
        });

        send("turn_done", {});
        res.end();
      } catch (error) {
        console.error("Error:", error);
        const sendErr = (type, payload) => {
          res.write(
            `data: ${JSON.stringify({
              seq: 0,
              timestamp: new Date().toISOString(),
              turnId: `turn-${Date.now()}`,
              type,
              ...payload,
            })}\n\n`,
          );
        };
        sendErr("error", { error: error.message });
        res.end();
      }
      resolve();
    });
  });
}

export { handleChatStream };
