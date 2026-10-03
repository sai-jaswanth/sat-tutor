# Final Architecture for This Build

```text
                    STUDENT BROWSER
                           |
                           | same-origin HTTPS in production
                           v
                +-----------------------+
                | Node Web / API Server |
                | auth + API + admin    |
                +-----------+-----------+
                            |
          +-----------------+------------------+
          |                 |                  |
          v                 v                  v
     Practice           Progress            Chat
     Engine              Engine            Service
          |                 |                  |
          +-----------------+------------------+
                            |
                            v
                        Database
                            |
                 +----------+----------+
                 |                     |
                 v                     v
             App state             Audit data

AI path:

Browser -> API -> TutorAgent -> Claude -> MCP -> tools -> Database
```

## Main data model

`users` are identities. `students` are learning profiles. A user owns one student profile in the current product layer.

`attempts` records each submitted answer. `mastery` stores one row per student + skill. `questions` contains the validated question bank. `chat_sessions` and `chat_messages` persist tutoring conversations.

## Critical invariant
For a submitted practice answer:

`grade -> insert attempt -> update mastery`

must remain atomic.

## Production direction
Replace SQLite with PostgreSQL, use managed authentication, put the web/API services behind HTTPS, add backups/monitoring, and keep Claude + MCP behind the server boundary.
