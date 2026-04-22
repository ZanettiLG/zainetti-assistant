# Plano Geral — Aula04 Tutor Stateful

## Visão Geral

Este plano parte do pressuposto do `plan01`: o grafo principal foi simplificado para `classify -> synthesize`, e o nó `synthesize` virou um agente ReAct com tools de busca.

O foco aqui muda de lugar: em vez de detalhar a FSM de retrieval, passamos a usar LangGraph para modelar o comportamento pedagógico do tutor, a memória da sessão e os loops multi-turno com o aluno.

| Fase | Escopo | Dependência |
|------|--------|-------------|
| 1 — Modo pedagógico no state | Backend | Requer `plan01` Fase 3 |
| 2 — Clarificação e verificação | Backend + Frontend | Requer Fase 1 |
| 3 — Loop tutor-aluno | Backend + Frontend | Requer Fase 1 |
| 4 — Memória e progresso | Backend | Requer Fase 3 |
| 5 — Sensei mode | Backend + Frontend | Requer Fases 3 e 4 |

---

## Princípio Arquitetural

No `plan01`, o ganho principal do LangGraph sai de `retrieve/rewrite/broad-context` e vai para o `synthesize` com ReAct.

Neste `plan02`, o próximo ganho real do LangGraph vem de três pontos:

1. estado pedagógico explícito
2. espera e retomada entre turnos
3. loops de avaliação e remediação

Em outras palavras:

- a busca continua dentro do agente ReAct
- a FSM passa a controlar o tutor
- a memória passa a controlar continuidade

---

## Ordem de Implementação

```
plan01/Fase 3
  -> plan02/Fase 1
  -> plan02/Fase 2
  -> plan02/Fase 3
  -> plan02/Fase 4
  -> plan02/Fase 5
```

**Nota**: Fases 1 e 2 são as que mais reduzem resposta errada ou mal enquadrada sem exigir ainda um tutor multi-turno completo.

**Nota**: Fases 3, 4 e 5 transformam o chat em um fluxo pedagógico de verdade, com continuidade entre turnos.

---

## Grafo-alvo

### Grafo top-level

Estrutura sugerida:

```js
START
  -> classify
  -> decide-teaching-mode
  -> synthesize
  -> verify-or-followup
  -> END
```

### Estado principal sugerido

```js
const TutorState = new StateSchema({
  question: z.string(),
  intent: z.string().optional(),
  pedagogicalMode: z
    .enum(["direct", "example", "analogy", "clarify", "assessment", "socratic"])
    .optional(),
  answer: z.string().optional(),
  documents: z.array(z.any()).default([]),
  verification: z
    .object({
      grounded: z.boolean().default(false),
      sufficient: z.boolean().default(false),
      needsClarification: z.boolean().default(false),
    })
    .optional(),
  waitingForStudent: z.boolean().default(false),
  studentAnswer: z.string().optional(),
  assessment: z
    .object({
      result: z.enum(["correct", "partial", "misconception", "off_topic"]).optional(),
      feedback: z.string().optional(),
    })
    .optional(),
  conversationSummary: z.string().optional(),
  studentProfile: z.any().optional(),
});
```

---

## Resumo das Mudanças por Arquivo

### Backend (server/agent/)

| Arquivo | Fase 1 | Fase 2 | Fase 3 | Fase 4 | Fase 5 |
|---------|--------|--------|--------|--------|--------|
| `workflow/index.js` | Adicionar `decide-teaching-mode` e `verify-or-followup` | Refinar arestas condicionais | Incluir fluxo multi-turno | Compilar com checkpointer | Rotear para `socratic-subgraph` |
| `workflow/synthesize-answer.js` | Consumir `pedagogicalMode` | Respeitar clarificação e verificação | Integrar com `ask-student` | Consumir resumo da conversa | Modo socrático guiado |
| `workflow/classify-intent.js` | — | — | — | — | — |
| `workflow/decide-teaching-mode.js` | **NOVO** | Ajustes finos | — | Considerar memória | Considerar preferência do aluno |
| `workflow/verify-or-followup.js` | — | **NOVO** | Expandir decisões | Considerar histórico | Considerar estado socrático |
| `workflow/ask-student.js` | — | — | **NOVO** | Usa memória da thread | Reuso parcial |
| `workflow/assess-student-answer.js` | — | — | **NOVO** | Atualiza progresso | Reuso parcial |
| `workflow/update-memory.js` | — | — | — | **NOVO** | Atualiza estilo preferido |
| `workflow/socratic-subgraph.js` | — | — | — | — | **NOVO** |
| `chat.js` | Expor novos steps fixos | Tratar follow-up/clarify | Tratar turno em espera | Passar `thread_id` | Tratar retomada socrática |

### Frontend (web/)

| Arquivo | Fase 1 | Fase 2 | Fase 3 | Fase 4 | Fase 5 |
|---------|--------|--------|--------|--------|--------|
| `script.js` | Exibir modo pedagógico | Exibir clarificação/verificação | Exibir step de pergunta ao aluno | Persistir `threadId` local | Exibir modo sensei |
| `index.html` | — | — | Ajustes de UX para follow-up | — | Ajustes de UX socrática |
| `style.css` | Badge de modo | Estado visual de clarificação | Estado visual de pergunta/feedback | — | Estado visual de sensei |

---

## O Que Não Entra Neste Plano

Não abrir novamente o pipeline de retrieval como vários nós top-level.

Fica fora deste plano:

- trazer `rewrite`, `retrieve` e `broad-context` de volta ao grafo principal
- transformar cada estilo de resposta em um nó separado sem necessidade
- criar multi-agent antes de existir necessidade real de handoff

Regra prática:

- `example` e `analogy` podem começar como modos do agente
- `assessment`, `clarify` e `socratic` merecem estados explícitos

---

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Explodir o número de estados cedo demais | Começar com poucos modos: `direct`, `example`, `analogy`, `clarify`, `assessment`, `socratic` |
| Misturar retrieval com pedagogia no mesmo lugar | Manter busca dentro do `synthesize` e controle pedagógico no grafo |
| Fluxo multi-turno sem persistência consistente | Introduzir `thread_id` e checkpointer antes do sensei mode |
| UI ficar confusa com steps demais | Separar steps fixos do grafo de steps dinâmicos do agente |
| Verificação online gerar latência excessiva | Fazer verificação leve, com regras e no máximo uma revisão |

---

## Tempo Estimado

- **Fase 1**: 1–2h
- **Fase 2**: 2–3h
- **Fase 3**: 3–5h
- **Fase 4**: 3–5h
- **Fase 5**: 4–6h

---

## Resumo em uma frase

Depois do `plan01` simplificar o grafo e colocar agency no `synthesize`, o `plan02` usa LangGraph onde ele realmente agrega valor ao produto: modos pedagógicos, clarificação, avaliação do aluno, memória e fluxo socrático multi-turno.
