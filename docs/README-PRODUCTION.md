# Local product -> public deployment

## Local
1. `npm install`
2. `npm run seed`
3. `npm run admin:create -- admin@example.com StrongPassword123 "Admin"`
4. `npm run web`
5. Open `http://localhost:3000`

## AI tutor
Set `GROQ_API_KEY` in the server environment. Without it, the practice engine still works; the tutor endpoint reports that AI is not configured.

## Production
For a real public deployment, use a managed PostgreSQL database, managed authentication or a hardened auth service, HTTPS, external secret storage, and automated database backups. The current local release intentionally keeps persistence on SQLite because this environment cannot provision external services. The schema already includes user, session, student, attempt, mastery, chat, question, and audit concepts needed for that migration.
