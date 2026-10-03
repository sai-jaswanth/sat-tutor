# Current Architecture Audit

## Original snapshot
The uploaded snapshot contained:
- Claude-based TutorAgent
- 3 MCP servers: student-data, question-bank, grading
- SQLite
- 8 seed questions
- CLI chat

## Product layer added in this build
A same-origin Node HTTP web/API layer was added to make the system multi-user without introducing a large frontend dependency tree.

### Authentication
- `users` table
- PBKDF2 password hashes using Node `crypto`
- random opaque sessions
- HttpOnly SameSite=Strict cookie

### Student isolation
Every private request resolves the authenticated session to a user and then to a student profile. Student progress, attempts and chats are queried using that resolved student ID rather than trusting a browser-supplied student ID.

### Practice
The web practice endpoint uses the same core concepts as the original MCP engine:
- review due skills first
- otherwise weakest skill
- target difficulty slightly above current ability
- choose only validated/approved questions
- deterministic grading
- transactional attempt + mastery update

### AI tutor
The existing `TutorAgent` remains intact. The orchestrator now accepts an authenticated `studentId`, and user-scoped tool calls are forced to that identity before reaching the MCP server.

## Deliberate local choice
The product layer still uses SQLite locally because the execution environment does not provide Docker or a hosted PostgreSQL account. A PostgreSQL reference migration is included for production migration.
