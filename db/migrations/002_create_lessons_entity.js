export async function up(knex) {
  // A tabela atual "lessons" na verdade guarda chunks.
  // Renomear para "chunks" e criar "lessons" como entidade real.
  await knex.schema.renameTable("lessons", "chunks");

  // Zerar chunks antigos: como a nova estrutura exige lesson_id,
  // vamos reconstruir via seed a partir dos PDFs.
  await knex("chunks").del();

  await knex.schema.createTable("lessons", (table) => {
    table.increments("id").primary();
    table.string("slug").notNullable().unique();
    table.string("title").notNullable();
    table.string("module").nullable();
    table.text("summary").notNullable();
    table.text("topics").notNullable(); // JSON string (SQLite não tem JSON nativo estrito)
    table.string("source_file").notNullable();
    table.timestamps(true, true);
  });

  await knex.schema.alterTable("chunks", (table) => {
    table
      .integer("lesson_id")
      .references("id")
      .inTable("lessons")
      .onDelete("CASCADE");
    table.string("section").nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable("chunks", (table) => {
    table.dropColumn("lesson_id");
    table.dropColumn("section");
  });
  await knex.schema.dropTable("lessons");
  await knex.schema.renameTable("chunks", "lessons");
}
