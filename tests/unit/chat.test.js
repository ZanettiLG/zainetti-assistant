import { describe, it, expect, vi } from "vitest";
import { handleChatStream } from "../../server/agent/chat.js";
import { EventEmitter } from "events";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body) {
  const emitter = new EventEmitter();
  emitter.method = "POST";
  process.nextTick(() => {
    emitter.emit("data", JSON.stringify(body));
    emitter.emit("end");
  });
  return emitter;
}

function makeRes() {
  const events = [];
  return {
    _events: events,
    _statusCode: null,
    writeHead(code) { this._statusCode = code; },
    write(chunk) { events.push(chunk); },
    end() { this._ended = true; },
    _ended: false,
    _parse() {
      return events.map((e) => JSON.parse(e.replace(/^data: /, "")));
    },
  };
}

function makeWorkflow(customEvents = []) {
  return {
    stream: vi.fn().mockResolvedValue(
      (async function* () {
        for (const ev of customEvents) yield ev;
      })()
    ),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleChatStream — validation", () => {
  it("returns 400 when message is missing", async () => {
    const req = makeReq({});
    const res = makeRes();
    await handleChatStream({ workflow: makeWorkflow() }, req, res);
    expect(res._statusCode).toBe(400);
  });

  it("returns 400 when message is empty string", async () => {
    const req = makeReq({ message: "   " });
    const res = makeRes();
    await handleChatStream({ workflow: makeWorkflow() }, req, res);
    expect(res._statusCode).toBe(400);
  });

  it("returns 400 when message is non-string", async () => {
    const req = makeReq({ message: 42 });
    const res = makeRes();
    await handleChatStream({ workflow: makeWorkflow() }, req, res);
    expect(res._statusCode).toBe(400);
  });
});

describe("handleChatStream — SSE headers", () => {
  it("sets text/event-stream content type on success", async () => {
    const req = makeReq({ message: "hello" });
    const res = makeRes();
    let headers = null;
    res.writeHead = (code, h) => { res._statusCode = code; headers = h; };
    await handleChatStream({ workflow: makeWorkflow() }, req, res);
    expect(headers["Content-Type"]).toMatch(/text\/event-stream/);
    expect(headers["Cache-Control"]).toBe("no-cache");
    expect(headers["Connection"]).toBe("keep-alive");
  });
});

describe("handleChatStream — SSE event structure", () => {
  it("first event is 'workflow' type with steps", async () => {
    const req = makeReq({ message: "hello" });
    const res = makeRes();
    await handleChatStream({ workflow: makeWorkflow() }, req, res);
    const parsed = res._parse();
    expect(parsed[0].type).toBe("workflow");
    expect(parsed[0].steps).toEqual(["classify", "synthesize"]);
  });

  it("each event has seq, timestamp, turnId and type", async () => {
    const req = makeReq({ message: "test" });
    const res = makeRes();
    await handleChatStream({ workflow: makeWorkflow() }, req, res);
    for (const ev of res._parse()) {
      expect(ev).toHaveProperty("seq");
      expect(ev).toHaveProperty("timestamp");
      expect(ev).toHaveProperty("turnId");
      expect(ev).toHaveProperty("type");
    }
  });

  it("seq increments by 1 for each event", async () => {
    const req = makeReq({ message: "hi" });
    const res = makeRes();
    await handleChatStream({ workflow: makeWorkflow() }, req, res);
    const seqs = res._parse().map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });

  it("emits 'node' event for each custom workflow event", async () => {
    const customEvents = [
      ["custom", { step: "classify", status: "done" }],
      ["custom", { step: "synthesize", status: "done" }],
    ];
    const req = makeReq({ message: "hi" });
    const res = makeRes();
    await handleChatStream({ workflow: makeWorkflow(customEvents) }, req, res);
    // Only count intermediate node events, not the final-answer node
    const nodeEvents = res._parse().filter(
      (e) => e.type === "node" && e.node?.step !== "final-answer"
    );
    expect(nodeEvents).toHaveLength(2);
  });

  it("last events are 'final-answer' done and 'turn_done'", async () => {
    const req = makeReq({ message: "hi" });
    const res = makeRes();
    await handleChatStream({ workflow: makeWorkflow() }, req, res);
    const parsed = res._parse();
    const last = parsed[parsed.length - 1];
    const secondLast = parsed[parsed.length - 2];
    expect(last.type).toBe("turn_done");
    expect(secondLast.type).toBe("node");
    expect(secondLast.node.step).toBe("final-answer");
    expect(secondLast.node.status).toBe("done");
  });

  it("closes response after turn_done", async () => {
    const req = makeReq({ message: "hi" });
    const res = makeRes();
    await handleChatStream({ workflow: makeWorkflow() }, req, res);
    expect(res._ended).toBe(true);
  });
});

describe("handleChatStream — error handling", () => {
  it("emits 'error' event when workflow throws", async () => {
    const brokenWorkflow = {
      stream: vi.fn().mockRejectedValue(new Error("model failed")),
    };
    const req = makeReq({ message: "hi" });
    const res = makeRes();
    await handleChatStream({ workflow: brokenWorkflow }, req, res);
    const parsed = res._parse();
    const errorEvent = parsed.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toBe("model failed");
  });

  it("closes response even on workflow error", async () => {
    const brokenWorkflow = {
      stream: vi.fn().mockRejectedValue(new Error("oops")),
    };
    const req = makeReq({ message: "hi" });
    const res = makeRes();
    await handleChatStream({ workflow: brokenWorkflow }, req, res);
    expect(res._ended).toBe(true);
  });
});
