import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { normalizeQuestionStem, questionQualityIssues } from "./question_quality.js";

type RawQuestion = Record<string, unknown>;

function normalizeSkill(raw: unknown, fallback: string) {
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
    return Object.entries(raw as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => String(value ?? ""));
  }
  return [String(raw)];
}

function normalizeAnswerType(raw: unknown): "mcq" | "grid_in" {
  const value = String(raw || "mcq").trim().toLowerCase();
  if (["grid_in", "gridin", "grid-in", "numeric"].includes(value)) return "grid_in";
  return "mcq";
}

const inputPath = process.argv[2] || process.env.SAT_QUESTION_JSON_PATH;
if (!inputPath) {
  throw new Error("Provide the JSON file path as an argument or set SAT_QUESTION_JSON_PATH.");
}

const resolvedPath = path.resolve(inputPath);
if (!fs.existsSync(resolvedPath)) {
  throw new Error(`Question JSON not found at ${resolvedPath}`);
}

const payload: unknown = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
if (!payload || typeof payload !== "object" || !Array.isArray((payload as { questions?: unknown }).questions)) {
  throw new Error(`Expected ${resolvedPath} to contain a questions array.`);
}

const items = (payload as { questions: unknown[] }).questions;
if (items.length === 0 || !items.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
  throw new Error("The questions array must contain question objects.");
}

const seenStems = new Set<string>();
const questions = (items as RawQuestion[]).map((item, index) => {
  const section = String(item.section || "").trim().toLowerCase();
  const fallbackSkill = section === "math" ? "General Math" : "General Reading and Writing";
  const domain = String(item.domain || (section === "math" ? "Math" : "Reading and Writing")).trim();
  const choices = normalizeChoices(item.options);
  const skill = normalizeSkill(item.skill, fallbackSkill);
  const correctAnswer = String(item.answer ?? item.correct_answer ?? "").trim();
  const stem = normalizeQuestionStem(String(item.question_text || item.stem || ""));
  const answerType = normalizeAnswerType(item.answer_type);
  const difficulty = Number(item.difficulty ?? 3);

  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    throw new Error(`Question ${index + 1} has invalid difficulty; expected an integer from 1 to 5.`);
  }

  const issues = questionQualityIssues({
    section,
    stem,
    choices,
    answer_type: answerType,
    correct_answer: correctAnswer,
  });
  const stemKey = `${section}:${stem.replace(/\s+/g, " ").toLowerCase()}`;
  if (seenStems.has(stemKey)) issues.push("duplicate question text");
  seenStems.add(stemKey);

  const sourceId = String(item.id || "").trim();
  const stableId = sourceId || createHash("sha256").update(stemKey).digest("hex").slice(0, 24);

  return {
    id: `imported_${stableId}`,
    section,
    skill,
    difficulty,
    stem,
    choicesJson: choices.length ? JSON.stringify(choices) : null,
    correctAnswer,
    answerType,
    explanation: String(item.explanation || "").trim(),
    source: String(item.source || "SAT question bank").trim(),
    validated: issues.length ? 0 : 1,
    domain,
    status: issues.length ? "human_review" : "approved",
  };
});

const db = getDb();
try {
  const importQuestions = db.transaction(async (txDb) => {
    let inserted = 0;
    let heldForReview = 0;

    for (const question of questions) {
      const result = await txDb.prepare(`
        INSERT INTO questions
        (id, section, skill, difficulty, stem, choices_json, correct_answer, answer_type, explanation, source, validated, domain, frequency_tier, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?)
        ON CONFLICT (id) DO NOTHING
      `).run(
        question.id,
        question.section,
        question.skill,
        question.difficulty,
        question.stem,
        question.choicesJson,
        question.correctAnswer,
        question.answerType,
        question.explanation,
        question.source,
        question.validated,
        question.domain,
        question.status,
      );

      inserted += result.changes;
      if (question.status === "human_review" && result.changes > 0) heldForReview++;
    }

    return { inserted, skipped: questions.length - inserted, heldForReview };
  });

  const result = await importQuestions();
  console.log(`Imported ${result.inserted} of ${questions.length} questions from ${resolvedPath}.`);
  console.log(`Skipped ${result.skipped} question IDs that were already present; no existing data was deleted.`);
  console.log(`Held ${result.heldForReview} imported questions for human review.`);
} finally {
  await closeDb();
}
