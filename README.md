# SAT Tutor — Multi-user Product Foundation

This repository started as a CLI-only SAT tutor MVP using Claude + MCP + SQLite. It now includes a real local web product layer while preserving the original adaptive learning engine.

## Implemented

- Existing MCP servers: student-data, question-bank, grading
- Deterministic MCQ and numeric/grid-in grading
- Math verification with mathjs
- Elo-style per-skill mastery
- Simplified SM-2 spaced repetition
- Adaptive next-question selection
- Multi-user registration and login
- Opaque HttpOnly session cookies
- Student-specific profiles and strict server-side data scoping
- Web dashboard, practice UI, progress page, AI tutor, profile editing
- Persistent chat sessions/messages, with the AI tutor pooled per session (not respawned per message) and primed with prior turns on resume
- Diagnostic test, full-length/section timed practice tests with scaled-score estimates
- Bookmarks, mistake review queue, deterministic (non-AI) weekly study plans
- Achievements/streaks and a shared daily challenge, all computed from real attempt history
- Student feedback/bug reports with an admin triage queue
- Admin dashboard with user search/suspend, question CRUD + approval workflow, feedback triage, and analytics (skill accuracy, difficulty calibration, most-missed questions)
- Audit logging foundation
- 1,208-question original bank with an automated validation gate (`npm run questions:validate`) checking for duplicate stems, answer/choice consistency, and metadata completeness
- PostgreSQL runtime adapter with pooled connections and real transactions
- PostgreSQL schema in `migrations/001_production_postgres.sql` plus `npm run migrate`
- Dockerfile and compose definition for deployment packaging

> **Going public?** Follow [DEPLOY.md](DEPLOY.md) for the full step-by-step guide.

## Run locally with PostgreSQL

This version uses PostgreSQL at runtime; SQLite is no longer used by the application.

```bash
npm install
npm run migrate
npm run questions:import-json -- path/to/questions.json
npm run admin:create -- admin@example.com StrongPassword123 "Admin"
npm run web
```

The JSON import is optional and adds questions without clearing existing student data. Omit it if the database already has the question bank you want. Open `http://localhost:3000`.

Production startup applies the schema and creates the configured admin account; it does not seed or replace questions. Import the fixed question JSON with `npm run questions:import-json -- path/to/questions.json` and `DATABASE_URL`/`DATABASE_SSL=true` set for the target PostgreSQL database. Automatic and npm-script question seeding are disabled so only explicitly imported questions are used.

For local PostgreSQL, the repository includes a Docker Compose service:

```bash
docker compose up -d postgres
```

Then use the default `.env.example` connection string, or point `DATABASE_URL` at your own PostgreSQL instance.

Useful database checks:

```bash
npm run db:ping
npm run questions:count
npm run questions:validate
```

The AI Tutor page requires:

```bash
GROQ_API_KEY=gsk_...
```

Windows PowerShell:

```powershell
$env:GROQ_API_KEY="gsk_..."
```

## Security notes

- Passwords are salted PBKDF2 hashes using Node's crypto module.
- Sessions use random opaque tokens in HttpOnly, SameSite=Strict cookies.
- Student IDs are resolved server-side from the authenticated user; the browser cannot choose another student's ID for normal APIs.
- Admin APIs require an authenticated user with `role = admin`.
- Grading is deterministic and is not delegated to Claude.
- Attempt + mastery writes run in one database transaction.
- Production should add HTTPS, managed secrets, database backups, stronger centralized rate limiting, monitoring, and a managed authentication service before public launch.

## Current limitations

This is a substantial local/public-beta foundation, not a claim of completed enterprise SaaS infrastructure. The following still require external services or another implementation pass:

- Hosted PostgreSQL cutover
- Managed authentication/email verification
- Cloud deployment and domain/DNS
- Centralized rate limiting at scale
- Production observability/alerting
- Payment/subscription system
- Question generation + human review workflow
- Notes/PDF/video ingestion and RAG
- A full multi-module, official-length exam simulator with an official score concordance (the current practice tests are single-module, timed sets with a simple linear scaled-score *estimate*, not an official conversion)

See `docs/` for the implementation and migration details.


## Bulk question bank

Run `npm run seed:bulk` to add 1,200 original SAT-style questions (800 Math + 400 Reading & Writing) across the official content-domain/skill structure and difficulty levels, then `npm run questions:validate` to check them for reliability issues (duplicate stems, broken answers/choices, missing metadata). See `docs/question-bank.md`. Prior-exam occurrence counts are only populated from verified source data; original generated items are not presented as real exam questions.
