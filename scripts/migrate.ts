import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const sql = await fs.readFile(path.resolve(process.cwd(), "migrations/001_production_postgres.sql"), "utf8");
const pool = new Pool({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
try {
  await pool.query(sql);
  console.log("PostgreSQL schema applied successfully.");
} finally {
  await pool.end();
}
