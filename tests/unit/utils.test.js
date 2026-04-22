import { describe, it, expect } from "vitest";
import {
  joinRules,
  joinContext,
  getMessageText,
  parseStructuredOutput,
  buildContextualChunk,
  safeParseJsonArray,
} from "../../server/agent/workflow/utils.js";
import * as z from "zod";

// ─── joinRules ────────────────────────────────────────────────────────────────

describe("joinRules", () => {
  it("prefixes each rule with ' - '", () => {
    const result = joinRules(["foo", "bar"]);
    expect(result).toContain(" - foo");
    expect(result).toContain(" - bar");
  });

  it("replaces trailing period with semicolon", () => {
    const result = joinRules(["rule one."]);
    expect(result).toContain(" - rule one;");
    expect(result).not.toContain("rule one.");
  });

  it("does not modify rules without trailing period", () => {
    const result = joinRules(["no period here"]);
    expect(result).toContain(" - no period here");
  });

  it("joins rules with ' \\n'", () => {
    const result = joinRules(["a", "b"]);
    expect(result).toBe(" - a \n - b");
  });

  it("handles empty array", () => {
    expect(joinRules([])).toBe("");
  });
});

// ─── joinContext ──────────────────────────────────────────────────────────────

describe("joinContext", () => {
  it("joins params with newline", () => {
    expect(joinContext(["hello", "world"])).toBe("hello\nworld");
  });

  it("trims whitespace from each param", () => {
    expect(joinContext(["  hello  ", "  world  "])).toBe("hello\nworld");
  });

  it("handles single item", () => {
    expect(joinContext(["only"])).toBe("only");
  });

  it("handles empty array", () => {
    expect(joinContext([])).toBe("");
  });
});

// ─── getMessageText ───────────────────────────────────────────────────────────

describe("getMessageText", () => {
  it("returns string content directly", () => {
    expect(getMessageText({ content: "hello" })).toBe("hello");
  });

  it("returns empty string for non-string, non-array content", () => {
    expect(getMessageText({ content: 42 })).toBe("");
    expect(getMessageText({ content: null })).toBe("");
    expect(getMessageText({ content: undefined })).toBe("");
  });

  it("joins text parts from array content", () => {
    const msg = {
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: " world" },
      ],
    };
    expect(getMessageText(msg)).toBe("hello world");
  });

  it("ignores non-text parts in array content", () => {
    const msg = {
      content: [
        { type: "text", text: "visible" },
        { type: "image_url", url: "http://x.com/img.png" },
      ],
    };
    expect(getMessageText(msg)).toBe("visible");
  });

  it("ignores null entries in array content", () => {
    const msg = {
      content: [null, { type: "text", text: "ok" }],
    };
    expect(getMessageText(msg)).toBe("ok");
  });

  it("returns empty string for empty array content", () => {
    expect(getMessageText({ content: [] })).toBe("");
  });
});

// ─── parseStructuredOutput ────────────────────────────────────────────────────

const SimpleSchema = z.object({ value: z.string() });

describe("parseStructuredOutput", () => {
  it("parses plain JSON string", () => {
    const result = parseStructuredOutput('{"value": "hello"}', SimpleSchema);
    expect(result).toEqual({ value: "hello" });
  });

  it("parses JSON inside fenced code block", () => {
    const text = '```json\n{"value": "fenced"}\n```';
    expect(parseStructuredOutput(text, SimpleSchema)).toEqual({ value: "fenced" });
  });

  it("parses JSON inside unnamed fenced code block", () => {
    const text = '```\n{"value": "unnamed"}\n```';
    expect(parseStructuredOutput(text, SimpleSchema)).toEqual({ value: "unnamed" });
  });

  it("strips <think> tags before parsing", () => {
    const text = '<think>some reasoning here</think>\n{"value": "after think"}';
    expect(parseStructuredOutput(text, SimpleSchema)).toEqual({ value: "after think" });
  });

  it("strips multi-line <think> tags", () => {
    const text = '<think>\nlong\nreasoning\n</think>{"value": "clean"}';
    expect(parseStructuredOutput(text, SimpleSchema)).toEqual({ value: "clean" });
  });

  it("throws when no JSON object found", () => {
    expect(() => parseStructuredOutput("no json here", SimpleSchema)).toThrow(
      /No JSON object found/
    );
  });

  it("throws on invalid JSON", () => {
    expect(() => parseStructuredOutput("{bad json}", SimpleSchema)).toThrow();
  });

  it("throws when JSON does not match schema", () => {
    expect(() =>
      parseStructuredOutput('{"wrong_field": 123}', SimpleSchema)
    ).toThrow();
  });

  it("parses JSON with surrounding text", () => {
    const text = 'Here is the result: {"value": "found"} — done.';
    expect(parseStructuredOutput(text, SimpleSchema)).toEqual({ value: "found" });
  });
});

// ─── buildContextualChunk ─────────────────────────────────────────────────────

describe("buildContextualChunk", () => {
  it("includes module, title, topics, summary and content", () => {
    const result = buildContextualChunk({
      lesson: {
        module: "M1",
        title: "Intro",
        topics: ["a", "b"],
        summary: "Overview",
      },
      content: "The actual content.",
    });
    expect(result).toContain("[Módulo: M1]");
    expect(result).toContain("[Aula: Intro]");
    expect(result).toContain("[Tópicos da aula: a, b]");
    expect(result).toContain("[Resumo da aula: Overview]");
    expect(result).toContain("The actual content.");
  });

  it("parses topics from JSON string", () => {
    const result = buildContextualChunk({
      lesson: {
        module: "M1",
        title: "T",
        topics: '["x","y"]',
        summary: "S",
      },
      content: "C",
    });
    expect(result).toContain("[Tópicos da aula: x, y]");
  });

  it("handles missing topics gracefully (empty list)", () => {
    const result = buildContextualChunk({
      lesson: { module: "M1", title: "T", summary: "S" },
      content: "C",
    });
    expect(result).toContain("[Tópicos da aula: ]");
  });

  it("handles null module with dash fallback", () => {
    const result = buildContextualChunk({
      lesson: { module: null, title: "T", topics: [], summary: "S" },
      content: "C",
    });
    expect(result).toContain("[Módulo: -]");
  });

  it("separates header from content with blank line", () => {
    const result = buildContextualChunk({
      lesson: { module: "M", title: "T", topics: [], summary: "S" },
      content: "body",
    });
    expect(result).toContain("\n\nbody");
  });
});

// ─── safeParseJsonArray ───────────────────────────────────────────────────────

describe("safeParseJsonArray", () => {
  it("parses valid JSON array", () => {
    expect(safeParseJsonArray('["a","b"]')).toEqual(["a", "b"]);
  });

  it("returns [] for non-array JSON", () => {
    expect(safeParseJsonArray('{"key":"val"}')).toEqual([]);
    expect(safeParseJsonArray('"string"')).toEqual([]);
    expect(safeParseJsonArray("42")).toEqual([]);
  });

  it("returns [] for invalid JSON", () => {
    expect(safeParseJsonArray("not json")).toEqual([]);
    expect(safeParseJsonArray("")).toEqual([]);
  });

  it("returns [] for null / undefined", () => {
    expect(safeParseJsonArray(null)).toEqual([]);
    expect(safeParseJsonArray(undefined)).toEqual([]);
  });
});
