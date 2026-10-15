import readline from "node:readline/promises";
import { closeDb, getDb } from "../db/database.js";

/**
 * Wipes the whole question bank so you can rebuild it by hand in Admin -> Question Bank.
 *
 * Also clears everything that points at questions (attempts, mastery, tests, bookmarks,
 * study plans, daily challenges) - same set as `questions:replace-json`.
 * Kept: users, students, sessions, chat history, feedback, uploaded images.
 *
 * Usage:
 *   npm run questions:wipe            (asks you to type WIPE)
 *   npm run questions:wipe -- --yes   (no prompt, for scripts)
 */

const db = getDb();
const skipPrompt = process.argv.includes("--yes");

async function count(table: string) {
  const row = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()) as any;
  return Number(row?.n ?? 0);
}

const tables = ["questions", "attempts", "mastery", "practice_tests", "practice_test_items", "bookmarks", "study_plans", "daily_challenge_progress"];

try {
  console.log("Database:", (process.env.DATABASE_URL || "").replace(/\/\/[^@]*@/, "//***@"));
  console.log("\nAbout to delete:");
  for (const t of tables) console.log(`  ${t.padEnd(26)} ${await count(t)}`);
  console.log(`\nKept: ${await count("users")} users (plus chat history, feedback, uploaded images).`);

  if (!skipPrompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("\nThis cannot be undone. Type WIPE to continue: ")).trim();
    rl.close();
    if (answer !== "WIPE") {
      console.log("Cancelled. Nothing was deleted.");
      process.exitCode = 1;
    }
  }

  if (skipPrompt || process.exitCode !== 1) {
    const wipe = db.transaction(async (tx) => {
      // Children first; question-linked tables also cascade, but mastery/tests/plans don't.
      await tx.prepare(`DELETE FROM practice_test_items`).run();
      await tx.prepare(`DELETE FROM practice_tests`).run();
      await tx.prepare(`DELETE FROM bookmarks`).run();
      await tx.prepare(`DELETE FROM study_plans`).run();
      await tx.prepare(`DELETE FROM daily_challenge_progress`).run();
      await tx.prepare(`DELETE FROM mastery`).run();
      await tx.prepare(`DELETE FROM attempts`).run();
      await tx.prepare(`DELETE FROM questions`).run();
    });
    await wipe();
    console.log(`\nDone. questions now: ${await count("questions")}. Add yours in Admin -> Question Bank -> New question.`);
  }
} finally {
  await closeDb();
}
