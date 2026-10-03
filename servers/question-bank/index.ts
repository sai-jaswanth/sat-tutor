#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../../db/database.js";

const db = getDb();
const server = new McpServer({ name: "question-bank-server", version: "0.1.0" });

function abilityToDifficulty(ability: number): number {
  // Inverse of the Elo mapping used in student-data server
  // (200 + difficulty*160), clamped to the 1-5 range.
  const raw = (ability - 200) / 160;
  return Math.min(5, Math.max(1, Math.round(raw)));
}

function serializeQuestion(row: any, revealAnswer: boolean) {
  const q: any = {
    id: row.id,
    section: row.section,
    skill: row.skill,
    difficulty: row.difficulty,
    stem: row.stem,
    choices: row.choices_json ? JSON.parse(row.choices_json) : null,
    answer_type: row.answer_type,
    domain: row.domain,
    frequency_tier: row.frequency_tier,
    previous_exam_occurrence_count: row.previous_exam_occurrence_count,
    previous_exam_occurrence_basis: row.previous_exam_occurrence_basis,
    concept_tags: row.concept_tags_json ? JSON.parse(row.concept_tags_json) : [],
  };
  if (revealAnswer) {
    q.correct_answer = row.correct_answer;
    q.explanation = row.explanation;
  }
  return q;
}

// ---------------------------------------------------------------------
// get_question — fetch one specific question by id (e.g. to re-show it
// during mistake review, WITHOUT revealing the answer unless asked).
// ---------------------------------------------------------------------
server.tool(
  "get_question",
  "Fetch a specific question by id. Set reveal_answer=true only when the " +
    "student has already submitted an answer and you're now explaining it " +
    "(e.g. mistake review) — never reveal the answer before grading.",
  { question_id: z.string(), reveal_answer: z.boolean().default(false) },
  async ({ question_id, reveal_answer }) => {
    const row = await db.prepare(`SELECT * FROM questions WHERE id = ?`).get(question_id);
    if (!row) {
      return { content: [{ type: "text", text: `No question ${question_id}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(serializeQuestion(row, reveal_answer)) }] };
  }
);

// ---------------------------------------------------------------------
// next_question — the adaptive selection tool. This is the core
// personalization touchpoint: it picks ONE question for the student
// based on their current mastery, recent history, and (optionally) a
// requested skill/section filter.
// ---------------------------------------------------------------------
server.tool(
  "next_question",
  "Select the next best practice question for a student, adaptively. " +
    "Prioritizes skills that are due for spaced-repetition review, then " +
    "weak skills, matching difficulty to the student's current ability " +
    "(slightly above their level for productive struggle). Optionally " +
    "constrain to a specific skill or section (e.g. when the student asks " +
    "to 'practice quadratics'). Never reveals the answer.",
  {
    student_id: z.string(),
    skill: z.string().optional(),
    section: z.enum(["math", "reading_writing"]).optional(),
    exclude_question_ids: z.array(z.string()).default([]),
  },
  async ({ student_id, skill, section, exclude_question_ids }) => {
    // 1. Determine target skill if not explicitly given: prefer a skill
    //    due for review, else the weakest attempted skill, else a
    //    reasonable default starting skill.
    let targetSkill = skill;
    let studentAbility = 500;

    if (!targetSkill) {
      const due = db
        .prepare(
          `SELECT skill, ability FROM mastery
           WHERE student_id = ? AND sr_due_at <= datetime('now')
           ORDER BY sr_due_at ASC LIMIT 1`
        )
        .get(student_id) as any;

      if (due) {
        targetSkill = due.skill;
        studentAbility = due.ability;
      } else {
        const weakest = db
          .prepare(
            `SELECT skill, ability FROM mastery WHERE student_id = ? ORDER BY ability ASC LIMIT 1`
          )
          .get(student_id) as any;
        if (weakest) {
          targetSkill = weakest.skill;
          studentAbility = weakest.ability;
        }
      }
    } else {
      const m = db
        .prepare(`SELECT ability FROM mastery WHERE student_id = ? AND skill = ?`)
        .get(student_id, targetSkill) as any;
      studentAbility = m?.ability ?? 500;
    }

    const targetDifficulty = abilityToDifficulty(studentAbility + 40); // aim slightly above ability

    // 2. Build query
    let sql = `SELECT * FROM questions WHERE validated = 1`;
    const params: any[] = [];
    if (targetSkill) {
      sql += ` AND skill = ?`;
      params.push(targetSkill);
    } else if (section) {
      sql += ` AND section = ?`;
      params.push(section);
    }
    if (exclude_question_ids.length > 0) {
      sql += ` AND id NOT IN (${exclude_question_ids.map(() => "?").join(",")})`;
      params.push(...exclude_question_ids);
    }
    // Order by closeness to target difficulty, then randomize ties
    sql += ` ORDER BY ABS(difficulty - ?) ASC, RANDOM() LIMIT 1`;
    params.push(targetDifficulty);

    const row = await db.prepare(sql).get(...params);
    if (!row) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "No matching question found in bank for these constraints.",
              targetSkill,
              targetDifficulty,
            }),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            selection_reasoning: {
              targetSkill,
              studentAbility,
              targetDifficulty,
            },
            question: serializeQuestion(row, false),
          }),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------
// list_questions — browse/filter (used for building quizzes, or for the
// question-generation validation pipeline to check for duplicates).
// ---------------------------------------------------------------------
server.tool(
  "list_questions",
  "List questions matching filters, without revealing answers. Useful for " +
    "building a quiz of N questions on a topic, or checking what already " +
    "exists in the bank before generating new questions (avoid duplicates).",
  {
    section: z.enum(["math", "reading_writing"]).optional(),
    skill: z.string().optional(),
    difficulty: z.number().min(1).max(5).optional(),
    limit: z.number().default(20),
  },
  async ({ section, skill, difficulty, limit }) => {
    let sql = `SELECT * FROM questions WHERE validated = 1`;
    const params: any[] = [];
    if (section) { sql += ` AND section = ?`; params.push(section); }
    if (skill) { sql += ` AND skill = ?`; params.push(skill); }
    if (difficulty) { sql += ` AND difficulty = ?`; params.push(difficulty); }
    sql += ` LIMIT ?`;
    params.push(limit);

    const rows = await db.prepare(sql).all(...params) as any[];
    return {
      content: [{ type: "text", text: JSON.stringify(rows.map((r) => serializeQuestion(r, false))) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
