/**
 * One-shot production bootstrap, run on every deploy BEFORE the web server starts:
 *   1. applies the (idempotent) database schema
 *   2. creates/updates the admin account if ADMIN_EMAIL + ADMIN_PASSWORD are set
 * Safe to run repeatedly.
 */
import "dotenv/config";
import "./migrate.js";
import { getDb, closeDb } from "../db/database.js";
import { hashPassword, newId } from "../web/auth.js";

// migrate.ts applies the schema at import time (top-level await), so it is done here.
const db = getDb();

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (email && password) {
  if (password.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters.");
  const existing = (await db.prepare(`SELECT id FROM users WHERE email=?`).get(email)) as any;
  if (existing) {
    // Only make sure the account is an active admin; don't reset a password you've since changed in the app.
    await db.prepare(`UPDATE users SET role='admin',status='active',email_verified=true WHERE id=?`).run(existing.id);
    console.log("Admin account present:", email);
  } else {
    await db.prepare(`INSERT INTO users (id,email,password_hash,name,role,email_verified) VALUES (?,?,?,?,?,?)`)
      .run(newId("usr"), email, hashPassword(password), process.env.ADMIN_NAME || "Admin", "admin", true);
    console.log("Created admin account:", email);
  }
} else {
  console.log("ADMIN_EMAIL/ADMIN_PASSWORD not set - skipping admin creation.");
}

await closeDb();
process.exit(0);
