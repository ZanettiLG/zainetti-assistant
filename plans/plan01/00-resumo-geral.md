# Plano Geral — Aula04 Refatoração

## Visão Geral

Três fases independentes (Fase 1 é bug fix pure frontend, Fases 2 e 3 requerem backend + frontend).

| Fase | Escopo | Dependência |
|------|--------|-------------|
| 1 — Acórdão visível | Frontend only | Nenhuma |
| 2 — Chunks semânticos | Backend + Frontend | Requer Fase 3 (backend) |
| 3 — RAG como tools | Backend + Frontend | Requer refatoração do synthesize |

---

## Ordem de Implementação

```
Fase 1 → (opcionalmente fase 2 em paralelo, pois são mudanças separadas)
       → Fase 3 → chunks finalizados
```

**Nota**: Fase 1 é 100% frontend e não interfere em nada. Pode ser feita primeiro sem risco.

**Nota sobre Fase 2 e 3**: A lógica de chunking semântico será implementada dentro do nó `synthesize` na Fase 3. Ou seja, a Fase 2 fica "incompleta" até a Fase 3 estar pronta — mas os planos são separados para clareza.

---

## Resumo das Mudanças por Arquivo

### Frontend (web/)
| Arquivo | Fase 1 | Fase 2 | Fase 3 |
|---------|--------|--------|--------|
| `script.js` — `createBotMessage()` | Inverter ordem DOM | — | — |
| `script.js` — `processPayload()` | — | Renderizar por chunk | Adicionar handler `tool_call` |
| `script.js` — `STEP_LABELS` | — | — | Adicionar fallback dinâmico |
| `style.css` | Ajustar spacing | Adicionar `@keyframes chunk-in` | — |

### Backend (server/agent/)
| Arquivo | Fase 1 | Fase 2 | Fase 3 |
|---------|--------|--------|--------|
| `chat.js` | — | Remover handler `messages` | Atualizar steps + tratar `tool_call` |
| `workflow/index.js` | — | — | Remover nós; simplificar grafo |
| `workflow/synthesize-answer.js` | — | Buffer semântico + stream | Loop ReAct + tools |
| `workflow/search-tools.js` | — | — | **NOVO** — tools + executores |

### Arquivos Obsoletos (mantidos, desconectados)
- `workflow/retrieve-docs.js`
- `workflow/broad-context.js`
- `workflow/rewrite-query.js`

---

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Fase 3 quebrar o streaming de tokens | Testar com stream Simples primeiro (sem ReAct) |
| Tool calls lentos bloquearem o loop | Todas as execuções de tool são `await` e não bloqueiam o servidor (são I/O only) |
| Chunks serem emitidos muito rapidamente | Frontend tem `requestAnimationFrame` para animação; não há throttling necessário |
| Intent classification ser afetada | Mantida como nó separado; passa `intent` via state para synthesize |

---

## Tempo Estimado

- **Fase 1**: 15–30 min (css + html reorder)
- **Fase 2**: 1–2h (backend buffer + frontend render)
- **Fase 3**: 2–3h (ReAct + tools + grafo)
