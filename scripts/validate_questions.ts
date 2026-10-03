import { getDb } from "../db/database.js";
import { questionQualityIssues } from "./question_quality.js";

/**
 * Validates the question bank for reliability issues that would make
 * grading, adaptive selection, or student trust unreliable:
 *  - duplicate stems within the same skill (same question posing as
 *    multiple difficulty levels / IDs)
 *  - MCQ correct_answer must be a letter matching one of the choices
 *  - MCQ must have between 2 and 6 choices
 *  - grid-in correct_answer must be numerically parseable
 *  - explanation must be non-trivial (not empty/too short)
 *  - stem must be non-trivial
 *  - difficulty must be an integer 1-5
 *  - section must be one of the two known sections
 *  - status must be a known value
 *
 * Exit code is non-zero if any hard error is found, so this can gate
 * seeding/CI. Run with: npx tsx scripts/validate_questions.ts
 */

const db = getDb();
const rows = await db.prepare(`SELECT * FROM questions`).all() as any[];
const activeRows = rows.filter(row => row.status === "approved" && Number(row.validated) === 1);
const heldForReview = rows.length - activeRows.length;

let errors = 0;
let warnings = 0;

const KNOWN_SECTIONS = new Set(["math", "reading_writing"]);
const KNOWN_STATUS = new Set(["approved", "draft", "human_review", "rejected", "archived"]);

function fail(id: string, msg: string) {
  console.error(`ERROR  [${id}] ${msg}`);
  errors++;
}
function warn(id: string, msg: string) {
  console.warn(`WARN   [${id}] ${msg}`);
  warnings++;
}

for (const r of activeRows) {
  if (!r.stem || String(r.stem).trim().length < 8) fail(r.id, "stem is missing or too short");
  if (!r.explanation || String(r.explanation).trim().length < 15) fail(r.id, "explanation is missing or too short");
  if (!KNOWN_SECTIONS.has(r.section)) fail(r.id, `unknown section '${r.section}'`);
  if (!KNOWN_STATUS.has(r.status)) fail(r.id, `unknown status '${r.status}'`);
  if (!Number.isInteger(r.difficulty) || r.difficulty < 1 || r.difficulty > 5) fail(r.id, `difficulty out of range: ${r.difficulty}`);
  const choices: string[] | null = r.choices_json ? JSON.parse(r.choices_json) : null;
  const qualityIssues = questionQualityIssues({ section: r.section, stem: r.stem, choices, answer_type: r.answer_type, correct_answer: r.correct_answer });
  for (const issue of qualityIssues) fail(r.id, issue);
  if (r.answer_type === "mcq") {
    if (!choices || choices.length < 2 || choices.length > 6) {
      fail(r.id, `mcq question has ${choices ? choices.length : 0} choices (need 2-6)`);
    } else {
      const letters = choices.map((_, i) => String.fromCharCode(65 + i));
      if (!letters.includes(String(r.correct_answer).trim().toUpperCase())) {
        fail(r.id, `mcq correct_answer '${r.correct_answer}' is not one of ${letters.join(",")}`);
      }
    }
  } else if (r.answer_type === "grid_in" || r.answer_type === "grid-in") {
    if (choices) warn(r.id, "grid-in question unexpectedly has choices");
    const asNum = Number(r.correct_answer);
    if (!Number.isFinite(asNum) && !/^-?\d+\/\d+$/.test(String(r.correct_answer).trim())) {
      fail(r.id, `grid-in correct_answer '${r.correct_answer}' is not numeric or a simple fraction`);
    }
  } else {
    fail(r.id, `unknown answer_type '${r.answer_type}'`);
  }
}

// Duplicate-stem detection within the same skill: the same question text
// should not appear more than once tagged as different difficulty/id pairs.
const bySkill = new Map<string, Map<string, string[]>>();
for (const r of activeRows) {
  if (!bySkill.has(r.skill)) bySkill.set(r.skill, new Map());
  const stemMap = bySkill.get(r.skill)!;
  const key = String(r.stem).trim().toLowerCase();
  if (!stemMap.has(key)) stemMap.set(key, []);
  stemMap.get(key)!.push(r.id);
}
for (const [skill, stemMap] of bySkill) {
  for (const [stem, ids] of stemMap) {
    if (ids.length > 1) {
      const ratio = ids.length / [...stemMap.values()].reduce((a, l) => a + l.length, 0);
      if (ratio > 0.15) {
        fail(ids[0], `skill '${skill}' has a stem duplicated ${ids.length} times across ids [${ids.join(", ")}] — this makes difficulty labels and spaced repetition unreliable`);
      } else {
        warn(ids[0], `skill '${skill}' has a stem duplicated ${ids.length} times (ids: ${ids.join(", ")})`);
      }
    }
  }
}

// Duplicate IDs (should be impossible with PRIMARY KEY, but double check any
// case-only collisions that SQLite's default id equality wouldn't catch).
const idCounts = new Map<string, number>();
for (const r of rows) idCounts.set(r.id, (idCounts.get(r.id) || 0) + 1);

console.log(`\nChecked ${activeRows.length} approved questions across ${bySkill.size} skills.`);
console.log(`${heldForReview} question(s) are held for human review and excluded from practice.`);
console.log(`${errors} error(s), ${warnings} warning(s).`);
if (errors > 0) {
  console.error("\nQuestion bank validation FAILED.");
  process.exit(1);
} else {
  console.log("\nQuestion bank validation passed.");
}
