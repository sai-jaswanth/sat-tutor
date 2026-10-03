import crypto from "node:crypto";
import { getDb } from "../db/database.js";

const ITERATIONS = 120_000;
const KEYLEN = 32;
const DIGEST = "sha256";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function scryptHash(password: string, salt: Buffer) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString("hex");
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  return `pbkdf2$${ITERATIONS}$${salt.toString("hex")}$${scryptHash(password, salt)}`;
}

export function verifyPassword(password: string, stored: string) {
  const [prefix, iterations, saltHex, digest] = stored.split("$");
  if (prefix !== "pbkdf2" || !iterations || !saltHex || !digest) return false;
  const salt = Buffer.from(saltHex, "hex");
  const calculated = crypto.pbkdf2Sync(password, salt, Number(iterations), KEYLEN, DIGEST).toString("hex");
  const a = Buffer.from(calculated, "hex");
  const b = Buffer.from(digest, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function createSession(userId: string, ipAddress?: string | null, userAgent?: string | null) {
  const db = getDb();
  const id = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO sessions (id, user_id, ip_address, user_agent, last_active_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, ipAddress || null, userAgent || null, now, expires);
  return { id, expires };
}

const VERIFICATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

export async function createVerificationToken(userId: string) {
  const db = getDb();
  // Invalidate any existing verification tokens for this user
  await db.prepare(`DELETE FROM email_verification_tokens WHERE user_id=?`).run(userId);
  const id = newId("evt");
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString();
  await db.prepare(
    `INSERT INTO email_verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`
  ).run(id, userId, token, expiresAt);
  return { id, token, expiresAt };
}

export async function verifyEmailToken(token: string) {
  if (!token) return { success: false, error: "Verification token is required" };
  const db = getDb();
  const row = await db.prepare(
    `SELECT evt.*, u.id as user_id, u.email, u.email_verified 
     FROM email_verification_tokens evt 
     JOIN users u ON u.id = evt.user_id 
     WHERE evt.token = ?`
  ).get(token) as any;

  if (!row) {
    return { success: false, error: "Invalid or expired verification token" };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare(`DELETE FROM email_verification_tokens WHERE id=?`).run(row.id);
    return { success: false, error: "Verification token has expired. Please request a new verification email." };
  }

  await db.prepare(`UPDATE users SET email_verified=true, updated_at=datetime('now') WHERE id=?`).run(row.user_id);
  await db.prepare(`DELETE FROM email_verification_tokens WHERE id=?`).run(row.id);

  return { success: true, userId: row.user_id, email: row.email };
}

const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60; // 1 hour

export async function createPasswordResetToken(userId: string) {
  const db = getDb();
  await db.prepare(`DELETE FROM password_reset_tokens WHERE user_id=?`).run(userId);
  const id = newId("prt");
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  await db.prepare(
    `INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`
  ).run(id, userId, token, expiresAt);
  return { id, token, expiresAt };
}

const COMMON_WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "admin123", "admin1234", "letmein123", "welcome123", "changeme123"
]);

export interface PasswordStrengthResult {
  valid: boolean;
  score: number; // 0 to 4
  errors: string[];
  rules: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
    notCommon: boolean;
  };
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const pwd = String(password || "");
  const errors: string[] = [];

  const minLength = pwd.length >= 8;
  const hasUppercase = /[A-Z]/.test(pwd);
  const hasLowercase = /[a-z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd);
  const notCommon = !COMMON_WEAK_PASSWORDS.has(pwd.toLowerCase().trim());

  if (!minLength) errors.push("Be at least 8 characters long");
  if (!hasUppercase) errors.push("Contain at least one uppercase letter (A-Z)");
  if (!hasLowercase) errors.push("Contain at least one lowercase letter (a-z)");
  if (!hasNumber) errors.push("Contain at least one number (0-9)");
  if (!hasSpecial) errors.push("Contain at least one special character (!@#$%^&*)");
  if (!notCommon) errors.push("Avoid using easily guessable common passwords");

  let score = 0;
  if (minLength) score++;
  if (hasUppercase && hasLowercase) score++;
  if (hasNumber) score++;
  if (hasSpecial) score++;
  if (!notCommon) score = Math.max(0, score - 2);

  const valid = errors.length === 0;

  return {
    valid,
    score,
    errors,
    rules: { minLength, hasUppercase, hasLowercase, hasNumber, hasSpecial, notCommon },
  };
}

