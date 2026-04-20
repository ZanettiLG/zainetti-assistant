# Plano de Melhoria do RAG — Aula 04

> Contexto: o chatbot atual funciona como **RAG ingênuo** (pergunta → embedding → top-K chunks → LLM). Funciona para perguntas pontuais, mas alucina em perguntas amplas (ex.: "como o curso aborda X?") porque responde a síntese global com retrieval local. Este documento detalha as mudanças arquiteturais em 3 fases, com diffs conceituais arquivo-por-arquivo.

---

## Sumário executivo

| Fase | Objetivo | Esforço | Ganho esperado |
|---|---|---|---|
| **1 — MVP anti-alucinação** | Aulas como entidade, chunks contextualizados, roteamento por intenção, prompt com cobertura e citação | Médio | Resolve ~80% das alucinações em perguntas amplas |
| **2 — Qualidade de retrieval** | Retrieval hierárquico (aula → chunk), busca híbrida (vetor + BM25), consolidação por subconsulta | Médio-alto | Melhora precisão e recall, reduz dependência de uma só aula |
| **3 — Sustentação** | Persistência de embeddings, dataset de avaliação, rota otimizada para corpus pequeno | Médio | Custo/latência menor, qualidade mensurável |

### Correções rápidas fora das fases (fazer antes da Fase 1)

- `server/agent/workflow/index.js:22` — `queryTopics: RewriteQuerySchema` está usando o schema do **objeto inteiro** como schema do campo. Trocar por `z.array(z.string()).default([])`.
- `db/seeds/001_lessons.js:50` — `title: "Chunk N"` é lixo; será reescrito na Fase 1, mas se precisar algo imediato, derivar de `basename(source_file)`.

---

## Diagnóstico do estado atual

**Indexação** — `db/seeds/001_lessons.js`: 3 PDFs (`assets/pdf/langchain0{1,2,3}.pdf`) são chunkados com `RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 })` e inseridos em `lessons (content, source_file, chunk_hash, chunk_index)`. Sem título real, sem módulo, sem resumo, sem tópicos.

**Retrieval** — `server/agent/rag.js`: na subida carrega todos os chunks e monta um `MemoryVectorStore` em RAM com embeddings `nvidia/nv-embedqa-e5-v5`. `retrieveDocuments(query, topK=5)` é `similaritySearch` puro. Sem filtro por aula, sem BM25, sem rerank.

**Workflow LangGraph** — `server/agent/workflow/index.js`: três nós lineares `rewrite → retrieve → synthesize`.
- `rewrite-query.js` decompõe a pergunta em `queryTopics[]` (bom — embrião de decomposição).
- `retrieve-docs.js` faz `Promise.all(queryTopics.map(searchTopic))` e depois `.flat()`. Perde rastro de qual chunk veio de qual tópico e de qual aula.
- `synthesize-answer.js` injeta `JSON.stringify(state.documents)` no prompt. Não exige citação, não aplica política de cobertura, não estrutura abstenção.

**Conceito ausente**: não existe "aula" como entidade. `lessons` guarda chunks. Isso contamina a mentalidade do código.

---

# Fase 1 — MVP anti-alucinação

**Meta**: parar de tratar toda pergunta como "vetorial + resposta" e garantir que respostas amplas se apoiem em múltiplas aulas com citações.

## 1.1 Modelar "aula" como entidade de primeira classe

### Nova migration: `db/migrations/002_create_courses_and_rename_lessons.js`

Renomeia a tabela atual `lessons` (que guarda chunks) para `chunks` e cria `lessons` de verdade.

```js
export async function up(knex) {
  // Renomear a tabela de chunks
  await knex.schema.renameTable("lessons", "chunks");

  // Nova tabela de aulas (lessons)
  await knex.schema.createTable("lessons", (table) => {
    table.increments("id").primary();
    table.string("slug").notNullable().unique();          // ex: "langchain01"
    table.string("title").notNullable();                  // ex: "Introdução ao LangChain"
    table.string("module").nullable();                    // ex: "Fundamentos"
    table.text("summary").notNullable();                  // resumo gerado por LLM
    table.json("topics").notNullable();                   // ["embeddings", "retrievers", ...]
    table.string("source_file").notNullable();
    table.timestamps(true, true);
  });

  // Adicionar FK em chunks
  await knex.schema.alterTable("chunks", (table) => {
    table.integer("lesson_id").references("id").inTable("lessons").onDelete("CASCADE");
    table.string("section").nullable();                   // seção derivada (opcional)
  });
}

export async function down(knex) {
  await knex.schema.alterTable("chunks", (t) => t.dropColumn("lesson_id").dropColumn("section"));
  await knex.schema.dropTable("lessons");
  await knex.schema.renameTable("chunks", "lessons");
}
```

