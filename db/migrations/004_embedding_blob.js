/**
 * Fase 3.1 — Persistência de embeddings em BLOB.
 * Evita recalcular embeddings a cada restart do servidor.
 */
export async function up(knex) {
  await knex.schema.alterTable("chunks", (table) => {
    table.binary("embedding").nullable();
    table.integer("embedding_dim").nullable();
  });

  await knex.schema.alterTable("lessons", (table) => {
    table.binary("embedding").nullable();
    table.integer("embedding_dim").nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable("chunks", (table) => {
    table.dropColumn("embedding");
    table.dropColumn("embedding_dim");
  });

  await knex.schema.alterTable("lessons", (table) => {
    table.dropColumn("embedding");
    table.dropColumn("embedding_dim");
  });
}
