export async function up(knex) {
  // SQLite FTS5 para busca lexical (BM25) nos chunks.
  // Tokenizer unicode61 com remoção de diacríticos para pt-BR.
  await knex.raw(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      lesson_id UNINDEXED,
      chunk_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  // Popular com dados existentes
  await knex.raw(`
    INSERT INTO chunks_fts(content, lesson_id, chunk_id)
    SELECT content, lesson_id, id FROM chunks;
  `);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS chunks_fts;`);
}
