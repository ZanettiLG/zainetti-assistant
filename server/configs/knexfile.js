import { config } from "dotenv";
config();

export default {
  client: "sqlite3",
  connection: {
    filename: process.env.DB_PATH || "./db/database.sqlite",
  },
  useNullAsDefault: true,
  migrations: {
    directory: "./db/migrations",
    extension: "js",
  },
  seeds: {
    directory: "./db/seeds",
  },
};
