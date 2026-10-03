import { getDb } from "../db/database.js";
import { normalizeQuestionStem, questionQualityIssues } from "./question_quality.js";

const db = getDb();
const rows = await db.prepare(`SELECT id,section,stem,choices_json,correct_answer,answer_type FROM questions WHERE status='approved' AND validated=1 ORDER BY id ASC`).all() as any[];
let quarantined = 0;
const seenStems = new Set<string>();

for (const row of rows) {
  const choices = row.choices_json ? JSON.parse(row.choices_json) : null;
  const stem = normalizeQuestionStem(row.stem);
  const issues = questionQualityIssues({
    section: row.section,
    stem,
    choices,
    correct_answer: row.correct_answer,
    answer_type: row.answer_type,
  });
  const stemKey = `${row.section}:${String(row.stem || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
  if (seenStems.has(stemKey)) issues.push('duplicate question text');
  seenStems.add(stemKey);
  if (stem !== row.stem) await db.prepare(`UPDATE questions SET stem=? WHERE id=?`).run(stem, row.id);
  if (!issues.length) continue;
  await db.prepare(`UPDATE questions SET status='human_review',validated=0 WHERE id=? AND status='approved' AND validated=1`).run(row.id);
  quarantined++;
  console.log(`${row.id}: ${issues.join('; ')}`);
}

console.log(`Quarantined ${quarantined} of ${rows.length} approved questions with content or answer-option defects.`);