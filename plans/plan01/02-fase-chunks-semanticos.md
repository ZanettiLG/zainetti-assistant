# Fase 2 — Chunks Semânticos no Stream

## Problema
Hoje cada token do modelo é concatenado e o markdown é re-renderizado inteiro a cada novo token (`state.answerText += part.text; innerHTML = renderMarkdown(...)`). Isso causa:
1. "Muro de texto" — tudo aparece de uma vez sem hierarquia visual
2. Re-renderização completa do markdown a cada token (ineficiente)
3. Experiência ruim de leitura — sem sensação de "digitação" ou organização

## Solução
Implementar buffering de parágrafos no backend e renderização incremental por bloco no frontend. A detecção é feita por marcadores semânticos (`\n\n` e `\n#`) sem adicionar latência artificial.

## Arquivos a modificar

### 1. `server/agent/chat.js`

**Remover** o handler de `messages` stream (linhas ~61-76) que tratava cada token individualmente. Substituir por um sistema de eventos custom do workflow (os chunks serão emitidos pelo nó `synthesize` via `writer`).

```js
// ANTES (remover):
} else if (event === "messages") {
  const [token, metadata] = data;
  if (metadata?.langgraph_node !== "synthesize") continue;
  const text = typeof token.content === "string" ? token.content : "";
  if (text) {
    send("node", {
      node: {
        step: "final-answer",
        status: "running",
        message: "Gerando resposta final...",
        content: text,
      },
    });
  }
}

// DEPOIS: não fazer nada com "messages" — o nó synthesize emitting via "custom"
```

### 2. `server/agent/workflow/synthesize-answer.js`

Refatorar para usar `model.stream()` internamente com buffer semântico. O nó emite eventos custom para cada parágrafo completo detectado.

**Lógica do buffer:**
```js
let buffer = "";

function flushBuffer(force = false) {
  if (!buffer && !force) return null;
  const chunk = buffer;
  buffer = "";
  return chunk;
}

function tryFlush(text) {
  // Detecta \n# (nova seção) ou \n\n (novo parágrafo)
  const paraMatch = text.match(/^(.*?)(\n#+ |$)/);
  // ...
}
```

**Emissão de chunks:**
```js
const stream = await model.stream(messages);
for await (const chunk of stream) {
  buffer += getMessageText(chunk);
  // Detectar \n\n ou \n# no buffer e emitir parágrafo completo
  // Quando emitir:
  writer({
    step: "final-answer",
    status: "running",
    content: paragraphText,  // parágrafo completo, sem \n\n no fim
  });
}
// Flush final
```

### 3. `web/script.js` — `processPayload()`

**Handler `final-answer`** (atualmente linha ~361-394):

**Antes**: acumulava texto e re-renderizava markdown inteiro a cada chunk:
```js
state.answerText += part.text;
state.botMessage.answerEl.innerHTML = renderMarkdown(state.answerText);
```

**Depois**: cria um novo bloco DOM por chunk com animação:
```js
if (step === "final-answer") {
  hideThinkingIndicator(state.botMessage);

  if (payload.content) {
    // Criar chunk como elemento separado
    const chunkEl = document.createElement("div");
    chunkEl.className = "answer-chunk";
    chunkEl.innerHTML = renderMarkdown(payload.content);
    state.botMessage.answerEl.appendChild(chunkEl);

    // Animar entrada
    requestAnimationFrame(() => {
      chunkEl.classList.add("is-visible");
    });
  }

  if (payload.status === "done") {
    // apenas cleanup se necessário
  }
}
```

**Remover** `state.answerText` do state (não precisa mais acumular).

### 4. `web/style.css`

Adicionar animação para chunks:
```css
.answer-chunk {
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.25s ease, transform 0.25s ease;
  margin-bottom: 12px;
}

.answer-chunk.is-visible {
  opacity: 1;
  transform: translateY(0);
}

/* Separador visual entre chunks */
.answer-chunk:not(:last-child)::after {
  content: "";
  display: block;
  height: 1px;
  background: var(--border-subtle);
  margin-top: 16px;
}
```

## Comportamento esperado
1. Backend detecta fim de parágrafo quando encontra `\n\n` ou início de seção (`\n#`)
2. Emite cada parágrafo completo como um evento `final-answer`
3. Frontend adiciona cada parágrafo como elemento separado com fade-in
4. Nenhum `\n\n` residual no markdown final renderizado (remover ao criar chunk)
5. Seção de código (```) também treated como chunk atômico

## Checklist de verificação
- [ ] Parágrafos chegam incrementalmente (não tudo de uma vez)
- [ ] Cada chunk tem animação de entrada suave
- [ ] Não há re-render do markdown inteiro a cada token
- [ ] Seções com `##` são tratadas como novos chunks
- [ ] Code blocks são preservados corretamente
- [ ] `turn_done` não causa duplicação ou perda de conteúdo