### Nova seed: `db/seeds/001_lessons.js` (reescrita)

Fluxo:

1. Para cada PDF em `assets/pdf/`:
   1. Ler conteúdo inteiro (via `PDFLoader`).
   2. Chamar LLM para gerar `{ title, module, summary, topics[] }`.
   3. Inserir linha em `lessons`.
   4. Chunkar o conteúdo (mesmo splitter atual).
   5. Para cada chunk, **enriquecer** o `pageContent` com prefixo contextual (ver 1.2) e inserir em `chunks` com `lesson_id`.

Pseudocódigo:

```js
for (const file of pdfFiles) {
  const rawDocs = await new PDFLoader(file).load();
  const fullText = rawDocs.map(d => d.pageContent).join("\n");

  const meta = await summarizeLessonLLM(fullText); // structured output: {title, module, summary, topics}
  const [{ id: lessonId }] = await knex("lessons").insert({
    slug: basename(file, ".pdf"),
    title: meta.title,
    module: meta.module,
    summary: meta.summary,
    topics: JSON.stringify(meta.topics),
    source_file: file,
  }).returning("id");

  const chunks = await splitter.splitDocuments(rawDocs);
  for (const [i, chunk] of chunks.entries()) {
    const contextualContent = buildContextualChunk({ lesson: meta, chunk: chunk.pageContent });
    await knex("chunks").insert({
      lesson_id: lessonId,
      title: `${meta.title} — chunk ${i + 1}`,
      content: contextualContent,
      source_file: file,
      chunk_hash: md5(chunk.pageContent),
      chunk_index: i,
    });
  }
}
```

`summarizeLessonLLM` usa `createNvidiaModel(LessonMetaSchema)` com `withStructuredOutput`:

```js
const LessonMetaSchema = z.object({
  title: z.string(),
  module: z.string().optional(),
  summary: z.string().max(1500),
  topics: z.array(z.string()).min(3).max(15),
});
```

**Critério de aceite**: `SELECT title, module, json_extract(topics,'$') FROM lessons;` retorna 3 linhas, uma por PDF, com resumo coerente.

## 1.2 Enriquecer chunk com contexto (Contextual Retrieval)

Helper novo em `server/agent/workflow/utils.js` (ou arquivo próprio):

```js
export function buildContextualChunk({ lesson, chunk }) {
  return [
    `[Módulo: ${lesson.module ?? "-"}]`,
    `[Aula: ${lesson.title}]`,
    `[Tópicos da aula: ${lesson.topics.join(", ")}]`,
    `[Resumo da aula: ${lesson.summary}]`,
    ``,
    chunk,
  ].join("\n");
}
```

O texto enriquecido é o que vai para embedding **e** é o que o LLM vê na síntese. Isso reduz a chance de um chunk isolado ser interpretado fora de contexto e dá ao modelo a informação de qual aula ele está lendo — essencial para citação.

**Critério de aceite**: `SELECT content FROM chunks LIMIT 1;` começa com `[Módulo: ...]` e contém o resumo da aula.

## 1.3 Rag com metadata completa

### `server/agent/rag.js` (alterações)

```js
async function initVectorStore() {
  if (rag.vectorStore) return rag.vectorStore;

  const rows = await db("chunks as c")
    .join("lessons as l", "l.id", "c.lesson_id")
    .select(
      "c.content",
      "c.chunk_index",
      "c.source_file",
      "l.id as lesson_id",
      "l.slug as lesson_slug",
      "l.title as lesson_title",
      "l.module as lesson_module",
    );

  rag.vectorStore = new MemoryVectorStore(rag.model);
  const docs = rows.map((r) => ({
    pageContent: r.content,
    metadata: {
      lesson_id: r.lesson_id,
      lesson_slug: r.lesson_slug,
      lesson_title: r.lesson_title,
      lesson_module: r.lesson_module,
      chunk_index: r.chunk_index,
      source: r.source_file,
    },
  }));
  await rag.vectorStore.addDocuments(docs);
  return rag.vectorStore;
}
```

`retrieveDocuments` passa a retornar `Document[]` **com metadata preservada** (já fazia, mas agora tem metadata útil). Não achatar mais para strings em lugar nenhum.

