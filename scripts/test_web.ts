import { getDb, closeDb } from "../db/database.js";
import { hashPassword, verifyPassword, createSession, getUserBySession, destroySession } from "../web/auth.js";
import { newId } from "../web/auth.js";
const db=getDb();
const userId=newId('test');
await db.prepare(`INSERT INTO users (id,email,password_hash,name) VALUES (?,?,?,?)`).run(userId,`${userId}@example.com`,hashPassword('TestPass123'),'Test User');
if(!verifyPassword('TestPass123',(await db.prepare(`SELECT password_hash FROM users WHERE id=?`).get(userId) as any).password_hash)) throw new Error('password verification failed');
const s=await createSession(userId); const u=await getUserBySession(s.id); if(!u||u.id!==userId) throw new Error('session lookup failed'); await destroySession(s.id); if(await getUserBySession(s.id)) throw new Error('session destroy failed');
await db.prepare(`DELETE FROM users WHERE id=?`).run(userId); await closeDb(); console.log('web auth smoke test passed');
