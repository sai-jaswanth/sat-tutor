CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user ON email_verification_tokens(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address text,
  user_agent text,
  last_active_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS students (
  id text PRIMARY KEY,
  user_id text UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  target_test text NOT NULL DEFAULT 'SAT',
  target_score integer,
  test_date date,
  weekly_available_minutes integer,
  timezone text,
  diagnostic_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mastery (
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  skill text NOT NULL,
  ability double precision NOT NULL DEFAULT 500,
  attempts integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  avg_time_seconds double precision NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  sr_interval_days double precision NOT NULL DEFAULT 1,
  sr_ease double precision NOT NULL DEFAULT 2.5,
  sr_due_at timestamptz,
  PRIMARY KEY(student_id, skill)
);
CREATE TABLE IF NOT EXISTS questions (
  id text PRIMARY KEY,
  section text NOT NULL,
  skill text NOT NULL,
  difficulty integer NOT NULL CHECK(difficulty BETWEEN 1 AND 5),
  stem text NOT NULL,
  choices_json text,
  correct_answer text NOT NULL,
  answer_type text NOT NULL DEFAULT 'mcq',
  explanation text NOT NULL,
  source text NOT NULL DEFAULT 'seed',
  validated integer NOT NULL DEFAULT 1,
  domain text,
  frequency_tier text NOT NULL DEFAULT 'unknown',
  previous_exam_occurrence_count integer,
  previous_exam_occurrence_basis text,
  concept_tags_json text,
  status text NOT NULL DEFAULT 'approved',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_questions_skill ON questions(skill);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
CREATE TABLE IF NOT EXISTS attempts (
  id bigserial PRIMARY KEY,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  student_answer text NOT NULL,
  is_correct integer NOT NULL,
  time_seconds double precision,
  hints_used integer NOT NULL DEFAULT 0,
  mistake_type text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_question ON attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_mastery_due ON mastery(student_id, sr_due_at);
CREATE TABLE IF NOT EXISTS chat_sessions (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New tutoring session',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata_json text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bookmarks (
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(student_id, question_id)
);
CREATE TABLE IF NOT EXISTS study_plans (
  student_id text PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  plan_json text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_challenge_progress (
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  challenge_date date NOT NULL,
  question_ids_json text NOT NULL,
  answered_json text NOT NULL DEFAULT '{}',
  completed_at timestamptz,
  PRIMARY KEY(student_id, challenge_date)
);
CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'general' CHECK(type IN ('bug','content','general','feature')),
  message text NOT NULL,
  question_id text REFERENCES questions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','resolved','dismissed')),
  resolved_by text REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE TABLE IF NOT EXISTS practice_tests (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  config_json text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','finished','abandoned')),
  score_json text,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_practice_tests_student ON practice_tests(student_id);
CREATE TABLE IF NOT EXISTS practice_test_items (
  id bigserial PRIMARY KEY,
  test_id text NOT NULL REFERENCES practice_tests(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  order_index integer NOT NULL,
  module text NOT NULL,
  student_answer text,
  is_correct integer,
  time_seconds double precision
);
CREATE INDEX IF NOT EXISTS idx_practice_test_items_test ON practice_test_items(test_id);
