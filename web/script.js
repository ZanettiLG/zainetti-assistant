/* global marked */

// =========================================================
// Constants
// =========================================================
const STEP_LABELS = {
  classify: "Classificar intenção",
  synthesize: "Síntese da resposta",
};

// =========================================================
// DOM Elements
// =========================================================
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const messagesContainer = document.getElementById("messages-container");
const chatMessages = document.getElementById("chat-messages");

// =========================================================
// State
// =========================================================

// =========================================================
// Think Splitter
// =========================================================
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

// =========================================================
// Utilities
// =========================================================
function renderMarkdown(text) {
  return marked.parse(text, { breaks: true });
}

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function autoResizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
}

// =========================================================
// Message Creation
// =========================================================
function createUserMessage(text) {
  const messageEl = document.createElement("div");
  messageEl.className = "message message--user";
  messageEl.innerHTML = `
    <div class="message__content">
      <div class="message__bubble">
        <p>${escapeHtml(text)}</p>
      </div>
      <span class="message__time">${formatTime()}</span>
    </div>
  `;
  messagesContainer.appendChild(messageEl);
  scrollToBottom();
  return messageEl;
}

function createBotMessage() {
  const messageEl = document.createElement("div");
  messageEl.className = "message message--bot";
  messageEl.innerHTML = `
    <div class="message__avatar">
      <img src="./assets/zanaitti.png" alt="Zainetti" />
    </div>
    <div class="message__content">
      <div class="message__bubble" id="bot-bubble-${Date.now()}">
        <div class="bot-workflow"></div>
        <div class="bot-thinking">
          <div class="thinking-dots">
            <div class="typing-indicator__dot"></div>
            <div class="typing-indicator__dot"></div>
            <div class="typing-indicator__dot"></div>
          </div>
        </div>
        <div class="bot-answer"></div>
      </div>
      <span class="message__time">${formatTime()}</span>
    </div>
  `;
  messagesContainer.appendChild(messageEl);
  scrollToBottom();
  return {
    messageEl,
    bubbleEl: messageEl.querySelector(".message__bubble"),
    answerEl: messageEl.querySelector(".bot-answer"),
    thinkingEl: messageEl.querySelector(".bot-thinking"),
    workflowEl: messageEl.querySelector(".bot-workflow"),
  };
}

