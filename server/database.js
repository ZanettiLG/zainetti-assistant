import knex from "knex";
import knexConfig from "./configs/knexfile.js";

const db = knex(knexConfig);

export default db;
