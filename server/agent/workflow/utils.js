function joinRules(rules) {
  return rules
    .map((rule) => ` - ${rule.trim()}`.replace(/\.$/gim, ";"))
    .join(" \n");
}

function joinContext(params) {
  return params.map((param) => param.trim()).join("\n");
}

function getMessageText(message) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";

  return message.content
    .filter(
      (part) =>
        typeof part === "object" && part !== null && part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

function buildContextualChunk({ lesson, content }) {
  const topics = Array.isArray(lesson.topics)
    ? lesson.topics
    : typeof lesson.topics === "string"
      ? safeParseJsonArray(lesson.topics)
      : [];

  return [
    `[Módulo: ${lesson.module ?? "-"}]`,
    `[Aula: ${lesson.title}]`,
    `[Tópicos da aula: ${topics.join(", ")}]`,
    `[Resumo da aula: ${lesson.summary}]`,
    ``,
    content,
  ].join("\n");
}

function safeParseJsonArray(str) {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStructuredOutput(text, schema) {
  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : withoutThink;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object found in model output: ${text}`);
  }
  const json = JSON.parse(candidate.slice(start, end + 1));
  return schema.parse(json);
}

export {
  joinRules,
  joinContext,
  getMessageText,
  parseStructuredOutput,
  buildContextualChunk,
  safeParseJsonArray,
};