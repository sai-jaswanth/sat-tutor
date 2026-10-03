import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/database.js";
import { normalizeQuestionStem, questionQualityIssues } from "./question_quality.js";

const db = getDb();

const jsonPath = process.env.SAT_QUESTION_JSON_PATH || "c:/Users/HP/Downloads/sat_question_bank_clean.json";
const resolvedPath = path.isAbsolute(jsonPath) ? jsonPath : path.resolve(process.cwd(), jsonPath);

function normalizeSkill(raw: string | undefined, fallback: string) {
  const cleaned = String(raw || "").trim();
  if (!cleaned) return fallback;
  const last = cleaned.split(".").filter(Boolean).at(-1) || cleaned;
  return last
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["and", "of", "in", "to", "for", "the", "a", "an", "on", "by"].includes(lower)) return lower;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function normalizeChoices(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((item) => String(item));
  if (typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([, value]) => String(value ?? ""));
  }
  return [String(raw)];
}

function normalizeAnswerType(raw: string | undefined): "mcq" | "grid_in" {
  const value = String(raw || "mcq").trim().toLowerCase();
  if (value === "grid_in" || value === "gridin" || value === "grid-in" || value === "numeric") return "grid_in";
  return "mcq";
}

async function resetQuestionBank() {
  await db.prepare(`DELETE FROM practice_test_items`).run();
  await db.prepare(`DELETE FROM practice_tests`).run();
  await db.prepare(`DELETE FROM bookmarks`).run();
  await db.prepare(`DELETE FROM study_plans`).run();
  await db.prepare(`DELETE FROM daily_challenge_progress`).run();
  await db.prepare(`DELETE FROM mastery`).run();
  await db.prepare(`DELETE FROM attempts`).run();
  await db.prepare(`DELETE FROM questions`).run();
}

async function importRealQuestionBank() {
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Question JSON not found at ${resolvedPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
  const items = Array.isArray(payload?.questions) ? payload.questions : [];
  if (!items.length) {
    throw new Error(`No questions found in ${resolvedPath}`);
  }

  await resetQuestionBank();

  const tx = db.transaction(async (txDb) => {
    let heldForReview = 0;
    const seenStems = new Set<string>();
    for (const item of items) {
      const section = String(item.section || "").trim().toLowerCase();
      const fallbackSkill = section === "math" ? "General Math" : "General Reading and Writing";
      const domain = String(item.domain || (section === "math" ? "Math" : "Reading and Writing")).trim();
      const choiceList = normalizeChoices(item.options);
      const skill = normalizeSkill(item.skill, fallbackSkill);
      const answer = String(item.answer ?? item.correct_answer ?? "").trim();
      const stem = normalizeQuestionStem(String(item.question_text || item.stem || ""));
      const issues = questionQualityIssues({ section, stem, choices: choiceList, answer_type: normalizeAnswerType(item.answer_type), correct_answer: answer });
      const stemKey = `${section}:${stem.replace(/\s+/g, " ").toLowerCase()}`;
      if (seenStems.has(stemKey)) issues.push("duplicate question text");
      seenStems.add(stemKey);
      const status = issues.length ? "human_review" : "approved";
      if (issues.length) heldForReview++;

      await txDb.prepare(`
        INSERT INTO questions
        (id, section, skill, difficulty, stem, choices_json, correct_answer, answer_type, explanation, source, validated, domain, frequency_tier, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?)
      `).run(
        String(item.id || `${section}_${Math.random().toString(36).slice(2, 10)}`),
        section,
        skill,
        Number(item.difficulty ?? 3),
        stem,
        choiceList.length ? JSON.stringify(choiceList) : null,
        answer,
        normalizeAnswerType(item.answer_type),
        String(item.explanation || "").trim(),
        String(item.source || "SAT question bank").trim(),
        issues.length ? 0 : 1,
        domain,
        status,
      );
    }
    console.log(`Held ${heldForReview} imported questions for human review because of content or option defects.`);
  });

  await tx();
  console.log(`Imported ${items.length} real SAT questions from ${resolvedPath}.`);
}

// --- demo student -----------------------------------------------------
await db.prepare(
  `INSERT OR IGNORE INTO students (id, name, target_test, target_score, test_date)
   VALUES (?, ?, ?, ?, ?)`
).run("student_demo", "Demo Student", "SAT", 1450, "2026-11-07");

await importRealQuestionBank();
console.log("Question bank refreshed with the clean SAT question set and normalized topic names.");
