import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and set it to your PostgreSQL connection string.");
}

export type QueryResultRow = Record<string, any>;

function normalizeQuery(input: string, params: any[]): { text: string; values: any[] } {
  let sql = input;
  let values = params;
  if (params.length === 1 && params[0] && typeof params[0] === "object" && !Array.isArray(params[0]) && /@[A-Za-z_][A-Za-z0-9_]*/.test(sql)) {
    const source = params[0] as Record<string, any>;
    const names: string[] = [];
    sql = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => { names.push(name); return `$${names.length}`; });
    values = names.map((name) => source[name]);
  }
  // Keep the existing source code's SQLite-style ? placeholders so the
  // application logic does not need to know which SQL driver is underneath.
  let index = 0;
  sql = sql.replace(/\?/g, () => `$${++index}`);
  sql = sql.replace(/datetime\('now','-([0-9]+) days'\)/gi, "CURRENT_TIMESTAMP - INTERVAL '$1 days'");
  sql = sql.replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");
  sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO");
  if (/^\s*INSERT\s+INTO/i.test(sql) && !/\bON\s+CONFLICT\b/i.test(sql)) {
    sql = `${sql.trimEnd()} ON CONFLICT DO NOTHING`;
  }
  return { text: sql, values };
}

export class Statement {
  constructor(private readonly poolOrClient: pg.Pool | pg.PoolClient, private readonly sql: string) {}

  async get(...params: any[]): Promise<QueryResultRow | undefined> {
    const query = normalizeQuery(this.sql, params);
    const result = await this.poolOrClient.query(query.text, query.values);
    return result.rows[0];
  }

  async all(...params: any[]): Promise<QueryResultRow[]> {
    const query = normalizeQuery(this.sql, params);
    const result = await this.poolOrClient.query(query.text, query.values);
    return result.rows;
  }

  async run(...params: any[]): Promise<{ changes: number; lastInsertRowid?: string | number }> {
    const query = normalizeQuery(this.sql, params);
    const result = await this.poolOrClient.query(query.text, query.values);
    return { changes: result.rowCount ?? 0 };
  }
}

export class Database {
  constructor(private readonly poolOrClient: pg.Pool | pg.PoolClient) {}

  prepare(sql: string) {
    return new Statement(this.poolOrClient, sql);
  }

  transaction<T>(fn: (db: Database) => Promise<T> | T): () => Promise<T> {
    return async () => {
      if (!("connect" in this.poolOrClient)) {
        throw new Error("Nested transactions are not supported by this database adapter.");
      }
      const client = await (this.poolOrClient as pg.Pool).connect();
      try {
        await client.query("BEGIN");
        const txDb = new Database(client);
        const result = await fn(txDb);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
  }
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10_000),
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

const db = new Database(pool);

export function getDb(): Database {
  return db;
}

export function getDbPath() {
  return DATABASE_URL;
}

export async function pingDb() {
  const result = await pool.query("SELECT NOW() AS now");
  return result.rows[0];
}

export async function closeDb() {
  await pool.end();
}
