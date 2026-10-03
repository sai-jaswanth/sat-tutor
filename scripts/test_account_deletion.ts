import { getDb, closeDb } from "../db/database.js";
import { hashPassword, createSession, deleteUserAccount } from "../web/auth.js";
import { newId } from "../web/auth.js";

async function runTest() {
  console.log("Starting Phase 2.5 — Account Deletion Integration Test...");
  const db = getDb();
  const testEmail = `test_delete_${Date.now()}@example.com`;
  const userId = newId("usr_test");
  const studentId = newId("stu_test");
  const testPass = "DeletePass123!";

  // 1. Insert user
  await db.prepare(
    `INSERT INTO users (id, email, password_hash, name, email_verified) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, testEmail, hashPassword(testPass), "Deletion Test User", true);

  // 2. Insert student profile
  await db.prepare(
    `INSERT INTO students (id, user_id, name, target_test) VALUES (?, ?, ?, ?)`
  ).run(studentId, userId, "Deletion Test Student", "SAT");

  // 3. Insert active session & bookmark
  const session = await createSession(userId, "127.0.0.1", "Test Browser");
  await db.prepare(
    `INSERT INTO bookmarks (student_id, question_id, note) VALUES (?, ?, ?)`
  ).run(studentId, "q_math_linear_1", "Test note");

  console.log("✓ Test user, student profile, session, and bookmark created.");

  // 4. Attempt deletion with WRONG password
  const failRes = await deleteUserAccount(userId, "WrongPassword999!");
  if (failRes.success) throw new Error("Account deletion allowed incorrect password!");
  console.log("✓ Rejection of incorrect password verified.");

  // 5. Attempt deletion with CORRECT password
  const successRes = await deleteUserAccount(userId, testPass);
  if (!successRes.success) throw new Error("Account deletion failed with correct password: " + failRes.error);
  console.log("✓ Account deletion executed successfully.");

  // 6. Verify database records are completely purged
  const userCheck = await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
  if (userCheck) throw new Error("User record was not deleted!");

  const studentCheck = await db.prepare(`SELECT * FROM students WHERE id=?`).get(studentId);
  if (studentCheck) throw new Error("Student record was not deleted!");

  const sessionCheck = await db.prepare(`SELECT * FROM sessions WHERE id=?`).get(session.id);
  if (sessionCheck) throw new Error("Session record was not purged!");

  const bookmarkCheck = await db.prepare(`SELECT * FROM bookmarks WHERE student_id=?`).get(studentId);
  if (bookmarkCheck) throw new Error("Bookmark record was not purged via cascade!");

  console.log("✓ Database check passed: User, profile, sessions, and bookmarks fully purged.");
  await closeDb();
  console.log("Phase 2.5 — Account Deletion Integration Test PASSED successfully!\n");
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
