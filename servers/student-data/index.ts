#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../../db/database.js";

const db = getDb();
const server = new McpServer({ name: "student-data-server", version: "0.1.0" });

// ---------------------------------------------------------------------
// get_profile — read a student's basic profile + goal info.
// ---------------------------------------------------------------------
server.tool(
  "get_profile",
  "Fetch a student's profile: name, target test, target score, test date. " +
    "Call this at the start of a session or whenever you need to personalize " +
    "tone/goals (e.g. mentioning days left until the test).",
  { student_id: z.string() },
  async ({ student_id }) => {
    const row = db
      .prepare(`SELECT * FROM students WHERE id = ?`)
      .get(student_id);
    if (!row) {
      return {
        content: [{ type: "text", text: `No student found with id ${student_id}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(row) }] };
  }
);

// ---------------------------------------------------------------------
// get_mastery — read mastery for one skill or all skills for a student.
// ---------------------------------------------------------------------
server.tool(
  "get_mastery",
  "Fetch mastery data for a student: per-skill ability score (0-1000), " +
    "accuracy, attempt count, and spaced-repetition due date. Omit `skill` " +
    "to get every skill the student has attempted (use this to build a " +
    "strengths/weaknesses summary).",
  { student_id: z.string(), skill: z.string().optional() },
  async ({ student_id, skill }) => {
    const rows = skill
      ? db
          .prepare(`SELECT * FROM mastery WHERE student_id = ? AND skill = ?`)
          .all(student_id, skill)
      : db
          .prepare(`SELECT * FROM mastery WHERE student_id = ? ORDER BY ability ASC`)
          .all(student_id);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  }
);

// ---------------------------------------------------------------------
// log_attempt — record a question attempt AND update mastery in one
// transaction. This is the single write-path for all practice/test
// activity so mastery numbers can never drift out of sync with the
// attempt log.
// ---------------------------------------------------------------------
server.tool(
  "log_attempt",
  "Record a student's attempt at a question and update their mastery for " +
    "that skill accordingly. ALWAYS call this immediately after the grading " +
    "tool has determined correctness — never update mastery manually, and " +
    "never skip logging an attempt, even for practice questions the student " +
    "abandons (log with is_correct=false in that case).",
  {
    student_id: z.string(),
    question_id: z.string(),
    skill: z.string(),
    student_answer: z.string(),
    is_correct: z.boolean(),
    difficulty: z.number().min(1).max(5),
    time_seconds: z.number().optional(),
    hints_used: z.number().default(0),
    mistake_type: z
      .enum(["conceptual", "careless", "time_pressure", "misread"])
      .optional(),
  },
  async ({
    student_id,
    question_id,
    skill,
    student_answer,
    is_correct,
    difficulty,
    time_seconds,
    hints_used,
    mistake_type,
  }) => {
    const tx = db.transaction(async (txDb) => {
      await txDb.prepare(
        `INSERT INTO attempts
           (student_id, question_id, student_answer, is_correct, time_seconds, hints_used, mistake_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        student_id,
        question_id,
        student_answer,
        is_correct ? 1 : 0,
        time_seconds ?? null,
        hints_used,
        mistake_type ?? null
      );

      const existing = await txDb
        .prepare(`SELECT * FROM mastery WHERE student_id = ? AND skill = ?`)
        .get(student_id, skill) as any;

      // --- ability update -------------------------------------------
      // Simple Elo-style update: treat the question's difficulty (1-5)
      // as an opponent rating (mapped to the same 0-1000 scale), and
      // move the student's ability toward or away from it based on the
      // outcome. K-factor shrinks as attempts accumulate so estimates
      // stabilize over time instead of oscillating forever.
      const priorAbility = existing?.ability ?? 500;
      const priorAttempts = existing?.attempts ?? 0;
      const opponentRating = 200 + difficulty * 160; // difficulty 1->360 .. 5->1000
      const expected = 1 / (1 + Math.pow(10, (opponentRating - priorAbility) / 400));
      const k = Math.max(8, 40 - priorAttempts); // starts responsive, settles down
      const newAbility = priorAbility + k * ((is_correct ? 1 : 0) - expected);

      // --- spaced repetition update (simplified SM-2) -----------------
      let sr_ease = existing?.sr_ease ?? 2.5;
      let sr_interval_days = existing?.sr_interval_days ?? 1;
      if (is_correct) {
        sr_interval_days = existing
          ? Math.round(sr_interval_days * sr_ease * 10) / 10
          : 1;
        sr_ease = Math.min(3.0, sr_ease + 0.05);
      } else {
        sr_interval_days = 1; // wrong answer resets the interval
        sr_ease = Math.max(1.3, sr_ease - 0.2);
      }
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + Math.ceil(sr_interval_days));

      const newAttempts = priorAttempts + 1;
      const newCorrect = (existing?.correct ?? 0) + (is_correct ? 1 : 0);
      const priorAvgTime = existing?.avg_time_seconds ?? 0;
      const newAvgTime =
        time_seconds != null
          ? (priorAvgTime * priorAttempts + time_seconds) / newAttempts
          : priorAvgTime;

      await txDb.prepare(
        `INSERT INTO mastery
           (student_id, skill, ability, attempts, correct, avg_time_seconds,
            last_attempt_at, sr_interval_days, sr_ease, sr_due_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
         ON CONFLICT(student_id, skill) DO UPDATE SET
           ability = excluded.ability,
           attempts = excluded.attempts,
           correct = excluded.correct,
           avg_time_seconds = excluded.avg_time_seconds,
           last_attempt_at = excluded.last_attempt_at,
           sr_interval_days = excluded.sr_interval_days,
           sr_ease = excluded.sr_ease,
           sr_due_at = excluded.sr_due_at`
      ).run(
        student_id,
        skill,
        Math.round(newAbility * 10) / 10,
        newAttempts,
        newCorrect,
        Math.round(newAvgTime * 10) / 10,
        sr_interval_days,
        sr_ease,
        dueDate.toISOString()
      );

      return { newAbility: Math.round(newAbility * 10) / 10, newAttempts, newCorrect };
    });

    const result = await tx();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

// ---------------------------------------------------------------------
// get_review_queue — skills due for spaced-repetition review.
// ---------------------------------------------------------------------
server.tool(
  "get_review_queue",
  "Get the list of skills that are due (or overdue) for spaced-repetition " +
    "review for this student, ordered by most overdue first. Use this when " +
    "the student asks 'what should I study today' or at the start of a " +
    "planning conversation.",
  { student_id: z.string() },
  async ({ student_id }) => {
    const rows = db
      .prepare(
        `SELECT skill, ability, attempts, correct, sr_due_at
         FROM mastery
         WHERE student_id = ? AND sr_due_at <= datetime('now')
         ORDER BY sr_due_at ASC`
      )
      .all(student_id);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
