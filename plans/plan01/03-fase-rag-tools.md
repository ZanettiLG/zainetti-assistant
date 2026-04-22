# Fase 3 — RAG como Tools (Agente ReAct)

## Problema Atual
O pipeline é fixo e linear: `classify → rewrite → broad-context → retrieve → synthesize`. O modelo de síntese não tem agency — ele apenas recebe os documentos já recuperados e formula a resposta. Isso:
1. Impossibilita o modelo decidir o que buscar
2. Gera steps fixos no UI mesmo quando não são necessários
3. Não permite refinamento iterativo da busca

## Solução
Transformar o nó `synthesize` em um **agente ReAct** que possui tools de busca. O grafo LangGraph é simplificado para `START → classify → synthesize → END`. O agente decide autonomamente quais queries formular e quantas buscas fazer.

## Arquivos novos

### 1. `server/agent/workflow/search-tools.js` — Definição das Tools

```js
// Tools que o agente pode chamar durante o loop ReAct

const searchHybridTool = {
  type: "function",
  name: "search_hybrid",
  description: "Busca vetorial + BM25 (RRF) para encontrar trechos relevantes nas aulas. Use para buscas pontuais ou amplas.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Query de busca" },
      topK: { type: "number", description: "Número de resultados (default 8)" }
    },
    required: ["query"]
  }
};

const searchLessonsTool = {
  type: "function",
  name: "search_lessons",
  description: "Identifica as aulas mais relevantes para um tema amplo. Use para intents 'ampla' ou 'comparativa' antes de buscar chunks.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Tema para identificar aulas" },
      limit: { type: "number", description: "Número de aulas (default 3)" }
    },
    required: ["query"]
  }
};
```

**Funções de execução** (wrappam `rag` existente):
```js
async function executeSearchHybrid({ query, topK = 8 }) {
  // Chama rag.retrieveHybrid(query, { topK })
  // Emite writer event antes e depois
  // Retorna array de documentos formatados
}

async function executeSearchLessons({ query, limit = 3 }) {
  // Chama rag.retrieveLessons(query, limit)
  // Emite writer event
  // Retorna array de aulas
}
```

## Arquivos a modificar

### 2. `server/agent/workflow/synthesize-answer.js` — Loop ReAct + Chunks

**Entrada do nó**: recebe `state.intent` e `state.question`

**Fluxo**:
1. Prepara mensagens iniciais com system prompt e contexto (sem documentos — o agente busca)
2. Faz `model.bindTools([searchHybridTool, searchLessonsTool])`
3. Loop ReAct:
   - `response = await model.invoke(messages)` com tools
   - Se `response.tool_calls`: executa cada tool, adiciona resultado em `messages`, continua
   - Se sem `tool_calls`: entra em modo stream para output final
4. Stream final com chunking semântico (mesmo mecanismo da Fase 2)

**Emissão de eventos**:
- `"tool_call"` → para o UI mostrar que está buscando
- `"final-answer"` (chunk) → parágrafos da resposta final
- `"done"` → finalização

```js
// Exemplo de evento emitido por tool call
writer({
  step: `Busca: "${query}"`,
  status: "running",
  progress: `Buscando "${query}"...`,
});

writer({
  step: `Busca: "${query}"`,
  status: "done",
  message: `${results.length} trechos encontrados`,
});
```

### 3. `server/agent/workflow/index.js` — Grafo Simplificado

**Nós restantes**: `classify`, `synthesize`
**Arestas**:
- `START → classify`
- `classify → synthesize` (sempre, passando `intent` no state)
- `synthesize → END`

```js
// Estrutura do grafo simplificada
const graph = new StateGraph(StateSchema)
  .addNode("classify", classifyNode)
  .addNode("synthesize", synthesizeNode)  // agora é o agente ReAct
  .addEdge(START, "classify")
  .addEdge("classify", "synthesize")
  .addEdge("synthesize", END)
  .compile();
```

**Removidos do grafo**: `rewrite`, `broad-context`, `retrieve`

### 4. `server/agent/chat.js`

**Steps anunciados** no workflow event:
```js
send("workflow", {
  steps: ["classify", "synthesize"],
});
```

### 5. `web/script.js` — UI para Tool Calls

**`STEP_LABELS`** — adicionar fallback dinâmico:
```js
const STEP_LABELS = {
  classify: "Classificando intenção",
  synthesize: "Sintetizando resposta",
  // Steps dinâmicos de tool calls usam o nome da tool como label
  // ex: "Busca: 'autenticação'" → label "Busca: 'autenticação'"
};
```

**`ensureStep()`** — permitir step names dinâmicos (já funciona, pois usa `stepName` diretamente).

**Handler `tool_call`** no `processPayload`:
```js
if (payload.type === "tool_call") {
  const { step, status, progress, data } = payload;
  if (state.workflow) {
    const stepEl = ensureStep(state.workflow.body, step);
    updateStep(stepEl, { status, progress, data });
    updateWorkflowStatus(state.workflow.accordion);
  }
  return;
}
```

## Comportamento Esperado no UI

1. Step "Classificando intenção" →done
2. Step "Sintetizando resposta" → running
3. Dynamically: "Busca: 'autenticação'" → running
4. "Busca: 'autenticação'" → done
5. "Busca: 'OAuth2'" → running → done
6. Resposta final chega por chunks (como Fase 2)
7. "Sintetizando resposta" → done

## Arquivos Obsoletos (desconectados do grafo, manter para referência)
- `server/agent/workflow/retrieve-docs.js`
- `server/agent/workflow/broad-context.js`
- `server/agent/workflow/rewrite-query.js`

## Checklist de verificação
- [ ] Grafo compila com apenas classify + synthesize
- [ ] Agente faz tool calls quando necessário
- [ ] Cada tool call aparece como step dinâmico no accordion
- [ ] Resposta final chega via chunks semânticos (Fase 2)
- [ ] Classification continua funcionando (intent passada ao synthesize via state)
- [ ] Erros de tool call são tratados e mostrados no UI
- [ ] `workflow` event no chat.js lista apenas os steps fixos
