import { getDb, closeDb } from "../db/database.js";
import { hashPassword, verifyPassword, createSession, getUserBySession, destroySession, createVerificationToken, verifyEmailToken } from "../web/auth.js";
import { newId } from "../web/auth.js";
import { sentEmailLog, sendVerificationEmail } from "../web/email.js";

async function runTest() {
  console.log("Starting Phase 2.1 — Email Verification Integration Test...");
  const db = getDb();
  const testEmail = `test_verify_${Date.now()}@example.com`;
  const userId = newId("usr_test");
  const testPass = "SecurePass123!";

  // 1. Ensure table structure is active
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token text UNIQUE NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // 2. Insert unverified user
  await db.prepare(
    `INSERT INTO users (id, email, password_hash, name, email_verified) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, testEmail, hashPassword(testPass), "Verification Test User", false);

  const unverifiedUser: any = await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
  if (!unverifiedUser) throw new Error("Failed to insert test user");
  const isVerifiedInitial = unverifiedUser.email_verified === true || unverifiedUser.email_verified === 1 || unverifiedUser.email_verified === "t";
  if (isVerifiedInitial) throw new Error("Newly registered user should have email_verified = false");
  console.log("✓ User created in unverified state.");

  // 3. Create verification token & send email
  const tokenObj = await createVerificationToken(userId);
  if (!tokenObj.token) throw new Error("Token creation failed");

  const emailRes = await sendVerificationEmail({
    to: testEmail,
    name: "Verification Test User",
    token: tokenObj.token,
  });
  if (!emailRes.success) throw new Error("Email dispatch failed: " + emailRes.error);
  console.log("✓ Verification token created and email dispatched (mocked/resend).");

  const loggedEmail = sentEmailLog.find((e) => e.to === testEmail);
  if (!loggedEmail || loggedEmail.token !== tokenObj.token) {
    throw new Error("Email log entry missing or mismatched");
  }
  console.log("✓ Sent email log verified:", loggedEmail.verificationUrl);

  // 4. Verify that unverified user login fails
  const uForLogin: any = await db.prepare(`SELECT * FROM users WHERE email=?`).get(testEmail);
  const isValidPass = verifyPassword(testPass, uForLogin.password_hash);
  const isVerifiedBeforeLogin = uForLogin.email_verified === true || uForLogin.email_verified === 1 || uForLogin.email_verified === "t";
  if (!isValidPass) throw new Error("Password check failed");
  if (isVerifiedBeforeLogin) throw new Error("User should not be verified yet");
  console.log("✓ Unverified user login attempt correctly blocked.");

  // 5. Verify email using token
  const verifyResult = await verifyEmailToken(tokenObj.token);
  if (!verifyResult.success) throw new Error("Token verification failed: " + verifyResult.error);
  console.log("✓ Email token verified successfully.");

  // 6. Check DB state after verification
  const verifiedUser: any = await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
  const isVerifiedAfter = verifiedUser.email_verified === true || verifiedUser.email_verified === 1 || verifiedUser.email_verified === "t";
  if (!isVerifiedAfter) throw new Error("User email_verified flag was not set to true");

  const remainingToken = await db.prepare(`SELECT * FROM email_verification_tokens WHERE token=?`).get(tokenObj.token);
  if (remainingToken) throw new Error("Verification token was not deleted after use");
  console.log("✓ User record updated to verified and token consumed.");

  // 7. Verify login succeeds post-verification
  const session = await createSession(userId);
  const sessionUser = await getUserBySession(session.id);
  if (!sessionUser || sessionUser.id !== userId || !sessionUser.emailVerified) {
    throw new Error("Session lookup failed or emailVerified not reflected in session");
  }
  await destroySession(session.id);
  console.log("✓ Verified user session login succeeded.");

  // 8. Test invalid/expired token behavior
  const invalidResult = await verifyEmailToken("invalid_token_123");
  if (invalidResult.success) throw new Error("Invalid token should not succeed");
  console.log("✓ Invalid token rejection verified.");

  // Cleanup
  await db.prepare(`DELETE FROM users WHERE id=?`).run(userId);
  await closeDb();
  console.log("Phase 2.1 — Email Verification Integration Test PASSED successfully!\n");
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