**Critério de aceite**: `retrieveDocuments("o que é embedding")[0].metadata.lesson_title` é uma string não vazia.

## 1.4 Classificador de intenção

### Novo nó: `server/agent/workflow/classify-intent.js`

```js
import * as z from "zod";
import { getWriter } from "@langchain/langgraph";

export const IntentSchema = z.object({
  intent: z.enum(["pontual", "ampla", "comparativa", "localizadora"]),
  rationale: z.string(),
});

const prompt = [
  "Classifique a intenção da pergunta do aluno em uma das categorias:",
  "- pontual: busca uma definição ou fato específico (ex.: 'o que é embedding?').",
  "- ampla: pede síntese global sobre um tema do curso (ex.: 'como o curso aborda X?').",
  "- comparativa: pede comparar abordagens/tópicos (ex.: 'diferença entre A e B nas aulas').",
  "- localizadora: pergunta em qual aula/seção algo aparece.",
  "Responda APENAS com JSON: {\"intent\": \"...\", \"rationale\": \"...\"}.",
].join("\n");

export default ({ model }) => async (state) => {
  const writer = getWriter();
  writer({ step: "classify", status: "running", message: "Classificando intenção..." });

  const res = await model.invoke([
    { role: "system", content: prompt },
    { role: "user", content: state.question },
  ]);
  const { intent, rationale } = parseStructuredOutput(getMessageText(res), IntentSchema);

  writer({ step: "classify", status: "done", data: { intent, rationale } });
  return { intent };
};
```

### Alterações em `server/agent/workflow/index.js`

```js
const WorkflowState = new StateSchema({
  question: z.string(),
  intent: z.enum(["pontual", "ampla", "comparativa", "localizadora"]).optional(),
  queryTopics: z.array(z.string()).default([]),       // corrigido
  documents: z.array(z.any()).default([]),            // agora Document[], com metadata
  coverage: z.object({
    lesson_ids: z.array(z.number()),
    sufficient: z.boolean(),
  }).optional(),
  answer: z.string().optional(),
});

const workflow = new StateGraph(WorkflowState)
  .addNode("classify", classifyIntent, { retryPolicy })
  .addNode("rewrite", rewriteQuery, { retryPolicy })
  .addNode("retrieve", retrieveDocs, { retryPolicy })
  .addNode("synthesize", synthesizeAnswer, { retryPolicy })
  .addEdge(START, "classify")
  .addConditionalEdges("classify", (s) =>
    s.intent === "pontual" ? "retrieve" : "rewrite"
  )
  .addEdge("rewrite", "retrieve")
  .addEdge("retrieve", "synthesize")
  .addEdge("synthesize", END)
  .compile();
```

Observação: na Fase 1, perguntas `pontual` pulam a decomposição e vão direto ao retrieve com `queryTopics = [question]` (setar default no próprio retrieve node quando vazio).

**Critério de aceite**: `workflow.invoke({ question: "o que é embedding" })` passa por `classify → retrieve → synthesize`; `workflow.invoke({ question: "como o curso aborda autenticação" })` passa por `classify → rewrite → retrieve → synthesize`.

## 1.5 Retrieve com consolidação por subconsulta + política de cobertura

### `server/agent/workflow/retrieve-docs.js` (reescrita)

Mudanças-chave: **não achatar** e **calcular cobertura de aulas**.

```js
export default ({ rag }) => async (state) => {
  const writer = getWriter();
  const queries = state.queryTopics.length ? state.queryTopics : [state.question];

  writer({ step: "retrieve", status: "running", message: `Buscando em ${queries.length} tópicos...` });

  const groups = await Promise.all(
    queries.map(async (q) => {
      const docs = await rag.retrieveDocuments(q, 5);
      return { query: q, docs };
    }),
  );

  // Aula -> lista de chunks (para diversidade)
  const allDocs = groups.flatMap((g) => g.docs);
  const lessonIds = [...new Set(allDocs.map((d) => d.metadata.lesson_id))];

  // Política: para intent "ampla"/"comparativa", limitar a no máx. 2 chunks por aula
  let finalDocs = allDocs;
  if (state.intent === "ampla" || state.intent === "comparativa") {
    const perLesson = new Map();
    finalDocs = [];
    for (const d of allDocs) {
      const k = d.metadata.lesson_id;
      const count = perLesson.get(k) ?? 0;
      if (count < 2) {
        finalDocs.push(d);
        perLesson.set(k, count + 1);
      }
    }
  }

  const sufficient =
    state.intent === "ampla" || state.intent === "comparativa"
      ? lessonIds.length >= 2
      : allDocs.length > 0;

  writer({
    step: "retrieve",
    status: "done",
    data: { lessons: lessonIds.length, docs: finalDocs.length, sufficient },
  });

  return {
    documents: finalDocs,
    coverage: { lesson_ids: lessonIds, sufficient },
  };
};
```

