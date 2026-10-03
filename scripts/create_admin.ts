import { getDb } from "../db/database.js";
import { hashPassword, newId } from "../web/auth.js";
const email=process.argv[2], password=process.argv[3], name=process.argv.slice(4).join(' ') || 'Admin';
if(!email || !password || password.length<8){ console.error('Usage: npm run admin:create -- admin@example.com StrongPassword "Admin Name"'); process.exit(1); }
const db=getDb(); const existing=await db.prepare(`SELECT id FROM users WHERE email=?`).get(email) as any;
if(existing){ await db.prepare(`UPDATE users SET role='admin',status='active',password_hash=?,name=? WHERE id=?`).run(hashPassword(password),name,existing.id); console.log('Updated existing user to admin:',email); }
else { const id=newId('usr'); await db.prepare(`INSERT INTO users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)`).run(id,email,hashPassword(password),name,'admin'); console.log('Created admin:',email); }
