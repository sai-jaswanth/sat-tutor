import { getDb } from "../db/database.js";
const db=getDb();
const rows=await db.prepare(`SELECT section,domain,frequency_tier,difficulty,COUNT(*) count FROM questions GROUP BY section,domain,frequency_tier,difficulty ORDER BY section,domain,difficulty`).all() as any[];
for(const r of rows) console.log(`${r.section}\t${r.domain}\t${r.frequency_tier}\tdifficulty=${r.difficulty}\t${r.count}`);
const totals=await db.prepare(`SELECT section,COUNT(*) count FROM questions GROUP BY section`).all();
console.log("\nTotals:",totals);
