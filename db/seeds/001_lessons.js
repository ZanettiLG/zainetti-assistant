import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import * as z from "zod";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { createNvidiaModel, createEmbeddingsModel } from "../../server/agent/models.js";
import {
  buildContextualChunk,
  getMessageText,
  parseStructuredOutput,
} from "../../server/agent/workflow/utils.js";

// ─── Embedding helpers ──────────────────────────────────────────────────────

function float32ToBuffer(vec) {
  return Buffer.from(new Float32Array(vec).buffer);
}

/**
 * Trunca texto para caber no limite de tokens do modelo de embeddings.
 * Estimativa conservadora: ~4 chars por token, limite 512 tokens → ~1800 chars.
 */
function truncateForEmbedding(text, maxChars = 1400) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

async function embedAndPersist(knex, embeddingsModel, table, id, text) {
  const truncated = truncateForEmbedding(text);
  const [vec] = await embeddingsModel.embedDocuments([truncated]);
  await knex(table)
    .where({ id })
    .update({
      embedding: float32ToBuffer(vec),
      embedding_dim: vec.length,
    });
  return vec;
}

const LessonMetaSchema = z.object({
  title: z.string().min(3),
  module: z.string().optional().nullable(),
  summary: z.string().min(50),
  topics: z.array(z.string()).min(3).max(15),
});

const lessonMetaPrompt = [
  "Você analisa o conteúdo de uma aula e extrai metadados estruturados.",
  "Responda SEMPRE em português brasileiro.",
  "Responda APENAS com JSON no formato:",
  '{"title":"...","module":"...","summary":"...","topics":["...","..."]}',
  "- title: título descritivo da aula (3 a 120 caracteres).",
  "- module: módulo/tema maior a que a aula pertence (se não houver, use uma categoria curta).",
  "- summary: resumo denso e informativo em 4 a 8 frases, cobrindo objetivos e conceitos.",
  "- topics: 5 a 12 tópicos/termos-chave curtos que representam o conteúdo.",
].join("\n");

async function generateLessonMeta(model, fullText) {
  const sample = fullText.slice(0, 12000); // limite defensivo de prompt
  const response = await model.invoke([
    { role: "system", content: lessonMetaPrompt },
    {
      role: "user",
      content: `Conteúdo da aula:\n"""\n${sample}\n"""`,
    },
  ]);
  const text = getMessageText(response);
  return parseStructuredOutput(text, LessonMetaSchema);
}

async function loadPdfs() {
  const pdfDir = "assets/pdf";
  const files = await readdir(pdfDir);
  return files
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => join(pdfDir, f));
}

export async function seed(knex) {
  const model = createNvidiaModel();
  const embeddingsModel = createEmbeddingsModel();
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const pdfFiles = await loadPdfs();
  console.log(`Found ${pdfFiles.length} PDF(s).`);

  let totalLessons = 0;
  let totalChunks = 0;

  for (const file of pdfFiles) {
    const slug = basename(file, ".pdf");

    const existing = await knex("lessons").where({ slug }).first();
    if (existing) {
      console.log(`Lesson "${slug}" já existe, pulando.`);
      continue;
    }

    console.log(`Carregando ${file}...`);
    const rawDocs = await new PDFLoader(file).load();
    const fullText = rawDocs.map((d) => d.pageContent).join("\n");

    console.log(`Gerando metadados para ${slug}...`);
    const meta = await generateLessonMeta(model, fullText);

    const [lessonId] = await knex("lessons").insert(
      {
        slug,
        title: meta.title,
        module: meta.module ?? null,
        summary: meta.summary,
        topics: JSON.stringify(meta.topics),
        source_file: file,
      },
      "id",
    );
    const resolvedLessonId =
      typeof lessonId === "object" ? lessonId.id : lessonId;
    totalLessons += 1;
    console.log(`Aula criada: [${resolvedLessonId}] ${meta.title}`);

    // Embedding da aula (resumo + tópicos)
    const lessonText = `${meta.title}. ${meta.summary} Tópicos: ${meta.topics.join(", ")}`;
    await embedAndPersist(knex, embeddingsModel, "lessons", resolvedLessonId, lessonText);
    console.log(`  Embedding da aula persistido.`);

    const chunks = await splitter.splitDocuments(rawDocs);
    const rows = [];
    for (let i = 0; i < chunks.length; i++) {
      const raw = chunks[i].pageContent;
      const contextual = buildContextualChunk({ lesson: meta, content: raw });
      const hash = createHash("md5").update(contextual).digest("hex");

      rows.push({
        lesson_id: resolvedLessonId,
        title: `${meta.title} — chunk ${i + 1}`,
        content: contextual,
        source_file: file,
        chunk_hash: hash,
        chunk_index: i,
      });
    }

    if (rows.length > 0) {
      // Insere em lotes para evitar estouro de parâmetros do SQLite
      const batchSize = 50;
      for (let i = 0; i < rows.length; i += batchSize) {
        await knex("chunks").insert(rows.slice(i, i + batchSize));
      }
      totalChunks += rows.length;
      console.log(`  ${rows.length} chunks inseridos.`);

      // Computar e persistir embeddings dos chunks
      console.log(`  Computando embeddings dos chunks...`);
      const allChunkRows = await knex("chunks")
        .where({ lesson_id: resolvedLessonId })
        .select("id", "content");

      // Embed em lotes para performance
      const embBatchSize = 20;
      for (let i = 0; i < allChunkRows.length; i += embBatchSize) {
        const batch = allChunkRows.slice(i, i + embBatchSize);
        const texts = batch.map((r) => {
          // Usar conteúdo original (sem prefixo contextual) para embedding
          const sep = "\n\n";
          const idx = r.content.indexOf(sep, r.content.indexOf("[Resumo da aula:"));
          const original = idx === -1 ? r.content : r.content.slice(idx + sep.length);
          return truncateForEmbedding(original);
        });
        const vecs = await embeddingsModel.embedDocuments(texts);
        for (let j = 0; j < batch.length; j++) {
          await knex("chunks")
            .where({ id: batch[j].id })
            .update({
              embedding: float32ToBuffer(vecs[j]),
              embedding_dim: vecs[j].length,
            });
        }
      }
      console.log(`  Embeddings dos chunks persistidos.`);
    }
  }

  console.log(
    `Seed concluído: ${totalLessons} aula(s), ${totalChunks} chunk(s).`,
  );
  return { status: "ok", lessons: totalLessons, chunks: totalChunks };
}