**Critério de aceite**: para uma pergunta ampla, `coverage.lesson_ids.length >= 2` na maior parte dos casos; quando menor, `coverage.sufficient === false`.

## 1.6 Synthesize com citação, scaffold e abstenção

### `server/agent/workflow/synthesize-answer.js` (reescrita)

```js
const systemRules = [
  "Responda SEMPRE em português brasileiro.",
  "Responda APENAS com base nos trechos recuperados. Não extrapole.",
  "Cite explicitamente as aulas que sustentam cada afirmação no formato [Aula: <título>].",
  "Se a pergunta for ampla ou comparativa:",
  "  - baseie-se em pelo menos 2 aulas distintas;",
  "  - se a cobertura for insuficiente, diga explicitamente e responda apenas de forma parcial;",
  "  - não apresente um tema como 'visão do curso' se ele aparece em uma só aula.",
  "Estruture internamente antes de responder (não precisa mostrar ao aluno):",
  "  1. aulas usadas,",
  "  2. pontos em comum,",
  "  3. pontos exclusivos de cada aula,",
  "  4. lacunas.",
  "A resposta final ao aluno deve ser fluida, gentil e citar as aulas.",
];

export default ({ model }) => async (state) => {
  const writer = getWriter();
  writer({ step: "synthesize", status: "running", message: "Sintetizando resposta..." });

  const segments = state.documents.map((d, i) => ({
    idx: i + 1,
    lesson: d.metadata.lesson_title,
    module: d.metadata.lesson_module,
    content: d.pageContent,
  }));

  const context = [
    `intent: ${state.intent}`,
    `coverage: ${state.coverage?.sufficient ? "suficiente" : "insuficiente"} ` +
      `(aulas distintas: ${state.coverage?.lesson_ids.length ?? 0})`,
    `question: """${state.question}"""`,
    `retrieved_segments:\n${segments
      .map((s) => `#${s.idx} [Aula: ${s.lesson} | Módulo: ${s.module ?? "-"}]\n${s.content}`)
      .join("\n\n")}`,
  ].join("\n");

  const response = await model.invoke([
    { role: "system", content: joinContext([prompt, joinRules(systemRules)]) },
    { role: "user", content: context },
  ]);

  return { answer: getMessageText(response) };
};
```

**Critério de aceite**: resposta a pergunta ampla contém ao menos uma marcação `[Aula: ...]`. Quando `coverage.sufficient === false`, o modelo verbaliza que a cobertura é parcial.

## 1.7 Checklist da Fase 1

- [ ] Corrigir `queryTopics: RewriteQuerySchema` em `workflow/index.js:22`.
- [ ] Nova migration `002_create_courses_and_rename_lessons.js`.
- [ ] Seed reescrita gerando `lessons` + `chunks` com prefixo contextual.
- [ ] `rag.js` passando metadata completa.
- [ ] Novo nó `classify-intent.js`.
- [ ] `retrieve-docs.js` sem `.flat()`, com política de diversidade e `coverage`.
- [ ] `synthesize-answer.js` com citação, scaffold e abstenção.
- [ ] `WorkflowState` atualizado; edges condicionais.
- [ ] Teste manual: 1 pergunta pontual + 1 ampla + 1 comparativa; comparar antes/depois.

---

# Fase 2 — Qualidade de retrieval

**Meta**: aumentar precisão/recall com retrieval hierárquico e busca híbrida, e fazer a síntese enxergar a estrutura por subconsulta.

## 2.1 Índice de aulas (retrieval hierárquico)

### `server/agent/rag.js` (adições)

Dois vector stores:

- `rag.lessonStore` — embeddings dos resumos de aula (`title + summary + topics`).
- `rag.chunkStore` — embeddings dos chunks (já existe, renomear).

Novos métodos:

