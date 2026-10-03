import { getDb, closeDb } from "../db/database.js";
import { hashPassword, createSession, getUserBySession, listUserSessions, revokeUserSession, revokeAllUserSessions } from "../web/auth.js";
import { newId } from "../web/auth.js";

async function runTest() {
  console.log("Starting Phase 2.4 — Session Expiration & Revocation Integration Test...");
  const db = getDb();
  const testEmail = `test_session_${Date.now()}@example.com`;
  const userId = newId("usr_test");

  // 1. Ensure table structure is active
  await db.prepare(`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address text;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT CURRENT_TIMESTAMP;
  `).run();

  // 2. Create test user
  await db.prepare(
    `INSERT INTO users (id, email, password_hash, name, email_verified) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, testEmail, hashPassword("SecurePass123!"), "Session Test User", true);
  console.log("✓ Test user created.");

  // 3. Create 3 sessions with distinct device metadata
  const s1 = await createSession(userId, "192.168.1.10", "Desktop Chrome / Windows 11");
  const s2 = await createSession(userId, "10.0.0.45", "Mobile Safari / iOS 17");
  const s3 = await createSession(userId, "172.16.0.2", "Tablet Firefox / Android 14");
  console.log("✓ Created 3 distinct multi-device sessions with IP and User-Agent metadata.");

  // 4. List user sessions and verify current indicator & metadata
  const activeSessions = await listUserSessions(userId, s1.id);
  if (activeSessions.length !== 3) throw new Error(`Expected 3 active sessions, got ${activeSessions.length}`);

  const currentS = activeSessions.find(s => s.id === s1.id);
  if (!currentS || !currentS.isCurrent) throw new Error("Current session marker is incorrect");
  if (!currentS.userAgent.includes("Desktop Chrome")) throw new Error("User agent metadata missing");
  console.log("✓ Multi-device session list verified.");

  // 5. Test revoking a specific session (Device 2 / Mobile Safari)
  const revokeResult = await revokeUserSession(userId, s2.id);
  if (!revokeResult) throw new Error("Failed to revoke specific session");

  const s2Lookup = await getUserBySession(s2.id);
  if (s2Lookup !== null) throw new Error("Revoked session still authenticated!");
  console.log("✓ Revoked individual session successfully.");

  // 6. Test revoking all other sessions except current (Keep s1, Revoke s3)
  await revokeAllUserSessions(userId, s1.id);

  const s1Lookup = await getUserBySession(s1.id);
  if (!s1Lookup) throw new Error("Current session was incorrectly revoked during revoke-all!");

  const s3Lookup = await getUserBySession(s3.id);
  if (s3Lookup !== null) throw new Error("Remote session was not revoked during revoke-all!");
  console.log("✓ Revoked all other sessions except current device successfully.");

  // 7. Test 24-hour inactivity timeout invalidation
  const staleSession = await createSession(userId, "127.0.0.1", "Stale Device");
  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await db.prepare(`UPDATE sessions SET last_active_at=? WHERE id=?`).run(twentyFiveHoursAgo, staleSession.id);

  const staleLookup = await getUserBySession(staleSession.id);
  if (staleLookup !== null) throw new Error("Inactivity-expired session (25h) was allowed to authenticate!");
  console.log("✓ 24-hour sliding inactivity timeout correctly invalidated stale session.");

  // Cleanup
  await db.prepare(`DELETE FROM users WHERE id=?`).run(userId);
  await closeDb();
  console.log("Phase 2.4 — Session Expiration & Revocation Integration Test PASSED successfully!\n");
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
