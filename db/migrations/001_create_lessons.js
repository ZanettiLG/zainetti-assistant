export async function up(knex) {
  return knex.schema.createTable("lessons", (table) => {
    table.increments("id").primary();
    table.string("title").notNullable();
    table.text("content").notNullable();
    table.string("source_file").notNullable();
    table.string("chunk_hash").unique().notNullable();
    table.integer("chunk_index").notNullable();
    table.timestamps(true, true);
  });
}

export async function down(knex) {
  return knex.schema.dropTable("lessons");
}
