# Fase 4 — Memória e Progresso

## Problema Atual

Sem memória de sessão, o tutor não sustenta continuidade real.

Problemas típicos sem isso:

- repetir a mesma explicação
- esquecer o conceito ativo
- perder preferência do aluno
- não saber se a próxima mensagem é dúvida nova ou continuação

## Solução

Introduzir memória curta por thread e resumo de progresso do aluno.

Esta é a fase em que LangGraph começa a entregar valor forte de estado persistido.

## Componentes

### 1. Checkpointer por thread

Compilar o grafo com checkpointer e usar `thread_id` por sessão de chat.

### 2. Resumo de conversa

Criar ou atualizar um `conversationSummary` para manter contexto sem crescer indefinidamente.

### 3. Perfil do aluno

Guardar em estado/store sinais como:

- tópicos já trabalhados
- dificuldades recorrentes
- preferência por exemplo ou analogia
- último modo pedagógico útil

## Arquivos novos

### 1. `server/agent/workflow/update-memory.js`

Responsável por consolidar, ao fim do turno:

- resumo da conversa
- progresso percebido
- preferências do aluno

## Arquivos a modificar

### 2. `server/agent/index.js`

Compilar o workflow com checkpointer.

### 3. `server/agent/chat.js`

Receber e repassar `thread_id`.

### 4. `web/script.js`

Persistir `threadId` no navegador e enviá-lo a cada turno.

### 5. `server/agent/workflow/index.js`

Adicionar `update-memory` perto do fim do fluxo.

## Decisão de persistência

Começar com memória curta e simples.

Opção inicial aceitável:

- checkpointer em memória para desenvolvimento

Opção recomendada para evolução:

- backend persistente para threads

## Checklist de verificação

- [ ] Conversas da mesma sessão mantêm contexto entre turnos
- [ ] O sistema reconhece continuidade sem o aluno repetir tudo
- [ ] `thread_id` é estável na mesma sessão do navegador
- [ ] O resumo da conversa evita crescimento descontrolado de contexto
- [ ] Preferências e dificuldades do aluno começam a influenciar a resposta