```js
rag.retrieveLessons = async (query, topN = 3) =>
  rag.lessonStore.similaritySearch(query, topN);

rag.retrieveChunksInLessons = async (query, lessonIds, topK = 3) => {
  // Filtrar por metadata.lesson_id ∈ lessonIds e ordenar por score
  const all = await rag.chunkStore.similaritySearchWithScore(query, 50);
  return all
    .filter(([doc]) => lessonIds.includes(doc.metadata.lesson_id))
    .slice(0, topK * lessonIds.length)
    .map(([doc]) => doc);
};
```

### `retrieve-docs.js` (bifurcação por intent)

```js
if (state.intent === "ampla" || state.intent === "comparativa") {
  const lessons = await rag.retrieveLessons(state.question, 3);
  const lessonIds = lessons.map((l) => l.metadata.lesson_id);

  const docs = (
    await Promise.all(
      state.queryTopics.map((q) =>
        rag.retrieveChunksInLessons(q, lessonIds, 3),
      ),
    )
  ).flat();
  // ... cobertura igual à Fase 1
}
```

**Critério de aceite**: para perguntas amplas, `coverage.lesson_ids` tende a vir com pelo menos 2–3 aulas diferentes, sem uma aula dominando.

## 2.2 Busca híbrida (vetor + BM25)

Usar SQLite FTS5 (nativo) em vez de dependência externa.

### Nova migration: `003_chunks_fts.js`

```js
export async function up(knex) {
  await knex.raw(`
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      content, lesson_id UNINDEXED, chunk_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  await knex.raw(`
    INSERT INTO chunks_fts(content, lesson_id, chunk_id)
    SELECT content, lesson_id, id FROM chunks;
  `);
}
export async function down(knex) {
  await knex.raw(`DROP TABLE chunks_fts;`);
}
```

Seed deve atualizar `chunks_fts` após inserir em `chunks`.

### `rag.js`

```js
rag.retrieveBM25 = async (query, topK = 20) => {
  const rows = await db.raw(
    `SELECT chunk_id, lesson_id, content, bm25(chunks_fts) AS score
     FROM chunks_fts WHERE chunks_fts MATCH ?
     ORDER BY score LIMIT ?`,
    [query, topK],
  );
  return rows.map((r) => ({
    pageContent: r.content,
    metadata: { lesson_id: r.lesson_id, chunk_id: r.chunk_id, score: r.score },
  }));
};

