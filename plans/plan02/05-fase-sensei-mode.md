# Fase 5 — Sensei Mode

## Problema Atual

Responder com outra pergunta só vale pedagogicamente quando existe progressão controlada. Sem estado, isso vira apenas estilo textual.

O “sensei mode” precisa decidir:

1. o que o aluno já sabe
2. qual a próxima pergunta útil
3. quando insistir
4. quando dar pista
5. quando revelar parcialmente a resposta

## Solução

Modelar o modo socrático como subgrafo ou fluxo especializado, reutilizando memória e avaliação do aluno.

## Fluxo sugerido

```js
START
  -> classify
  -> decide-teaching-mode
  -> socratic-subgraph
  -> update-memory
  -> END
```

## Subgrafo socrático

```js
ask-guiding-question
  -> wait-student-answer
  -> assess-student-answer
  -> branch:
       - next-guiding-question
       - give-hint
       - partial-reveal
       - conclude
```

## Arquivos novos

### 1. `server/agent/workflow/socratic-subgraph.js`

Subgrafo responsável por:

- formular perguntas-guia
- não entregar cedo demais a resposta
- dar pistas graduais
- encerrar quando o aluno chegou perto o suficiente

### 2. `server/agent/workflow/give-hint.js`

Nó para oferecer pista curta e incremental.

### 3. `server/agent/workflow/partial-reveal.js`

Nó para revelar apenas a parte necessária quando o aluno travou.

## Arquivos a modificar

### 4. `server/agent/workflow/decide-teaching-mode.js`

Detectar pedidos explícitos como:

- “não me fale a resposta”
- “me guia”
- “quero pensar sozinho”
- “sensei mode”

### 5. `web/script.js`

Dar destaque visual quando a resposta atual é uma pergunta socrática e não uma resposta final.

## Regras de produto

- no máximo algumas iterações antes de oferecer pista mais clara
- evitar frustrar o aluno com perguntas vagas demais
- manter a progressão sempre ligada ao contexto real da dúvida

## Checklist de verificação

- [ ] O modo socrático não entrega a resposta cedo demais
- [ ] O sistema faz perguntas progressivas, não aleatórias
- [ ] Há diferença clara entre pergunta-guia e pista
- [ ] O aluno pode sair do sensei mode e voltar ao modo direto
- [ ] A memória da sessão influencia a progressão socrática
