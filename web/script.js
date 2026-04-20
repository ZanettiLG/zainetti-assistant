/* global marked */

const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const output = document.getElementById("output");
const stepsEl = document.getElementById("steps");
const thinking = document.getElementById("thinking");
const thinkingBody = document.getElementById("thinking-body");

const STEP_LABELS = {
  rewrite: "Reescrita da consulta",
  retrieve: "Busca de documentos",
  synthesize: "Sintese da resposta",
};

// Streaming-safe splitter: separa texto em segmentos {type:"answer"|"think", text}.
// Mantem buffer entre chamadas porque uma tag <think> pode chegar partida em chunks.
// Chamar splitter.flush() no final do stream para emitir o que resta no buffer.
function createThinkSplitter() {
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let buffer = "";
  let inThink = false;

  function push(chunk) {
    buffer += chunk;
    const out = [];

    while (buffer.length > 0) {
      if (!inThink) {
        const openIdx = buffer.indexOf(OPEN);
        if (openIdx === -1) {
          const safeLen = buffer.length - (OPEN.length - 1);
          if (safeLen > 0) {
            out.push({ type: "answer", text: buffer.slice(0, safeLen) });
            buffer = buffer.slice(safeLen);
          }
          break;
        }
        if (openIdx > 0) {
          out.push({ type: "answer", text: buffer.slice(0, openIdx) });
        }
        buffer = buffer.slice(openIdx + OPEN.length);
        inThink = true;
      } else {
        const closeIdx = buffer.indexOf(CLOSE);
        if (closeIdx === -1) {
          const safeLen = buffer.length - (CLOSE.length - 1);
          if (safeLen > 0) {
            out.push({ type: "think", text: buffer.slice(0, safeLen) });
            buffer = buffer.slice(safeLen);
          }
          break;
        }
        if (closeIdx > 0) {
          out.push({ type: "think", text: buffer.slice(0, closeIdx) });
        }
        buffer = buffer.slice(closeIdx + CLOSE.length);
        inThink = false;
      }
    }

    return out;
  }

  push.flush = function () {
    if (!buffer) return [];
    const type = inThink ? "think" : "answer";
    const remaining = buffer;
    buffer = "";
    inThink = false;
    return [{ type, text: remaining }];
  };

  return push;
}

function renderMarkdown(text) {
  return marked.parse(text, { breaks: true });
}

function buildStepsHtml(steps) {
  return steps
    .map((name) => {
      const label = STEP_LABELS[name] || name;
      return (
        `<div class="step-wrap" data-step="${name}">` +
        `<div class="step is-pending" id="step-${name}">` +
        `<span class="step__icon">&#9675;</span>` +
        `<span>${label}</span>` +
        `</div>` +
        `<div class="step__detail" id="step-detail-${name}" hidden></div>` +
        `</div>`
      );
    })
    .join("");
}

function ensureDetailLog(stepName) {
  const detail = document.getElementById(`step-detail-${stepName}`);
  if (!detail) return null;
  if (!detail.querySelector(".step__log")) {
    detail.innerHTML =
      `<div class="step__log"></div>` +
      `<div class="step__status"></div>`;
  }
  return detail;
}

function appendStepLog(stepName, text) {
  const detail = ensureDetailLog(stepName);
  if (!detail || !text) return;
  detail.hidden = false;
  const log = detail.querySelector(".step__log");
  const line = document.createElement("div");
  line.className = "step__log-line";
  line.textContent = text;
  log.appendChild(line);
}

function setStepStatusMessage(stepName, text) {
  const detail = ensureDetailLog(stepName);
  if (!detail) return;
  detail.hidden = false;
  const statusEl = detail.querySelector(".step__status");
  statusEl.textContent = text || "";
}

function updateStep(stepName, status, message, progress, data) {
  const el = document.getElementById(`step-${stepName}`);
  if (!el) return;

  el.className = `step is-${status}`;

  const iconEl = el.querySelector(".step__icon");
  if (status === "running") {
    iconEl.innerHTML = `<span class="spinner"></span>`;
  } else if (status === "done") {
    iconEl.innerHTML = "&#10003;";
  } else if (status === "error") {
    iconEl.innerHTML = "&#10007;";
  }

  // progress = linha incremental que se acumula
  if (progress) {
    appendStepLog(stepName, progress);
  }

  // message = status "atual" do step (substituido a cada update)
  if (message) {
    setStepStatusMessage(stepName, message);
  }

  // Compat: dados extras exibidos como linhas de progresso
  if (data?.rewrittenQuery) {
    appendStepLog(stepName, `"${data.rewrittenQuery}"`);
  }
}

function resetUi() {
  output.innerHTML = "";
  stepsEl.innerHTML = "";
  stepsEl.hidden = true;
  thinkingBody.textContent = "";
  thinking.hidden = true;
  thinking.open = false;
}

function processPayload(payload, state) {
  if (payload.workflow) {
    stepsEl.hidden = false;
    stepsEl.innerHTML = buildStepsHtml(payload.workflow.steps);
    return;
  }

  if (payload.error) {
    // Mark any running steps as error
    document.querySelectorAll(".step.is-running").forEach((el) => {
      const stepName = el.id.replace("step-", "");
      updateStep(stepName, "error", "Falhou");
    });
    output.innerHTML = `<p class="text-error">${payload.error}</p>`;
    return;
  }

  if (payload.node) {
    const { step, status, message, progress, data } = payload.node;
    updateStep(step, status, message, progress, data);
    return;
  }

  if (payload.content) {
    for (const part of state.splitter(payload.content)) {
      if (part.type === "think") {
        if (thinking.hidden) thinking.hidden = false;
        thinkingBody.textContent += part.text;
      } else {
        if (state.firstAnswerToken) {
          output.innerHTML = "";
          state.firstAnswerToken = false;
        }
        state.answerText += part.text;
        output.innerHTML = renderMarkdown(state.answerText);
      }
    }
  }
}

function processSseBuffer(sseBuffer, state) {
  let sepIdx;
  while ((sepIdx = sseBuffer.indexOf("\n\n")) !== -1) {
    const eventText = sseBuffer.slice(0, sepIdx);
    sseBuffer = sseBuffer.slice(sepIdx + 2);
    if (!eventText) continue;

    const dataLine = eventText
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!dataLine) continue;

    try {
      const payload = JSON.parse(dataLine.slice(6));
      processPayload(payload, state);
    } catch {
      /* ignore malformed JSON */
    }
  }
  return sseBuffer;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetUi();
  output.innerHTML = "<p>Processando...</p>";

  const response = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: input.value }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const state = {
    splitter: createThinkSplitter(),
    answerText: "",
    firstAnswerToken: true,
  };

  let sseBuffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    sseBuffer = processSseBuffer(sseBuffer, state);
  }

  // Process any remaining data in the SSE buffer after stream ends
  sseBuffer += decoder.decode();
  if (sseBuffer.trim()) {
    sseBuffer += "\n\n";
    processSseBuffer(sseBuffer, state);
  }

  // Flush the think splitter to emit any retained tail characters
  for (const part of state.splitter.flush()) {
    if (part.type === "think") {
      thinkingBody.textContent += part.text;
    } else {
      state.answerText += part.text;
    }
  }

  // Final render to ensure complete markdown
  if (state.answerText) {
    output.innerHTML = renderMarkdown(state.answerText);
  }
});