rag.retrieveHybrid = async (query, { topK = 8 } = {}) => {
  const [vec, bm] = await Promise.all([
    rag.chunkStore.similaritySearch(query, 20),
    rag.retrieveBM25(query, 20),
  ]);
  return mergeAndRerank(vec, bm, topK); // Reciprocal Rank Fusion (RRF)
};
```

`mergeAndRerank` — RRF simples (sem rerank externo):

```js
function mergeAndRerank(vec, bm, topK) {
  const k = 60;
  const score = new Map();
  vec.forEach((d, i) => score.set(keyOf(d), (score.get(keyOf(d)) ?? 0) + 1 / (k + i)));
  bm.forEach((d, i) => score.set(keyOf(d), (score.get(keyOf(d)) ?? 0) + 1 / (k + i)));
  const all = new Map([...vec, ...bm].map((d) => [keyOf(d), d]));
  return [...score.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, topK)
    .map(([k]) => all.get(k));
}
```

**Critério de aceite**: para queries com termos exatos (ex.: nome de classe/método citado no PDF), BM25 traz resultados que o vetorial sozinho não trazia.

## 2.3 Rerank por LLM (opcional, quando custo permitir)

Após o merge, top-20 → LLM rankeia relevância de cada trecho em relação à pergunta, devolve `[{ idx, score }]` e ficamos com top-8.

Implementação incremental; esqueleto em `server/agent/workflow/rerank.js`.

## 2.4 Consolidação estruturada na síntese

Em `synthesize-answer.js`, em vez de lista plana, passar estrutura por subconsulta:

```js
const byTopic = state.queryTopics.map((q) => ({
  query: q,
  docs: state.documents.filter((d) => d.metadata._origin_query === q),
}));
```

E o prompt agora diz: "para cada subpergunta, liste o que os trechos dizem, e só depois faça a síntese".

**Critério de aceite**: resposta a pergunta ampla mostra organização por subtema e não um blob único.

## 2.5 Checklist da Fase 2

- [ ] `lessonStore` + indexação de resumos.
- [ ] `retrieveChunksInLessons` filtrando por `lesson_id`.
- [ ] Migration FTS5 e `retrieveBM25`.
- [ ] `retrieveHybrid` com RRF.
- [ ] (Opcional) rerank por LLM.
- [ ] Synthesize com agrupamento por subconsulta.

---

# Fase 3 — Sustentação

**Meta**: tornar o sistema barato de rodar, mensurável e usar corpus pequeno a nosso favor.

## 3.1 Persistência de embeddings

Hoje `MemoryVectorStore` refaz tudo a cada restart. Duas opções:

**Opção A (recomendada, baixo custo)**: guardar vetor em `chunks.embedding BLOB` e montar `MemoryVectorStore` a partir disso.

Nova migration:

```js
await knex.schema.alterTable("chunks", (t) => {
  t.binary("embedding");
  t.integer("embedding_dim");
});
await knex.schema.alterTable("lessons", (t) => {
  t.binary("embedding");
});
```

Seed calcula embedding uma vez, salva como `Buffer.from(Float32Array(vec).buffer)`. `rag.js` lê e popula o store sem chamar a API.

**Opção B**: `sqlite-vec` (extensão nativa) para busca vetorial dentro do próprio SQLite. Mais trabalho de setup, mas remove o `MemoryVectorStore`.

**Critério de aceite**: restart do servidor não faz nenhuma chamada a `embeddings.create`.

## 3.2 Dataset de avaliação

### `server/eval/dataset.json`

```json
[
  { "q": "O que é embedding?", "intent": "pontual", "must_mention_lessons": ["langchain01"] },
  { "q": "Como o curso aborda retrievers?", "intent": "ampla", "min_distinct_lessons": 2 },
  { "q": "Compare as abordagens de retrieval vistas nas aulas", "intent": "comparativa", "min_distinct_lessons": 2 },
  { "q": "Em qual aula se fala de LangGraph?", "intent": "localizadora" }
]
```

### `server/eval/run.js`

Para cada item:

1. Rodar o workflow.
2. Coletar `coverage`, `documents`, `answer`.
3. Calcular:
   - **retrieval coverage**: `coverage.lesson_ids` contém todas de `must_mention_lessons`?
   - **source diversity**: `coverage.lesson_ids.length >= min_distinct_lessons`?
   - **groundedness** (simplificado): cada aula citada na resposta está em `coverage.lesson_ids`?
   - **overgeneralization**: regex na resposta por frases como "o curso aborda" vs. `lesson_ids.length === 1`.
4. Exportar relatório `eval/report-<date>.json`.

**Critério de aceite**: rodar `node server/eval/run.js` gera um relatório com métricas; patamar alvo: diversity ≥ 2 em 80% das perguntas amplas.

## 3.3 Rota "corpus pequeno"

Com apenas 3 PDFs, uma pergunta ampla pode se beneficiar de mandar **todos os resumos de aula** + top chunks ao LLM, em vez de RAG puro. Contexto estimado: 3 resumos × ~1500 chars + 10 chunks × ~1500 chars ≈ ~20k chars → cabe folgado.

Novo nó `broad-context.js` ativado quando `intent === "ampla"` e `total_lessons <= N` (ex.: N=10):

```js
const lessons = await db("lessons").select("title", "module", "summary", "topics");
const topChunks = await rag.retrieveHybrid(state.question, { topK: 8 });

return {
  documents: topChunks,
  lessonsOverview: lessons, // novo campo no state
};
```

Synthesize usa `lessonsOverview` como "mapa do curso" e `documents` como evidência pontual.

**Critério de aceite**: em respostas amplas, a síntese referencia tanto o mapa geral quanto trechos específicos.

## 3.4 Checklist da Fase 3

- [ ] Embeddings persistidos em BLOB (ou `sqlite-vec`).
- [ ] `server/eval/dataset.json` com ≥ 10 perguntas cobrindo os 4 intents.
- [ ] `server/eval/run.js` gerando relatório.
- [ ] Rota corpus-pequeno para perguntas amplas quando `total_lessons <= N`.
- [ ] Métricas-alvo definidas no README.

---

# Referências

- LangChain Docs — Retrieval: <https://docs.langchain.com/oss/python/langchain/retrieval>
- Anthropic — Contextual Retrieval: <https://www.anthropic.com/news/contextual-retrieval>
- LangChain Docs — Evaluate a RAG application: <https://docs.langchain.com/langsmith/evaluate-rag-tutorial>

---

# Resumo em uma frase

Hoje o chatbot usa **retrieval local para responder perguntas globais**; este plano troca isso por um pipeline que **classifica a intenção, recupera em dois níveis, busca híbrido, e sintetiza com citação e política de cobertura** — medido por dataset — com o mínimo possível de novas dependências.
