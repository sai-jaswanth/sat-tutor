import { getDb, closeDb } from "../db/database.js";
import { hashPassword, verifyPassword, createSession, getUserBySession, destroySession, createPasswordResetToken, resetPasswordWithToken } from "../web/auth.js";
import { newId } from "../web/auth.js";
import { sentEmailLog, sendPasswordResetEmail } from "../web/email.js";

async function runTest() {
  console.log("Starting Phase 2.2 — Password Reset Integration Test...");
  const db = getDb();
  const testEmail = `test_reset_${Date.now()}@example.com`;
  const userId = newId("usr_test");
  const oldPass = "OriginalPass123!";
  const newPass = "BrandNewPass456!";

  // 1. Ensure table structure exists
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token text UNIQUE NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // 2. Insert test user (verified email)
  await db.prepare(
    `INSERT INTO users (id, email, password_hash, name, email_verified) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, testEmail, hashPassword(oldPass), "Password Reset Test User", true);

  console.log("✓ User created with initial password.");

  // 3. Create active session to test session revocation upon reset
  const session = await createSession(userId);
  const sessionCheckBefore = await getUserBySession(session.id);
  if (!sessionCheckBefore) throw new Error("Initial session creation failed");
  console.log("✓ Active user session established prior to reset.");

  // 4. Create password reset token & send email
  const prt = await createPasswordResetToken(userId);
  if (!prt.token) throw new Error("Reset token creation failed");

  const emailRes = await sendPasswordResetEmail({
    to: testEmail,
    name: "Password Reset Test User",
    token: prt.token,
  });
  if (!emailRes.success) throw new Error("Reset email dispatch failed: " + emailRes.error);

  const loggedEmail = sentEmailLog.find((e) => e.to === testEmail && e.subject.includes("Reset your password"));
  if (!loggedEmail || loggedEmail.token !== prt.token) {
    throw new Error("Password reset email log entry missing or mismatched");
  }
  console.log("✓ Reset token created and email dispatched:", loggedEmail.verificationUrl);

  // 5. Reset password with token
  const resetRes = await resetPasswordWithToken(prt.token, newPass);
  if (!resetRes.success) throw new Error("Password reset failed: " + resetRes.error);
  console.log("✓ Reset password executed successfully.");

  // 6. Verify old session was revoked for security
  const sessionCheckAfter = await getUserBySession(session.id);
  if (sessionCheckAfter) throw new Error("Active session was NOT revoked after password reset!");
  console.log("✓ Security check passed: Old sessions revoked automatically.");

  // 7. Verify old password is now invalid
  const userRecord: any = await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
  if (verifyPassword(oldPass, userRecord.password_hash)) {
    throw new Error("Old password still authenticates after password reset!");
  }
  console.log("✓ Old password successfully invalidated.");

  // 8. Verify new password authenticates
  if (!verifyPassword(newPass, userRecord.password_hash)) {
    throw new Error("New password fails to authenticate!");
  }
  console.log("✓ New password authenticated successfully.");

  // 9. Verify token is consumed and cannot be reused
  const reuseRes = await resetPasswordWithToken(prt.token, "AnotherPass789!");
  if (reuseRes.success) throw new Error("Reset token was allowed to be reused!");
  console.log("✓ Security check passed: Used reset tokens cannot be reused.");

  // Cleanup
  await db.prepare(`DELETE FROM users WHERE id=?`).run(userId);
  await closeDb();
  console.log("Phase 2.2 — Password Reset Integration Test PASSED successfully!\n");
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
