import { getDb } from "../db/database.js";
const db=getDb();
const map: Record<string,string> = {
  'math.algebra.linear_equations':'Algebra',
  'math.algebra.systems_of_equations':'Algebra',
  'math.algebra.quadratics':'Advanced Math',
  'math.problem_solving.ratios':'Problem-Solving and Data Analysis',
  'reading_writing.rhetoric.command_of_evidence':'Information and Ideas',
  'reading_writing.grammar.subject_verb_agreement':'Standard English Conventions',
  'reading_writing.vocabulary.words_in_context':'Craft and Structure',
};
const tier=(d:string)=>['Algebra','Advanced Math','Craft and Structure'].includes(d)?'very_common':['Information and Ideas','Standard English Conventions'].includes(d)?'common':'moderate';
const tx=db.transaction(async (txDb)=>{ for(const [skill,domain] of Object.entries(map)) await txDb.prepare(`UPDATE questions SET domain=?, frequency_tier=?, updated_at=datetime('now') WHERE skill=? AND (domain IS NULL OR domain='')`).run(domain,tier(domain),skill); }); await tx();
console.log('Backfilled metadata for existing seed questions.');
