# SAT Tutor Target Architecture

## Current deliverable
The MVP now has a local multi-user web application around the existing tutor engine:

Browser -> same-origin Node HTTP API -> auth/authorization -> SQLite -> adaptive practice/mastery.
The existing Claude + MCP agent remains available for AI tutoring.

## Production migration
Replace the SQLite persistence layer with hosted PostgreSQL and managed auth while preserving the API/service boundaries. The browser should never receive the Groq API key or directly access MCP/database services.

## Security invariants
- authenticated session required for private APIs
- student records are scoped to the authenticated user
- admin routes require role=admin
- grading is deterministic
- attempt + mastery update is transactional
- passwords are stored as salted PBKDF2 hashes
- sessions are random opaque tokens in HttpOnly SameSite cookies
