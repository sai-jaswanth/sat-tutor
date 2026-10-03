# PostgreSQL conversion notes

This version replaces the SQLite runtime adapter with a PostgreSQL connection pool using `pg`.

## Runtime
- `DATABASE_URL` is required.
- `.env.example` documents local PostgreSQL settings.
- `db/database.ts` provides an async compatibility adapter (`prepare().get/all/run`) over `pg`.
- Existing `?` placeholders and SQLite-style named parameters are translated by the adapter.
- SQLite `datetime('now')`, relative date expressions, and `INSERT OR IGNORE` are translated for PostgreSQL.
- Transactions use real PostgreSQL `BEGIN/COMMIT/ROLLBACK` and a dedicated pooled client.

## Schema
- `migrations/001_production_postgres.sql` creates the full application schema.
- IDs remain text to preserve the application's existing `usr_*`, `stu_*`, `q_*`, etc. identifiers.
- JSON payloads remain text for minimal application changes; they can be upgraded to JSONB later.
- Timestamps use PostgreSQL `timestamptz`.
- Auto-incrementing numeric IDs use `bigserial`.

## Commands
1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL`.
3. Start PostgreSQL (local installation or `docker compose up -d postgres`).
4. `npm install`
5. `npm run migrate`
6. `npm run seed`
7. `npm run admin:create -- admin@example.com StrongPassword123 "Admin"`
8. `npm run web`
9. Open `http://localhost:3000`.
10. `npm run db:ping` should print a PostgreSQL timestamp.

## Important
This is a PostgreSQL runtime conversion, not a hosted production deployment. A cloud database, backups, SSL, connection pooling strategy, monitoring, and secrets management still need to be configured before public production use.