export async function resetPasswordWithToken(token: string, newPassword: string) {
  if (!token) return { success: false, error: "Reset token is required" };
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    return { success: false, error: `Password requirements not met: ${strength.errors.join("; ")}` };
  }
  const db = getDb();
  const row = await db.prepare(
    `SELECT prt.*, u.id as user_id, u.email 
     FROM password_reset_tokens prt 
     JOIN users u ON u.id = prt.user_id 
     WHERE prt.token = ?`
  ).get(token) as any;

  if (!row) {
    return { success: false, error: "Invalid or expired password reset link" };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare(`DELETE FROM password_reset_tokens WHERE id=?`).run(row.id);
    return { success: false, error: "Password reset link has expired. Please request a new one." };
  }

  const hashed = hashPassword(newPassword);
  await db.prepare(
    `UPDATE users SET password_hash=?, email_verified=true, updated_at=datetime('now') WHERE id=?`
  ).run(hashed, row.user_id);

  // Consume reset token
  await db.prepare(`DELETE FROM password_reset_tokens WHERE id=?`).run(row.id);

  // Security: Revoke all existing sessions for this user so old sessions cannot be hijacked
  await db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(row.user_id);

  return { success: true, userId: row.user_id, email: row.email };
}

const SESSION_INACTIVITY_MS = 1000 * 60 * 60 * 24; // 24 hours

export async function getUserBySession(sessionId?: string | null) {
  if (!sessionId) return null;
  const db = getDb();
  const row = await db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.status, u.email_verified, 
           s.id AS session_id, s.ip_address, s.user_agent, s.last_active_at, s.created_at, s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.expires_at > datetime('now')
  `).get(sessionId) as any;
  if (!row || row.status !== "active") return null;

  // Check 24-hour inactivity timeout
  if (row.last_active_at) {
    const lastActiveTime = new Date(row.last_active_at).getTime();
    if (Date.now() - lastActiveTime > SESSION_INACTIVITY_MS) {
      await db.prepare(`DELETE FROM sessions WHERE id=?`).run(sessionId);
      return null;
    }
  }

  // Sliding session activity update
  await db.prepare(`UPDATE sessions SET last_active_at=datetime('now') WHERE id=?`).run(sessionId);

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: row.email_verified === true || row.email_verified === 1 || row.email_verified === "t",
    sessionId: row.session_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function listUserSessions(userId: string, currentSessionId?: string) {
  const db = getDb();
  const rows = await db.prepare(`
    SELECT id, ip_address, user_agent, last_active_at, created_at, expires_at
    FROM sessions
    WHERE user_id=? AND expires_at > datetime('now')
    ORDER BY last_active_at DESC
  `).all(userId) as any[];

  return rows.map(r => ({
    id: r.id,
    ipAddress: r.ip_address || "Unknown IP",
    userAgent: r.user_agent || "Unknown Device",
    lastActiveAt: r.last_active_at,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    isCurrent: r.id === currentSessionId,
  }));
}

export async function revokeUserSession(userId: string, targetSessionId: string) {
  const db = getDb();
  const res = await db.prepare(`DELETE FROM sessions WHERE id=? AND user_id=?`).run(targetSessionId, userId);
  return res.changes > 0;
}

export async function revokeAllUserSessions(userId: string, keepSessionId?: string) {
  const db = getDb();
  if (keepSessionId) {
    await db.prepare(`DELETE FROM sessions WHERE user_id=? AND id != ?`).run(userId, keepSessionId);
  } else {
    await db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(userId);
  }
  return true;
}

export async function destroySession(sessionId?: string | null) {
  if (!sessionId) return;
  getDb().prepare(`DELETE FROM sessions WHERE id=?`).run(sessionId);
}

export async function purgeSessions() {
  getDb().prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
}

export async function deleteUserAccount(userId: string, passwordConfirm: string) {
  if (!userId) return { success: false, error: "User ID is required" };
  if (!passwordConfirm) return { success: false, error: "Password confirmation is required" };

  const db = getDb();
  const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as any;
  if (!user) return { success: false, error: "User not found" };

  if (!verifyPassword(passwordConfirm, user.password_hash)) {
    return { success: false, error: "Incorrect password. Account deletion canceled." };
  }

  const tx = db.transaction(async (txDb) => {
    // 1. Find student row if exists
    const student = await txDb.prepare(`SELECT id FROM students WHERE user_id=?`).get(userId) as any;
    if (student) {
      await txDb.prepare(`DELETE FROM students WHERE id=?`).run(student.id);
    }
    // 2. Delete tokens & sessions & feedback
    await txDb.prepare(`DELETE FROM sessions WHERE user_id=?`).run(userId);
    await txDb.prepare(`DELETE FROM email_verification_tokens WHERE user_id=?`).run(userId);
    await txDb.prepare(`DELETE FROM password_reset_tokens WHERE user_id=?`).run(userId);
    await txDb.prepare(`DELETE FROM feedback WHERE user_id=?`).run(userId);
    // 3. Delete user row
    await txDb.prepare(`DELETE FROM users WHERE id=?`).run(userId);
  });

  await tx();
  return { success: true };
}

