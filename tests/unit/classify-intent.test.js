import { describe, it, expect } from "vitest";
import { IntentEnum, IntentSchema } from "../../server/agent/workflow/classify-intent.js";

// ─── IntentEnum ───────────────────────────────────────────────────────────────

describe("IntentEnum", () => {
  it("has exactly 4 options", () => {
    expect(IntentEnum.options).toHaveLength(4);
  });

  it("contains the expected intent values", () => {
    expect(IntentEnum.options).toContain("pontual");
    expect(IntentEnum.options).toContain("ampla");
    expect(IntentEnum.options).toContain("comparativa");
    expect(IntentEnum.options).toContain("localizadora");
  });
});

// ─── IntentSchema ─────────────────────────────────────────────────────────────

describe("IntentSchema", () => {
  it("accepts valid intent values", () => {
    for (const intent of ["pontual", "ampla", "comparativa", "localizadora"]) {
      const result = IntentSchema.parse({ intent, rationale: "ok" });
      expect(result.intent).toBe(intent);
    }
  });

  it("normalizes intent to lowercase", () => {
    const result = IntentSchema.parse({ intent: "PONTUAL", rationale: "ok" });
    expect(result.intent).toBe("pontual");
  });

  it("trims whitespace from intent", () => {
    const result = IntentSchema.parse({ intent: "  ampla  ", rationale: "ok" });
    expect(result.intent).toBe("ampla");
  });

  it("falls back to 'pontual' for unknown intent values", () => {
    const result = IntentSchema.parse({ intent: "unknown_value", rationale: "ok" });
    expect(result.intent).toBe("pontual");
  });

  it("falls back to 'pontual' for empty string intent", () => {
    const result = IntentSchema.parse({ intent: "", rationale: "ok" });
    expect(result.intent).toBe("pontual");
  });

  it("requires rationale to be a string", () => {
    expect(() => IntentSchema.parse({ intent: "pontual", rationale: 42 })).toThrow();
  });

  it("requires rationale field to be present", () => {
    expect(() => IntentSchema.parse({ intent: "pontual" })).toThrow();
  });

  it("preserves rationale value unchanged", () => {
    const result = IntentSchema.parse({ intent: "ampla", rationale: "Pergunta ampla sobre o curso." });
    expect(result.rationale).toBe("Pergunta ampla sobre o curso.");
  });
});
