# Fase 2 — Clarificação e Verificação

## Problema Atual

Mesmo com tools e ReAct, ainda há dois erros comuns em tutor educacional:

1. responder a uma pergunta ambígua como se ela fosse precisa
2. responder com confiança alta apesar de busca fraca ou cobertura insuficiente

Hoje a verificação existe mais como regra de prompt e avaliação offline. Falta uma decisão online explícita.

## Solução

Adicionar um nó `verify-or-followup` depois do `synthesize` para decidir entre:

- aceitar a resposta
- responder parcialmente
- pedir clarificação
- solicitar uma nova rodada curta de síntese

## Grafo

```js
START
  -> classify
  -> decide-teaching-mode
  -> synthesize
  -> verify-or-followup
  -> END
```

## Resultado esperado

O sistema deixa de “forçar resposta” em perguntas mal formuladas ou mal cobertas.

## Arquivos novos

### 1. `server/agent/workflow/verify-or-followup.js`

Nó responsável por consolidar sinais como:

- quantidade e diversidade de evidências recuperadas
- presença de citações de aula
- resposta excessivamente genérica
- modo `clarify`

Structured output sugerido:

```js
z.object({
  grounded: z.boolean(),
  sufficient: z.boolean(),
  needsClarification: z.boolean(),
  action: z.enum(["accept", "partial", "clarify", "retry_once"]),
  rationale: z.string(),
});
```

## Arquivos a modificar

### 2. `server/agent/workflow/index.js`

- adicionar `verification` ao state
- adicionar nó `verify-or-followup`
- criar aresta condicional para:
  - `END`
  - `clarify-response`
  - `retry-synthesize`

Observação: para evitar complexidade excessiva, permitir no máximo uma revisão extra.

### 3. `server/agent/workflow/synthesize-answer.js`

Expor no state o mínimo necessário para verificação:

- aulas citadas
- total de docs usados
- se houve tool calls de busca

### 4. `server/agent/chat.js`

Emitir step fixo `verify-or-followup`.

### 5. `web/script.js`

Mostrar quando a resposta foi:

- aceita
- marcada como parcial
- convertida em pedido de clarificação

## Exemplos de comportamento

### Caso 1: pergunta ambígua

Pergunta:
`onde isso aparece?`

Saída esperada:

```text
Posso te ajudar, mas preciso de um pouco mais de contexto: você quer saber em qual aula aparece qual conceito exatamente?
```

### Caso 2: cobertura fraca

Saída esperada:

```text
Com base no material recuperado, consigo responder apenas de forma parcial...
```

## Checklist de verificação

- [ ] O sistema não responde diretamente a perguntas ambíguas sem tentar clarificar
- [ ] Cobertura fraca pode virar resposta parcial
- [ ] Existe no máximo uma revisão adicional de síntese
- [ ] O resultado da verificação aparece no accordion
- [ ] O usuário percebe claramente quando a resposta foi parcial ou quando faltou contexto