function hideThinkingIndicator(botMessage) {
  if (botMessage.thinkingEl) {
    botMessage.thinkingEl.style.display = "none";
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// =========================================================
// Workflow Accordion (Raciocínio do modelo)
// =========================================================
function createWorkflowAccordion(parentEl) {
  const accordion = document.createElement("details");
  accordion.className = "workflow-accordion";
  accordion.open = false;

  const summary = document.createElement("summary");
  summary.className = "workflow-summary";
  summary.innerHTML = `
    <span class="workflow-summary__left">
      <svg class="workflow-summary__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
        <path d="M12 2a10 10 0 0 1 10 10"></path>
        <path d="M12 12 2.1 9.9"></path>
      </svg>
      <span class="workflow-summary__title">Raciocínio do modelo</span>
    </span>
    <span class="workflow-summary__status" id="workflow-status">Processando...</span>
  `;
  accordion.appendChild(summary);

  const body = document.createElement("div");
  body.className = "workflow-body";
  accordion.appendChild(body);

  parentEl.appendChild(accordion);
  return { accordion, body };
}

function ensureStep(workflowBody, stepName) {
  let stepEl = workflowBody.querySelector(`[data-step="${stepName}"]`);
  if (stepEl) return stepEl;

  stepEl = document.createElement("details");
  stepEl.className = "step-details is-pending";
  stepEl.dataset.step = stepName;

  const summary = document.createElement("summary");
  summary.className = "step-summary";
  summary.innerHTML = `
    <span class="step__icon">&#9675;</span>
    <span class="step__label">${STEP_LABELS[stepName] || stepName}</span>
    <span class="step__badge"></span>
  `;
  stepEl.appendChild(summary);

  const body = document.createElement("div");
  body.className = "step-body";

  const logContainer = document.createElement("div");
  logContainer.className = "step__log";
  body.appendChild(logContainer);

  const statusEl = document.createElement("div");
  statusEl.className = "step__status";
  body.appendChild(statusEl);

  stepEl.appendChild(body);
  workflowBody.appendChild(stepEl);
  return stepEl;
}

function appendStepLog(stepEl, text) {
  const logContainer = stepEl.querySelector(".step__log");
  if (!logContainer || !text) return;
  const line = document.createElement("div");
  line.className = "step__log-line";
  line.textContent = text;
  logContainer.appendChild(line);
  stepEl.open = true;
  scrollToBottom();
}

function setStepStatus(stepEl, text) {
  const statusEl = stepEl.querySelector(".step__status");
  if (!statusEl) return;
  statusEl.textContent = text || "";
}

function updateStepBadge(stepEl, status) {
  const badge = stepEl.querySelector(".step__badge");
  if (!badge) return;
  if (status === "done") {
    badge.textContent = "Concluído";
    badge.className = "step__badge is-done";
  } else if (status === "running") {
    badge.textContent = "Executando...";
    badge.className = "step__badge is-running";
  } else if (status === "error") {
    badge.textContent = "Erro";
    badge.className = "step__badge is-error";
  } else if (status === "skipped") {
    badge.textContent = "Não executado";
    badge.className = "step__badge is-skipped";
  } else {
    badge.textContent = "";
    badge.className = "step__badge";
  }
}

function updateStep(stepEl, { status, message, progress, data }) {
  stepEl.classList.remove("is-pending", "is-running", "is-done", "is-error", "is-skipped");
  stepEl.classList.add(`is-${status}`);

  const iconEl = stepEl.querySelector(".step__icon");
  if (status === "running") {
    iconEl.innerHTML = `<span class="spinner"></span>`;
    stepEl.open = true;
  } else if (status === "done") {
    iconEl.innerHTML = "&#10003;";
  } else if (status === "error") {
    iconEl.innerHTML = "&#10007;";
  } else if (status === "skipped") {
    iconEl.innerHTML = "&#9702;";
  }

  updateStepBadge(stepEl, status);

  if (progress) {
    appendStepLog(stepEl, progress);
  }

  if (data) {
    appendStepLog(stepEl, JSON.stringify(data, null, 2));
  }

  if (message) {
    setStepStatus(stepEl, message);
  }
}

function updateWorkflowStatus(workflowAccordion) {
  const steps = workflowAccordion.querySelectorAll(".step-details");
  const done = workflowAccordion.querySelectorAll(".step-details.is-done").length;
  const total = steps.length;
  const statusEl = workflowAccordion.querySelector(".workflow-summary__status");
  if (statusEl) {
    statusEl.textContent = `${done}/${total} etapas`;
  }
}

// =========================================================
// SSE Processing
// =========================================================
function processPayload(payload, state) {
  if (payload.type === "workflow") {
    hideThinkingIndicator(state.botMessage);

    if (!state.workflow) {
      state.workflow = createWorkflowAccordion(state.botMessage.workflowEl);
    }
    for (const stepName of payload.steps) {
      ensureStep(state.workflow.body, stepName);
    }
    updateWorkflowStatus(state.workflow.accordion);
    scrollToBottom();
    return;
  }

  if (payload.type === "error") {
    hideThinkingIndicator(state.botMessage);

    if (state.workflow) {
      state.workflow.body.querySelectorAll(".step-details.is-running").forEach((el) => {
        updateStep(el, { status: "error", message: "Falhou" });
      });
    }

    const errorEl = document.createElement("div");
    errorEl.className = "text-error";
    errorEl.style.marginTop = "8px";
    errorEl.textContent = `Erro: ${payload.error}`;
    state.botMessage.answerEl.appendChild(errorEl);
    scrollToBottom();
    return;
  }

  if (payload.type === "node") {
    const node = payload.node || {};
    const { step, status, message, progress, data, content } = node;
    if (!step) return;

    if (step === "final-answer") {
      hideThinkingIndicator(state.botMessage);

      if (content) {
        const chunkEl = document.createElement("div");
        chunkEl.className = "answer-chunk";
        chunkEl.innerHTML = renderMarkdown(content);
        state.botMessage.answerEl.appendChild(chunkEl);

        requestAnimationFrame(() => {
          chunkEl.classList.add("is-visible");
        });
      }
    } else {
      if (state.workflow) {
        const stepEl = ensureStep(state.workflow.body, step);
        updateStep(stepEl, { status, message, progress, data });
      }
    }

    if (state.workflow) {
      updateWorkflowStatus(state.workflow.accordion);
    }
    scrollToBottom();
    return;
  }

  if (payload.type === "turn_done") {
    hideThinkingIndicator(state.botMessage);

    if (state.workflow) {
      state.workflow.body.querySelectorAll(".step-details.is-pending").forEach((el) => {
        updateStep(el, { status: "skipped", message: "Não executado neste fluxo" });
      });
      updateWorkflowStatus(state.workflow.accordion);
    }
    scrollToBottom();
    return;
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

// =========================================================
// Event Handlers
// =========================================================
messageInput.addEventListener("input", autoResizeTextarea);

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = messageInput.value.trim();
  if (!question) return;

  messageInput.value = "";
  messageInput.style.height = "auto";

  createUserMessage(question);

  const botMessage = createBotMessage();

  const state = {
    botMessage,
    workflow: null,
  };

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      sseBuffer = processSseBuffer(sseBuffer, state);
    }

    sseBuffer += decoder.decode();
    if (sseBuffer.trim()) {
      sseBuffer += "\n\n";
      processSseBuffer(sseBuffer, state);
    }

    hideThinkingIndicator(botMessage);
    scrollToBottom();
  } catch (error) {
    console.error("Error:", error);
    hideThinkingIndicator(botMessage);
    botMessage.answerEl.innerHTML = `<p class="text-error">Erro de conexão. Tente novamente.</p>`;
    scrollToBottom();
  }
});

// =========================================================
// Initial scroll
// =========================================================
scrollToBottom();
