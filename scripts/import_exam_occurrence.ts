import fs from "node:fs";
import { getDb } from "../db/database.js";

/** Import VERIFIED prior-exam occurrence metadata.
 * CSV: question_id,occurrence_count,basis
 * Do not label original generated questions as having appeared on real exams.
 */
const file = process.argv[2];
if (!file) throw new Error("Usage: npm run questions:occurrence -- path/to/occurrence.csv");
const lines=fs.readFileSync(file,"utf8").split(/\r?\n/).filter(Boolean);
if(lines.length<2) throw new Error("CSV is empty");
const db=getDb();
let updated=0, missing=0;
const tx=db.transaction(async (txDb)=>{
  for(const line of lines.slice(1)) {
    const parts=line.match(/^([^,]+),([^,]+),(.*)$/);
    if(!parts) continue;
    const [,id,count,basis]=parts;
    const result=await txDb.prepare(`UPDATE questions SET previous_exam_occurrence_count=?, previous_exam_occurrence_basis=?, updated_at=datetime('now') WHERE id=?`).run(Number(count),basis.replace(/^"|"$/g,''),id.trim());
    if(result.changes) updated++; else missing++;
  }
});
await tx();
console.log(`Updated ${updated} question records; ${missing} question IDs were not found.`);
