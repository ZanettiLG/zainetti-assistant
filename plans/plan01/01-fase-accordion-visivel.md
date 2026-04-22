# Fase 1 — Fix: Acórdão Visível

## Problema
O accordion "Raciocínio do modelo" some da tela quando a resposta final começa a ser gerada. A causa raiz é a ordem dos elementos no DOM em `createBotMessage()`: `.bot-answer` vem antes de `.bot-workflow`. Conforme a resposta é renderizada e cresce dentro de `.bot-answer`, o acórdão é empurrado para fora da área visível do chat.

## Solução
Inverter a ordem no DOM: `.bot-workflow` antes de `.bot-answer`, para que o acórdão fique visível no topo da bolha enquanto a resposta é gerada abaixo dele.

## Arquivos a modificar

### 1. `web/script.js` — `createBotMessage()` (linha ~128)

**Antes** (ordem atual):
```html
<div class="message__bubble">
  <div class="bot-answer"></div>
  <div class="bot-thinking">...</div>
  <div class="bot-workflow"></div>
</div>
```

**Depois**:
```html
<div class="message__bubble">
  <div class="bot-workflow"></div>
  <div class="bot-thinking">...</div>
  <div class="bot-answer"></div>
</div>
```

Garantir que cada div tenha `display: block` e que o CSS não dependa da ordem para alinhamento.

### 2. `web/style.css`

Verificar/adicionar:
- `.bot-workflow` não deve ter `display: none` em nenhum estado
- Espaçamento entre `.bot-workflow` e `.bot-answer` com `margin-top` ou `padding-top` adequado
- Garantir que o accordion não sofra overflow inesperado (confirmar que `overflow: visible`)

## Checklist de verificação
- [ ] Ao enviar mensagem, o accordion "Raciocínio do modelo" permanece visível no topo
- [ ] Ao chegar a resposta final, o accordion não é empurrado para fora do viewport
- [ ] A resposta final aparece abaixo do accordion
- [ ] O indicador "pensando..." continua aparecendo durante o processamento
- [ ] O scroll funciona corretamente com o accordion visível
