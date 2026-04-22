# Fase 1 — Modo Pedagógico no State

## Problema Atual

Mesmo com `synthesize` em modo ReAct, o sistema ainda responde como se toda pergunta fosse do mesmo tipo pedagógico.

Hoje falta uma decisão explícita sobre **como ensinar**:

- resposta direta
- exemplo
- analogia
- clarificação
- avaliação
- condução socrática

Isso tende a empurrar decisões importantes para o prompt do agente, sem estado observável e sem telemetria clara.

## Solução

Adicionar um nó leve entre `classify` e `synthesize` para decidir o `pedagogicalMode`.

O objetivo não é multiplicar subgrafos ainda, e sim colocar no state uma decisão explícita que o `synthesize` possa consumir.

## Grafo

```js
START
  -> classify
  -> decide-teaching-mode
  -> synthesize
  -> END
```

## Modos iniciais

```js
const PedagogicalMode = z.enum([
  "direct",
  "example",
  "analogy",
  "clarify",
  "assessment",
  "socratic",
]);
```

## Critérios de roteamento sugeridos

- `example`
  - quando o aluno pede exemplo, caso prático, código ou ilustração
- `analogy`
  - quando pede simplificação, metáfora, figuras de linguagem, explicação intuitiva
- `clarify`
  - quando a pergunta é ambígua ou curta demais
- `assessment`
  - quando o aluno pede teste, validação de entendimento ou exercício
- `socratic`
  - quando o aluno pede pista, quer pensar sozinho ou ativa explicitamente o “sensei mode”
- `direct`
  - fallback padrão

## Arquivos novos

### 1. `server/agent/workflow/decide-teaching-mode.js`

Nó com structured output:

```js
z.object({
  pedagogicalMode: PedagogicalMode,
  rationale: z.string(),
});
```

Deve receber:

- `state.question`
- `state.intent`

Deve retornar:

- `pedagogicalMode`

## Arquivos a modificar

### 2. `server/agent/workflow/index.js`

- adicionar `pedagogicalMode` ao state
- adicionar nó `decide-teaching-mode`
- ligar `classify -> decide-teaching-mode -> synthesize`

### 3. `server/agent/workflow/synthesize-answer.js`

Consumir `state.pedagogicalMode` no prompt base.

Exemplos de instrução:

- `direct`: responder com objetividade
- `example`: priorizar explicação com exemplo concreto
- `analogy`: explicar com analogia fiel ao conceito
- `clarify`: não responder de vez; pedir a menor pergunta útil
- `assessment`: formular mini checagem antes de concluir
- `socratic`: evitar entrega direta precoce; usar pergunta-guia

### 4. `server/agent/chat.js`

Opcionalmente emitir step fixo `decide-teaching-mode` no accordion.

### 5. `web/script.js`

Mostrar no log do step o modo escolhido e a justificativa.

## Checklist de verificação

- [ ] `pedagogicalMode` aparece no state final
- [ ] Perguntas do tipo “me dê um exemplo” escolhem `example`
- [ ] Perguntas do tipo “explique com analogia” escolhem `analogy`
- [ ] Perguntas ambíguas podem cair em `clarify`
- [ ] `synthesize` respeita o modo no estilo de saída
- [ ] O accordion mostra essa decisão com clareza
