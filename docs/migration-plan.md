# Migration Plan

## Stage 1 — Completed
- extract authentication into `web/auth.ts`
- expand SQLite schema for users, sessions, chats, audit logs
- add web/API server
- add student isolation
- add practice/progress/profile APIs
- add AI tutor endpoint
- add admin dashboard endpoints
- add static web UI

## Stage 2 — Completed locally
- backwards-compatible schema changes for old SQLite databases
- seed/admin setup scripts
- Docker packaging configuration
- PostgreSQL reference migration

## Stage 3 — Production cutover
1. Create hosted PostgreSQL.
2. Apply `migrations/001_production_postgres.sql` and subsequent migrations.
3. Completed in this PostgreSQL build: replace the local `better-sqlite3` adapter with a pooled `pg` adapter while keeping the application service boundaries stable.
4. Migrate existing users/questions/attempts.
5. Run integration tests against staging PostgreSQL.
6. Configure managed auth/email verification.
7. Deploy API and frontend under HTTPS.
8. Configure secrets and backups.
9. Run a security/authorization review.
10. Promote staging to production.
