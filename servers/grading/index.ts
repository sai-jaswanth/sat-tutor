#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../../db/database.js";
import { evaluate as mathEvaluate } from "mathjs";

const db = getDb();
const server = new McpServer({ name: "grading-server", version: "0.1.0" });

function normalizeGridIn(raw: string): number | null {
  // Accepts things like "5", "5.0", "5/1", "2/3", "  15  "
  const trimmed = raw.trim();
  try {
    const val = mathEvaluate(trimmed);
    if (typeof val === "number" && Number.isFinite(val)) return val;
  } catch {
    // fall through
  }
  return null;
}

// ---------------------------------------------------------------------
// grade_answer — the ONLY tool allowed to determine correctness. The
// agent must never assert "that's right/wrong" from its own judgment
// on a bank question; it must call this tool and report its result.
// ---------------------------------------------------------------------
server.tool(
  "grade_answer",
  "Grade a student's answer to a specific question_id against the stored " +
    "correct answer. For grid-in numeric answers, compares numerically " +
    "(handles fractions/decimals/rounding), not by exact string match. " +
    "This is the single source of truth for correctness — the agent must " +
    "never decide correctness itself, always call this tool first.",
  {
    question_id: z.string(),
    student_answer: z.string(),
  },
  async ({ question_id, student_answer }) => {
    const row = await db.prepare(`SELECT * FROM questions WHERE id = ?`).get(question_id) as any;
    if (!row) {
      return { content: [{ type: "text", text: `No question ${question_id}` }], isError: true };
    }

    let isCorrect = false;

    if (row.answer_type === "mcq") {
      const normalizedStudent = student_answer.trim().toUpperCase().replace(/[.)]/g, "");
      const normalizedCorrect = String(row.correct_answer).trim().toUpperCase();
      isCorrect = normalizedStudent === normalizedCorrect;
    } else {
      // grid_in — numeric comparison with small epsilon for rounding/fractions
      const studentVal = normalizeGridIn(student_answer);
      const correctVal = normalizeGridIn(row.correct_answer);
      if (studentVal != null && correctVal != null) {
        isCorrect = Math.abs(studentVal - correctVal) < 1e-6;
      } else {
        // fall back to exact string match if either side isn't parseable
        isCorrect = student_answer.trim() === String(row.correct_answer).trim();
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            question_id,
            student_answer,
            is_correct: isCorrect,
            correct_answer: row.correct_answer,
            explanation: row.explanation,
            skill: row.skill,
            difficulty: row.difficulty,
          }),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------
// verify_math_expression — general-purpose symbolic/numeric checker the
// agent can call while TEACHING (e.g. to confirm its own intermediate
// algebra step is correct before presenting it), independent of any
// question bank entry. This is what prevents confident math hallucination
// in free-form explanations.
// ---------------------------------------------------------------------
server.tool(
  "verify_math_expression",
  "Evaluate or compare mathematical expressions using a real computer " +
    "algebra system (not LLM arithmetic). Use this BEFORE stating any " +
    "numeric result, solving a step, or claiming two expressions are " +
    "equal in an explanation you're generating — never assert a " +
    "calculation result without verifying it here first. Provide either " +
    "a single expression to evaluate, or two expressions to compare for " +
    "equality.",
  {
    expression: z.string().describe("A math expression/arithmetic to evaluate, e.g. '3*5 + 2^2' or '(13-5)/(6-2)'. Note: this evaluates expressions, it does not symbolically solve equations for a variable — rearrange algebraically yourself, then verify the arithmetic here."),
    compare_to: z.string().optional().describe("Optional second expression to check equality against"),
  },
  async ({ expression, compare_to }) => {
    try {
      const result = mathEvaluate(expression);
      let comparison: any = null;
      if (compare_to) {
        try {
          const other = mathEvaluate(compare_to);
          comparison = { other_value: other, equal: JSON.stringify(result) === JSON.stringify(other) };
        } catch (e: any) {
          comparison = { error: `Could not evaluate compare_to: ${e.message}` };
        }
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ expression, result: result?.toString?.() ?? result, comparison }) },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ expression, error: e.message }) }],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
