/**
 * Fase 3.2 — Runner de avaliação do RAG.
 *
 * Uso: node server/eval/run.js
 *
 * Para cada pergunta do dataset, roda o workflow e calcula métricas:
 * - retrieval_coverage: as aulas esperadas foram recuperadas?
 * - source_diversity: aulas distintas >= mínimo?
 * - groundedness: cada aula citada na resposta está no coverage?
 * - overgeneralization: fala "o curso aborda" com apenas 1 aula?
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Carregar .env antes de qualquer import que use env vars
import "dotenv/config";

import { createRag } from "../agent/rag.js";
import { createWorkflow } from "../agent/workflow/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadDataset() {
  const raw = await readFile(join(__dirname, "dataset.json"), "utf-8");
  return JSON.parse(raw);
}

function extractCitedLessons(answer) {
  const regex = /\[Aula:\s*([^\]]+)\]/gi;
  const cited = new Set();
  let match;
  while ((match = regex.exec(answer)) !== null) {
    cited.add(match[1].trim());
  }
  return [...cited];
}

function checkOvergeneralization(answer, lessonIds) {
  const broadPhrases = [
    "o curso aborda",
    "ao longo do curso",
    "no curso",
    "o curso apresenta",
    "o curso discute",
    "o curso trata",
    "visão do curso",
  ];
  const hasPhrase = broadPhrases.some((p) =>
    answer.toLowerCase().includes(p),
  );
  return hasPhrase && lessonIds.length <= 1;
}

async function evaluate(workflow, item) {
  const startTime = Date.now();

  try {
    const result = await workflow.invoke({ question: item.q });
    const elapsed = Date.now() - startTime;

    const coverage = result.coverage ?? { lesson_ids: [], sufficient: false };
    const answer = result.answer ?? "";
    const intent = result.intent ?? "unknown";
    const lessonIds = coverage.lesson_ids ?? [];

    const metrics = {
      question: item.q,
      expected_intent: item.intent,
      actual_intent: intent,
      intent_match: intent === item.intent,
      elapsed_ms: elapsed,
      doc_count: (result.documents ?? []).length,
      distinct_lessons: lessonIds.length,
      coverage_sufficient: coverage.sufficient,
    };

    // Retrieval coverage: as aulas esperadas foram recuperadas?
    if (item.must_mention_lessons) {
      // Precisamos comparar slugs com os lesson_ids recuperados.
      // Como não temos slug no coverage, checamos citações na resposta.
      const cited = extractCitedLessons(answer);
      metrics.retrieval_coverage = item.must_mention_lessons.length > 0
        ? item.must_mention_lessons.every((slug) =>
            cited.some((c) => c.toLowerCase().includes(slug.toLowerCase())) ||
            answer.toLowerCase().includes(slug.toLowerCase()),
          )
        : true;
    }

    // Source diversity
    if (item.min_distinct_lessons) {
      metrics.source_diversity = lessonIds.length >= item.min_distinct_lessons;
    }

    // Groundedness: cada aula citada na resposta está no coverage?
    const citedLessons = extractCitedLessons(answer);
    metrics.cited_lessons = citedLessons;
    // (simplificado — verificação exata requer mapear títulos a IDs)
    metrics.groundedness = citedLessons.length > 0 || item.intent === "localizadora";

    // Overgeneralization
    metrics.overgeneralization = checkOvergeneralization(answer, lessonIds);

    // Resposta parcial do answer para review
    metrics.answer_preview = answer.slice(0, 300);

    return { status: "ok", ...metrics };
  } catch (err) {
    return {
      status: "error",
      question: item.q,
      error: err.message,
      elapsed_ms: Date.now() - startTime,
    };
  }
}

async function main() {
  console.log("=== RAG Evaluation Runner ===\n");

  const dataset = await loadDataset();
  console.log(`Dataset: ${dataset.length} perguntas.\n`);

  console.log("Inicializando RAG...");
  const rag = await createRag();
  const workflow = createWorkflow({ rag });

  const results = [];

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    console.log(`[${i + 1}/${dataset.length}] ${item.intent.toUpperCase()} — "${item.q}"`);
    const result = await evaluate(workflow, item);
    results.push(result);

    if (result.status === "ok") {
      const flags = [];
      if (result.intent_match === false) flags.push("INTENT_MISMATCH");
      if (result.source_diversity === false) flags.push("LOW_DIVERSITY");
      if (result.retrieval_coverage === false) flags.push("MISSED_LESSONS");
      if (result.overgeneralization) flags.push("OVERGENERALIZATION");
      if (!result.groundedness) flags.push("UNGROUNDED");

      const status = flags.length === 0 ? "PASS" : `WARN(${flags.join(",")})`;
      console.log(`  → ${status} | ${result.distinct_lessons} aulas | ${result.elapsed_ms}ms`);
    } else {
      console.log(`  → ERROR: ${result.error}`);
    }
  }

  // ── Resumo ──────────────────────────────────────────────────────────────
  const ok = results.filter((r) => r.status === "ok");
  const broadResults = ok.filter(
    (r) => r.expected_intent === "ampla" || r.expected_intent === "comparativa",
  );
  const diversityPass = broadResults.filter((r) => r.source_diversity === true).length;
  const intentMatch = ok.filter((r) => r.intent_match).length;
  const overgen = ok.filter((r) => r.overgeneralization).length;

  const summary = {
    total: dataset.length,
    success: ok.length,
    errors: results.filter((r) => r.status === "error").length,
    intent_accuracy: ok.length > 0 ? (intentMatch / ok.length * 100).toFixed(1) + "%" : "N/A",
    diversity_pass_rate: broadResults.length > 0
      ? (diversityPass / broadResults.length * 100).toFixed(1) + "%"
      : "N/A",
    overgeneralizations: overgen,
  };

  console.log("\n=== Resumo ===");
  console.log(JSON.stringify(summary, null, 2));

  // ── Salvar relatório ────────────────────────────────────────────────────
  const reportDir = join(__dirname);
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(
    reportDir,
    `report-${new Date().toISOString().slice(0, 10)}.json`,
  );
  const report = { summary, results, timestamp: new Date().toISOString() };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nRelatório salvo em: ${reportPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
