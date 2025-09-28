import Database from "better-sqlite3";

const db = new Database("cake.sqlite3");
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

export default db;
