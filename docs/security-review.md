# Security Review — Current Build

## Implemented controls
- Passwords: salted PBKDF2 hashes, never stored in plaintext.
- Sessions: random opaque server-side tokens; browser only gets HttpOnly/SameSite cookie.
- Authorization: admin routes require server-side role check.
- Student isolation: private APIs resolve the student from the authenticated session.
- Secrets: Groq API key is server-side only and read from environment.
- Input bounds: JSON request bodies have a 1 MB limit and core API paths are rate-limited in-process.
- SQL: prepared statements are used throughout the web data layer.
- Grading: deterministic; no LLM correctness authority.
- Audit: administrative writes have an audit-log foundation.

## Before public production
- Use HTTPS and production-grade secret storage.
- Move to hosted PostgreSQL and enforce row-level/data-access isolation as appropriate.
- Add centralized distributed rate limiting.
- Add email verification, password reset, account recovery, and abuse controls through a hardened auth provider.
- Add CSRF defense if cookie/auth architecture changes to allow cross-site requests.
- Add security headers, CSP, strict CORS rules, and dependency scanning.
- Add database backups and restore drills.
- Add Sentry/OpenTelemetry or equivalent observability.
