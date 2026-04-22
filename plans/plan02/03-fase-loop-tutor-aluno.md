# Fase 3 — Loop Tutor-Aluno

## Problema Atual

O chat ainda é majoritariamente pergunta -> resposta. Isso funciona para consulta, mas não caracteriza um tutor.

O ganho real de FSM aqui aparece quando o sistema:

1. faz uma pergunta ao aluno
2. espera resposta
3. avalia entendimento
4. decide o próximo passo

## Solução

Criar um fluxo explícito para interação pedagógica curta.

## Grafo sugerido

```js
START
  -> classify
  -> decide-teaching-mode
  -> synthesize
  -> verify-or-followup
  -> ask-student
  -> wait-student-answer
  -> assess-student-answer
  -> remediate-or-advance
  -> END
```

Na prática, `wait-student-answer` será modelado com estado persistido e retomada no próximo turno.

## Casos de uso cobertos

- “me explica e depois me faz uma pergunta para ver se eu entendi”
- “quero praticar esse conceito”
- “me dá um exercício curto”
- “corrige minha resposta”

## Arquivos novos

### 1. `server/agent/workflow/ask-student.js`

Gera uma pergunta curta, coerente com o que acabou de ser explicado.

Retorna:

- `waitingForStudent: true`
- `answer`: texto para o aluno

### 2. `server/agent/workflow/assess-student-answer.js`

Recebe a resposta do aluno e classifica como:

```js
z.enum(["correct", "partial", "misconception", "off_topic"])
```

Retorna também feedback curto.

### 3. `server/agent/workflow/remediate-or-advance.js`

Decide entre:

- avançar
- reforçar com outro exemplo
- corrigir o equívoco
- pedir reformulação

## Arquivos a modificar

### 4. `server/agent/workflow/index.js`

Adicionar:

- `waitingForStudent`
- `studentAnswer`
- `assessment`

Criar arestas condicionais com base em `pedagogicalMode` e `assessment.result`.

### 5. `server/index.js` e `server/agent/chat.js`

Adaptar a rota de chat para aceitar contexto de thread e distinguir:

- turno inicial
- turno de continuação

### 6. `web/script.js`

UI precisa mostrar claramente quando a mensagem do bot é uma pergunta pedagógica, não uma resposta final definitiva.

## Decisão de escopo

Nesta fase, limitar a um loop curto por turno de prática.

Não implementar ainda:

- trilhas longas de exercício
- múltiplos níveis de quiz
- banco de exercícios separado

## Checklist de verificação

- [ ] O sistema consegue perguntar algo ao aluno após explicar
- [ ] O próximo turno é interpretado como resposta do aluno quando aplicável
- [ ] A resposta do aluno é classificada em pelo menos 4 categorias
- [ ] O sistema remedia de forma diferente para `partial` e `misconception`
- [ ] O fluxo é visível no accordion
