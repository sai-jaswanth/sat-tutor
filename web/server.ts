import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import { getDb } from "../db/database.js";
import { createSession, createVerificationToken, createPasswordResetToken, deleteUserAccount, destroySession, getUserBySession, hashPassword, listUserSessions, newId, purgeSessions, resetPasswordWithToken, revokeAllUserSessions, revokeUserSession, validatePasswordStrength, verifyEmailToken, verifyPassword } from "./auth.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email.js";
import { TutorAgent } from "../agent/orchestrator.js";
import { evaluate as mathEvaluate } from "mathjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.resolve(process.cwd(), "public"); // run from the project root (WORKDIR /app in Docker)
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const isProd = process.env.NODE_ENV === "production";
const TRUST_PROXY = process.env.TRUST_PROXY !== "false"; // hosts like Render/Railway/Fly sit behind a proxy
const APP_BASE_URL = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
const REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION !== "false";
const MAX_TUTOR_AGENTS = Number(process.env.MAX_TUTOR_AGENTS || 20);
const rate = new Map<string, { count: number; resetAt: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of rate) if (v.resetAt <= now) rate.delete(k); }, 60_000).unref();

function clientIp(req: http.IncomingMessage) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || "unknown";
}
function publicBaseUrl(req: http.IncomingMessage) {
  if (APP_BASE_URL) return APP_BASE_URL;
  const proto = TRUST_PROXY ? String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim() : "http";
  return `${proto}://${req.headers.host || "localhost:3000"}`;
}
function securityHeaders(res: http.ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
function parseCookies(req: http.IncomingMessage) {
  const out: Record<string,string> = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function setCookie(res: http.ServerResponse, name: string, value: string, maxAgeSeconds: number) {
  const secure = isProd ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict${secure}`);
}
async function body(req: http.IncomingMessage) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) throw new Error("Payload too large"); }
  if (!raw) return {};
  return JSON.parse(raw);
}
async function requireAuth(req: http.IncomingMessage, res: http.ServerResponse) {
  const user = await getUserBySession(parseCookies(req).sat_session);
  if (!user) { json(res, 401, { error: "Authentication required" }); return null; }
  return user;
}
async function requireAdmin(req: http.IncomingMessage, res: http.ServerResponse) {
  const user = await requireAuth(req,res); if (!user) return null;
  if (user.role !== "admin") { json(res, 403, { error: "Admin access required" }); return null; }
  return user;
}
function allowRate(key: string, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const old = rate.get(key);
  if (!old || old.resetAt <= now) { rate.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (old.count >= limit) return false;
  old.count++; return true;
}
async function studentForUser(userId: string) {
  const db = getDb();
  let s = await db.prepare(`SELECT * FROM students WHERE user_id=?`).get(userId) as any;
  if (!s) {
    const u = await db.prepare(`SELECT name FROM users WHERE id=?`).get(userId) as any;
    const id = newId("stu");
    await db.prepare(`INSERT INTO students (id,user_id,name) VALUES (?,?,?)`).run(id,userId,u?.name || "Student");
    s = await db.prepare(`SELECT * FROM students WHERE id=?`).get(id);
  }
  return s as any;
}
async function audit(actorUserId: string, action: string, entityType: string, entityId: string | null, metadata?: any) {
  await getDb().prepare(`INSERT INTO audit_logs (actor_user_id,action,entity_type,entity_id,metadata_json) VALUES (?,?,?,?,?)`).run(actorUserId,action,entityType,entityId,metadata ? JSON.stringify(metadata): null);
}
function sendStatic(res: http.ServerResponse, pathname: string) {
  let file = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (file.includes("..") || file.includes("\0")) return json(res,404,{error:"Not found"});
  let p = path.join(PUBLIC,file);
  const exists = fs.existsSync(p) && !fs.statSync(p).isDirectory();
  // Email links (/verify-email, /reset-password) and deep links are handled by the single-page app.
  if (!exists) {
    if (path.extname(file)) return json(res,404,{error:"Not found"});
    p = path.join(PUBLIC,"index.html");
  }
  const ext = path.extname(p);
  const ct: Record<string,string> = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon", ".json":"application/json" };
  res.writeHead(200,{"content-type":ct[ext]||"application/octet-stream","cache-control": ext===".html" ? "no-cache" : "public, max-age=3600"}); fs.createReadStream(p).pipe(res);
}
function cleanQuestion(row:any, reveal=false) {
  const q:any = { id:row.id, section:row.section, skill:row.skill, difficulty:row.difficulty, stem:row.stem, choices:row.choices_json ? JSON.parse(row.choices_json):null, answer_type:row.answer_type, domain:row.domain, frequency_tier:row.frequency_tier, previous_exam_occurrence_count:row.previous_exam_occurrence_count, previous_exam_occurrence_basis:row.previous_exam_occurrence_basis, concept_tags:row.concept_tags_json ? JSON.parse(row.concept_tags_json):[], source:row.source };
  if (reveal) { q.correct_answer=row.correct_answer; q.explanation=row.explanation; }
  return q;
}
async function selectNext(studentId:string, skill?:string, section?:string, exclude:string[] = [], domain?:string, difficulty?:number, frequency?:string) {
  const db = getDb(); let targetSkill = skill; let ability = 500;
  if (!targetSkill) {
    const due = await db.prepare(`SELECT skill,ability FROM mastery WHERE student_id=? AND sr_due_at <= datetime('now') ORDER BY sr_due_at ASC LIMIT 1`).get(studentId) as any;
    if (due) { targetSkill=due.skill; ability=due.ability; }
    else { const weak=await db.prepare(`SELECT skill,ability FROM mastery WHERE student_id=? ORDER BY ability ASC LIMIT 1`).get(studentId) as any; if (weak && !domain && !difficulty && !frequency && !section) { targetSkill=weak.skill; ability=weak.ability; } }
  } else { const m=await db.prepare(`SELECT ability FROM mastery WHERE student_id=? AND skill=?`).get(studentId,targetSkill) as any; ability=m?.ability??500; }
  const targetDifficulty=difficulty || Math.min(5,Math.max(1,Math.round(((ability+40)-200)/160)));
  let sql=`SELECT * FROM questions WHERE validated=1 AND status='approved'`; const params:any[]=[];
  if (targetSkill) { sql+=` AND skill=?`; params.push(targetSkill); }
  if (section) { sql+=` AND section=?`; params.push(section); }
  if (domain) { sql+=` AND domain=?`; params.push(domain); }
  if (frequency) { sql+=` AND frequency_tier=?`; params.push(frequency); }
  if (exclude.length) { sql+=` AND id NOT IN (${exclude.map(()=>'?').join(',')})`; params.push(...exclude); }
  sql+=` ORDER BY ABS(difficulty-?) ASC, RANDOM() LIMIT 1`; params.push(targetDifficulty);
  let row=await db.prepare(sql).get(...params) as any;
  // If a very specific filter combination has no result, relax only the adaptive skill
  // rather than returning a misleading error. This keeps topic filters usable.
  if (!row && targetSkill && (domain || difficulty || frequency || section)) {
    let fallback=`SELECT * FROM questions WHERE validated=1 AND status='approved' AND skill=?`; const fp:any[]=[targetSkill];
    if (section) { fallback+=` AND section=?`; fp.push(section); }
    if (domain) { fallback+=` AND domain=?`; fp.push(domain); }
    if (frequency) { fallback+=` AND frequency_tier=?`; fp.push(frequency); }
    if (exclude.length) { fallback+=` AND id NOT IN (${exclude.map(()=>'?').join(',')})`; fp.push(...exclude); }
    fallback+=` ORDER BY ABS(difficulty-?) ASC, RANDOM() LIMIT 1`; fp.push(targetDifficulty);
    row=await db.prepare(fallback).get(...fp) as any;
  }
  if (!row) return null;
  return { selection_reasoning:{targetSkill,studentAbility:ability,targetDifficulty,filters:{section,domain,difficulty,frequency}}, question:cleanQuestion(row,false) };
}

function hintForQuestion(row:any, level:number) {
  const clean = String(row.explanation || '').replace(/\s+/g,' ').trim();
  const stem = String(row.stem || '').replace(/\s+/g,' ').trim();
  if (level === 1) return {level:1,text:`Identify exactly what the question is asking, then write down the key relationship, rule, or quantity you need. ${stem.length>140?'Focus on the final sentence of the question.':''}`};
  if (level === 2) return {level:2,text:`Set up the problem before calculating. Look for the information that connects directly to the target; avoid choices that require assumptions the question never gives.`};
  return {level:3,text:`Use the governing rule or setup behind the solution. ${clean ? `Your next step should move toward the idea used in the explanation: ${clean.slice(0,180)}${clean.length>180?'…':''}` : 'Work backward from what the answer must represent.'}`};
}

function isPlaceholderExplanation(explanation:string) {
  return !explanation || /source answer key:|does not include a question-level explanation/i.test(explanation);
}

function isUnsolvableExplanation(explanation:string) {
  return /cannot be solved|cannot be determined|not enough information|garbled wording|unreadable|incomplete (?:question|prompt|stem|expression)|necessary information is missing|does not specify the (?:relationship|value|measure)/i.test(explanation);
}

async function generateQuestionExplanations(questions:any[]) {
  if (!process.env.GROQ_API_KEY) throw new Error('Question explanations require GROQ_API_KEY.');
  const result:Record<string,string> = {};
  for (const question of questions) {
    if (!isPlaceholderExplanation(String(question.explanation || ''))) result[String(question.id)] = question.explanation;
  }
  const pending = questions.filter(question => isPlaceholderExplanation(String(question.explanation || '')));
  const requestExplanations = async (chunk:any[], rateRetries=0):Promise<Map<string,string>> => {
    const input = chunk.map(question => ({
      id: question.id,
      section: question.section,
      skill: question.skill,
      stem: question.stem,
      choices: question.choices_json ? JSON.parse(question.choices_json) : question.choices,
      answer_type: question.answer_type,
      correct_answer: question.correct_answer,
    }));
    const response = await fetch(`${process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        temperature: 0.1,
        max_tokens: 1800,
        messages: [
          { role: 'system', content: 'You are an SAT answer-explanation writer. Explain each supplied item using only its question, choices, and official answer key. For reading questions, identify the textual evidence or logical fit. For math, show the essential setup and steps, checking arithmetic carefully. Never invent missing visual data or assume unreadable symbols; if an item is not solvable from its text, say exactly what is missing. Return JSON only, with an explanations array of objects containing id and a concise 2-4 sentence explanation.' },
          { role: 'user', content: JSON.stringify({ questions: input }) },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      if (response.status===429 && rateRetries<2) {
        const retrySeconds=Number(response.headers.get('retry-after'))||Number(raw.match(/try again in ([\d.]+)s/i)?.[1])||10;
        await new Promise(resolve=>setTimeout(resolve,Math.ceil(retrySeconds*1000)+250));
        return requestExplanations(chunk,rateRetries+1);
      }
      if (response.status===429) throw new Error('Question explanations are temporarily rate limited. Retry this review in about one minute.');
      if (chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        const first = await requestExplanations(chunk.slice(0,middle));
        const second = await requestExplanations(chunk.slice(middle));
        return new Map([...first,...second]);
      }
      throw new Error(`Explanation service returned ${response.status}: ${raw.slice(0, 300)}`);
    }
    let generated:any;
    try {
      const payload = JSON.parse(raw);
      const content = String(payload.choices?.[0]?.message?.content || '');
      const jsonText = content.match(/\{[\s\S]*\}/)?.[0];
      generated = jsonText ? JSON.parse(jsonText) : {};
    } catch { generated = {}; }
    const byId = new Map<string,string>((generated.explanations || []).map((item:any) => [String(item.id), String(item.explanation || '').trim()] as [string,string]));
    if (chunk.length > 1 && chunk.some(question => !byId.has(String(question.id)))) {
      const middle = Math.ceil(chunk.length / 2);
      const first = await requestExplanations(chunk.slice(0,middle));
      const second = await requestExplanations(chunk.slice(middle));
      return new Map([...first,...second]);
    }
    return byId;
  };
  for (let offset=0; offset<pending.length; offset+=8) {
    const chunk = pending.slice(offset,offset+8);
    const byId=await requestExplanations(chunk);
    for (const question of chunk) {
      let explanation = byId.get(String(question.id)) || '';
      const needsReview = !explanation || explanation.length < 25 || isPlaceholderExplanation(explanation) || isUnsolvableExplanation(explanation);
      if (needsReview) {
        explanation = explanation && explanation.length >= 25 && !isPlaceholderExplanation(explanation)
          ? `${explanation} This item has been removed from future practice and flagged for review.`
          : 'The imported question or answer choices are incomplete, so a reliable explanation cannot be generated. This item has been removed from future practice and flagged for review.';
        await getDb().prepare(`UPDATE questions SET explanation=?,status='human_review',validated=0 WHERE id=?`).run(explanation, question.id);
      } else {
        await getDb().prepare(`UPDATE questions SET explanation=? WHERE id=?`).run(explanation, question.id);
      }
      result[String(question.id)] = explanation;
    }
  }
  return result;
}

async function grade(questionId:string, answer:string) {
  const db=getDb(); const row=await db.prepare(`SELECT * FROM questions WHERE id=?`).get(questionId) as any; if(!row) throw new Error("Question not found");
  let correct=false;
  if(row.answer_type==='mcq') correct=answer.trim().toUpperCase().replace(/[.)]/g,"")===String(row.correct_answer).trim().toUpperCase();
  else { try { const a=Number(mathEvaluate(answer)); const b=Number(mathEvaluate(row.correct_answer)); correct=Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-6; } catch { correct=answer.trim()===String(row.correct_answer).trim(); } }
  return { questionId, studentAnswer:answer, isCorrect:correct, correctAnswer:row.correct_answer, explanation:row.explanation, skill:row.skill, difficulty:row.difficulty };
}
async function logAttempt(studentId:string, q:any, g:any, timeSeconds?:number, hintsUsed=0, mistakeType?:string) {
  const db=getDb(); const tx=db.transaction(async (txDb)=>{
    await txDb.prepare(`INSERT INTO attempts (student_id,question_id,student_answer,is_correct,time_seconds,hints_used,mistake_type) VALUES (?,?,?,?,?,?,?)`).run(studentId,q.id,g.studentAnswer,g.isCorrect?1:0,timeSeconds??null,hintsUsed,mistakeType??null);
    const existing=await txDb.prepare(`SELECT * FROM mastery WHERE student_id=? AND skill=?`).get(studentId,q.skill) as any;
    const priorAbility=existing?.ability??500, priorAttempts=existing?.attempts??0;
    const opponent=200+q.difficulty*160; const expected=1/(1+Math.pow(10,(opponent-priorAbility)/400)); const k=Math.max(8,40-priorAttempts);
    const newAbility=priorAbility+k*((g.isCorrect?1:0)-expected);
    let ease=existing?.sr_ease??2.5; let interval=existing?.sr_interval_days??1;
    if(g.isCorrect){ interval=existing?Math.round(interval*ease*10)/10:1; ease=Math.min(3,ease+0.05);} else { interval=1; ease=Math.max(1.3,ease-0.2); }
    const due=new Date(); due.setDate(due.getDate()+Math.ceil(interval));
    const newAttempts=priorAttempts+1, newCorrect=(existing?.correct??0)+(g.isCorrect?1:0); const priorAvg=existing?.avg_time_seconds??0;
    const avg=timeSeconds!=null?(priorAvg*priorAttempts+timeSeconds)/newAttempts:priorAvg;
    await txDb.prepare(`INSERT INTO mastery (student_id,skill,ability,attempts,correct,avg_time_seconds,last_attempt_at,sr_interval_days,sr_ease,sr_due_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(student_id,skill) DO UPDATE SET ability=excluded.ability,attempts=excluded.attempts,correct=excluded.correct,avg_time_seconds=excluded.avg_time_seconds,last_attempt_at=excluded.last_attempt_at,sr_interval_days=excluded.sr_interval_days,sr_ease=excluded.sr_ease,sr_due_at=excluded.sr_due_at`).run(studentId,q.skill,Math.round(newAbility*10)/10,newAttempts,newCorrect,Math.round(avg*10)/10,new Date().toISOString(),interval,ease,due.toISOString());
    return {newAbility:Math.round(newAbility*10)/10,newAttempts,newCorrect,nextReviewAt:due.toISOString(),intervalDays:interval};
  });
  return await tx();
}

// ---------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------
async function listBookmarks(studentId:string) {
  const db=getDb();
  return await db.prepare(`SELECT b.question_id,b.note,b.created_at,q.section,q.domain,q.skill,q.difficulty,q.stem,q.frequency_tier
    FROM bookmarks b JOIN questions q ON q.id=b.question_id WHERE b.student_id=? ORDER BY b.created_at DESC`).all(studentId);
}

// ---------------------------------------------------------------------
// Mistake review: most recent attempt per question, filtered to incorrect,
// so a question the student later got right drops off the review list.
// ---------------------------------------------------------------------
async function listMistakes(studentId:string) {
  const db=getDb();
  return await db.prepare(`
    SELECT q.id question_id,q.section,q.domain,q.skill,q.difficulty,q.stem,q.frequency_tier,
           a.student_answer,a.created_at,a.mistake_type,
           (SELECT COUNT(*) FROM attempts a2 WHERE a2.student_id=a.student_id AND a2.question_id=a.question_id) attempt_count
    FROM attempts a
    JOIN questions q ON q.id=a.question_id
    WHERE a.student_id=? AND a.is_correct=0
      AND a.id = (SELECT MAX(a3.id) FROM attempts a3 WHERE a3.student_id=a.student_id AND a3.question_id=a.question_id)
    ORDER BY a.created_at DESC LIMIT 100
  `).all(studentId);
}

// ---------------------------------------------------------------------
// Full-length / diagnostic / section practice tests. Reuses the same
// deterministic grading + mastery pipeline as regular practice — the AI
// tutor and admin never determine correctness or scores here either.
// ---------------------------------------------------------------------
const TEST_MODES: Record<string, { modules: Array<{ module:string; section:string; count:number; minutes:number }> }> = {
  diagnostic: { modules: [{ module:"diagnostic", section:"mixed", count:24, minutes:35 }] },
  full: { modules: [
    { module:"reading_writing_1", section:"reading_writing", count:27, minutes:32 },
    { module:"reading_writing_2", section:"reading_writing", count:27, minutes:32 },
    { module:"math_1", section:"math", count:22, minutes:35 },
    { module:"math_2", section:"math", count:22, minutes:35 },
  ]},
  math: { modules: [
    { module:"math_1", section:"math", count:22, minutes:35 },
    { module:"math_2", section:"math", count:22, minutes:35 },
  ]},
  reading_writing: { modules: [
    { module:"reading_writing_1", section:"reading_writing", count:27, minutes:32 },
    { module:"reading_writing_2", section:"reading_writing", count:27, minutes:32 },
  ]},
};

async function buildPracticeTest(studentId:string, mode:string) {
  const db=getDb();
  const cfg = TEST_MODES[mode];
  if (!cfg) throw new Error(`Unknown test mode '${mode}'`);
  const id = newId('test');
  const items: Array<{question_id:string; order_index:number; module:string}> = [];
  let orderIndex=0;
  for (const mod of cfg.modules) {
    let rows: any[];
    if (mod.section === "mixed") {
      // Diagnostic: spread across every skill so the very first assessment
      // touches the whole content domain, not just whatever the student
      // happened to practice already.
      const skills = await db.prepare(`SELECT DISTINCT skill FROM questions WHERE status='approved' AND validated=1`).all() as any[];
      const perSkill = Math.max(1, Math.floor(mod.count / Math.max(1,skills.length)));
      rows = [];
      for (const s of skills) {
        const picked = await db.prepare(`SELECT * FROM questions WHERE status='approved' AND validated=1 AND skill=? ORDER BY RANDOM() LIMIT ?`).all(s.skill, perSkill) as any[];
        rows.push(...picked);
      }
      if (rows.length < mod.count) {
        const more = await db.prepare(`SELECT * FROM questions WHERE status='approved' AND validated=1 AND id NOT IN (${rows.map(()=>'?').join(',') || "''"}) ORDER BY RANDOM() LIMIT ?`).all(...rows.map(r=>r.id), mod.count-rows.length) as any[];
        rows.push(...more);
      }
      rows = rows.slice(0, mod.count);
    } else {
      const usedIds = items.map(item => item.question_id);
      const excludeUsed = usedIds.length ? `AND id NOT IN (${usedIds.map(()=>'?').join(',')})` : '';
      rows = await db.prepare(`SELECT * FROM questions WHERE status='approved' AND validated=1 AND section=? ${excludeUsed} ORDER BY RANDOM() LIMIT ?`).all(mod.section, ...usedIds, mod.count) as any[];
    }
    for (const r of rows) items.push({ question_id:r.id, order_index:orderIndex++, module:mod.module });
  }
  const tx = db.transaction(async (txDb)=>{
    await txDb.prepare(`INSERT INTO practice_tests (id,student_id,config_json,status) VALUES (?,?,?,?)`).run(id,studentId,JSON.stringify({mode,modules:cfg.modules}),'in_progress');
    const ins = txDb.prepare(`INSERT INTO practice_test_items (test_id,question_id,order_index,module) VALUES (?,?,?,?)`);
    for (const it of items) await ins.run(id,it.question_id,it.order_index,it.module);
  });
  await tx();
  return await getPracticeTest(studentId,id);
}

async function getPracticeTest(studentId:string, testId:string) {
  const db=getDb();
  const test = await db.prepare(`SELECT * FROM practice_tests WHERE id=? AND student_id=?`).get(testId,studentId) as any;
  if (!test) return null;
  const items = await db.prepare(`SELECT pti.*, q.section,q.skill,q.difficulty,q.stem,q.choices_json,q.answer_type,q.domain,q.correct_answer,q.explanation
    FROM practice_test_items pti JOIN questions q ON q.id=pti.question_id WHERE pti.test_id=? ORDER BY pti.order_index ASC`).all(testId) as any[];
  const finished = test.status !== 'in_progress';
  return {
    id: test.id, status: test.status, config: JSON.parse(test.config_json), startedAt: test.started_at, finishedAt: test.finished_at, serverNow: new Date().toISOString(),
    score: test.score_json ? JSON.parse(test.score_json) : null,
    items: items.map(it => ({
      order_index: it.order_index, module: it.module, question_id: it.question_id,
      section: it.section, skill: it.skill, difficulty: it.difficulty, domain: it.domain,
      stem: it.stem, choices: it.choices_json ? JSON.parse(it.choices_json) : null, answer_type: it.answer_type,
      student_answer: it.student_answer, is_correct: finished ? !!it.is_correct : (it.student_answer!=null ? !!it.is_correct : null),
      correct_answer: finished ? it.correct_answer : null, explanation: finished ? it.explanation : null,
      time_seconds: it.time_seconds,
    })),
  };
}

// Rough raw-score -> scaled-score mapping (200-800 per section) so a
// finished test gives students a familiar-feeling number. This is a
// simple linear estimate for practice purposes, not an official
// concordance table.
function scaleSectionScore(correct:number,total:number) {
  if (total===0) return 200;
  const pct = correct/total;
  return Math.round(200 + pct*600);
}

async function finishPracticeTest(studentId:string, testId:string) {
  const db=getDb();
  const test = await db.prepare(`SELECT * FROM practice_tests WHERE id=? AND student_id=?`).get(testId,studentId) as any;
  if (!test) throw new Error('Test not found');
  if (test.status !== 'in_progress') return await getPracticeTest(studentId,testId);
  const items = await db.prepare(`SELECT pti.*, q.correct_answer,q.answer_type,q.skill,q.difficulty,q.explanation FROM practice_test_items pti JOIN questions q ON q.id=pti.question_id WHERE pti.test_id=?`).all(testId) as any[];
  const byModule: Record<string,{correct:number; total:number}> = {};
  const config = JSON.parse(test.config_json);
  const tx = db.transaction(async (txDb)=>{
    for (const it of items) {
      const section = config.modules.find((module:any) => module.module === it.module)?.section || it.module;
      byModule[section] = byModule[section] || {correct:0,total:0};
      byModule[section].total++;
      if (it.student_answer != null) {
        if (it.is_correct) byModule[section].correct++;
      }
    }
    const scoreByModule:Record<string,any> = {};
    let composite = 0;
    for (const [mod,agg] of Object.entries(byModule)) {
      const scaled = scaleSectionScore(agg.correct, agg.total);
      scoreByModule[mod] = { correct:agg.correct, total:agg.total, scaled };
      composite += scaled;
    }
    const score = { byModule: scoreByModule, composite: Object.keys(byModule).length>1 ? composite : undefined };
    await txDb.prepare(`UPDATE practice_tests SET status='finished', finished_at=datetime('now'), score_json=? WHERE id=?`).run(JSON.stringify(score),testId);
    if (config.mode === 'diagnostic') await txDb.prepare(`UPDATE students SET diagnostic_completed_at=datetime('now') WHERE id=?`).run(studentId);
  });
  await tx();
  return getPracticeTest(studentId,testId);
}

// ---------------------------------------------------------------------
// Study plan: a deterministic (non-AI) weekly schedule built from the
// student's current weakest skills, spaced-repetition due items, target
// test date, and stated weekly available minutes.
// ---------------------------------------------------------------------
async function generateStudyPlan(student:any) {
  const db=getDb();
  const mastery = await db.prepare(`SELECT skill,ability,attempts FROM mastery WHERE student_id=? ORDER BY ability ASC`).all(student.id) as any[];
  const weakest = mastery.slice(0,5);
  const due = await db.prepare(`SELECT skill,ability FROM mastery WHERE student_id=? AND sr_due_at <= datetime('now') ORDER BY sr_due_at ASC LIMIT 5`).all(student.id) as any[];
  const weeklyMinutes = student.weekly_available_minutes || 180;
  const sessionMinutes = 30;
  const sessionsPerWeek = Math.max(2, Math.min(7, Math.round(weeklyMinutes/sessionMinutes)));
  let daysUntilTest: number | null = null;
  if (student.test_date) {
    const diff = (new Date(student.test_date).getTime() - Date.now())/(1000*60*60*24);
    daysUntilTest = Math.max(0, Math.round(diff));
  }
  const focusSkills = (due.length ? due.map(d=>d.skill) : weakest.map(w=>w.skill));
  const fallbackSkills = ["math.algebra.linear_equations_1var","reading_writing.info.central_ideas_details","math.psda.percentages","reading_writing.craft.words_in_context"];
  const rotation = focusSkills.length ? focusSkills : fallbackSkills;
  const sessions = Array.from({length: sessionsPerWeek}).map((_,i)=>({
    session: i+1,
    focus_skill: rotation[i % rotation.length],
    minutes: sessionMinutes,
    activity: due.some(d=>d.skill===rotation[i % rotation.length]) ? "Spaced-repetition review" : (mastery.length===0 ? "Diagnostic-guided practice" : "Adaptive practice"),
  }));
  return {
    generatedAt: new Date().toISOString(),
    weeklyAvailableMinutes: weeklyMinutes,
    sessionsPerWeek,
    daysUntilTest,
    sessions,
    note: mastery.length===0 ? "Take the diagnostic test first for a plan tailored to your actual strengths and weaknesses." : undefined,
  };
}

// ---------------------------------------------------------------------
// Achievements & streaks — computed from attempts, never stored as a
// separate source of truth so they can never drift from real activity.
// ---------------------------------------------------------------------
async function computeAchievements(studentId:string) {
  const db=getDb();
  const totals = await db.prepare(`SELECT COUNT(*) attempts, COALESCE(SUM(is_correct),0) correct FROM attempts WHERE student_id=?`).get(studentId) as any;
  const days = (await db.prepare(`SELECT DISTINCT date(created_at) d FROM attempts WHERE student_id=? ORDER BY d DESC`).all(studentId) as any[]).map(r=>r.d);
  let currentStreak=0, longestStreak=0, run=0, prev:Date|null=null;
  const today = new Date(); today.setHours(0,0,0,0);
  for (let i=0;i<days.length;i++) {
    const d = new Date(days[i]+'T00:00:00Z');
    if (i===0) {
      const diffFromToday = Math.round((today.getTime()-d.getTime())/86400000);
      if (diffFromToday<=1) { currentStreak=1; run=1; } else { run=1; }
    } else {
      const prevDate = new Date(days[i-1]+'T00:00:00Z');
      const gap = Math.round((prevDate.getTime()-d.getTime())/86400000);
      if (gap===1) { run++; if (currentStreak>0 && i<currentStreak+1) currentStreak=run; }
      else { longestStreak=Math.max(longestStreak,run); run=1; }
    }
  }
  longestStreak = Math.max(longestStreak, run, currentStreak);
  const dailyChallenges = (await db.prepare(`SELECT COUNT(*) c FROM daily_challenge_progress WHERE student_id=? AND completed_at IS NOT NULL`).get(studentId) as any).c;
  const mathCorrect = (await db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.student_id=? AND a.is_correct=1 AND q.section='math'`).get(studentId) as any).c;
  const rwCorrect = (await db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.student_id=? AND a.is_correct=1 AND q.section='reading_writing'`).get(studentId) as any).c;
  const diagnosticDone = !!(await db.prepare(`SELECT diagnostic_completed_at FROM students WHERE id=?`).get(studentId) as any)?.diagnostic_completed_at;
  const badges = [
    { id:"first_steps", name:"First Steps", description:"Answer your first practice question.", unlocked: totals.attempts>=1, progress: Math.min(1,totals.attempts/1) },
    { id:"half_century", name:"Half Century", description:"Answer 50 questions correctly.", unlocked: totals.correct>=50, progress: Math.min(1,totals.correct/50) },
    { id:"century", name:"Century Club", description:"Answer 100 questions correctly.", unlocked: totals.correct>=100, progress: Math.min(1,totals.correct/100) },
    { id:"mathlete", name:"Mathlete", description:"Answer 25 Math questions correctly.", unlocked: mathCorrect>=25, progress: Math.min(1,mathCorrect/25) },
    { id:"wordsmith", name:"Wordsmith", description:"Answer 25 Reading & Writing questions correctly.", unlocked: rwCorrect>=25, progress: Math.min(1,rwCorrect/25) },
    { id:"week_streak", name:"Week Warrior", description:"Practice 7 days in a row.", unlocked: longestStreak>=7, progress: Math.min(1,longestStreak/7) },
    { id:"diagnostic", name:"Know Thyself", description:"Complete your diagnostic test.", unlocked: diagnosticDone, progress: diagnosticDone?1:0 },
    { id:"daily_grinder", name:"Daily Grinder", description:"Complete 5 daily challenges.", unlocked: dailyChallenges>=5, progress: Math.min(1,dailyChallenges/5) },
  ];
  return { totals, currentStreak, longestStreak, dailyChallengesCompleted: dailyChallenges, badges };
}

// ---------------------------------------------------------------------
// Daily challenge — a small, date-seeded set of questions shared by all
// students on a given calendar day, independent of individual mastery so
// it works as a consistent daily ritual.
// ---------------------------------------------------------------------
function todayKey() { return new Date().toISOString().slice(0,10); }
async function getOrCreateDailyChallenge(studentId:string) {
  const db=getDb();
  const date = todayKey();
  let row = await db.prepare(`SELECT * FROM daily_challenge_progress WHERE student_id=? AND challenge_date=?`).get(studentId,date) as any;
  if (!row) {
    // Deterministic per-day seed so every student gets the same 5 questions today.
    const seed = [...date].reduce((a,c)=>a+c.charCodeAt(0),0);
    const pool = await db.prepare(`SELECT id FROM questions WHERE status='approved' AND validated=1 ORDER BY id`).all() as any[];
    const picks:string[] = [];
    if (pool.length) {
      for (let i=0;i<5;i++) picks.push(pool[(seed*7+i*13) % pool.length].id);
    }
    // INSERT OR IGNORE guards against a rare race if two requests both miss
    // the SELECT above at the same instant (e.g. two tabs opened together).
    await db.prepare(`INSERT OR IGNORE INTO daily_challenge_progress (student_id,challenge_date,question_ids_json,answered_json) VALUES (?,?,?,'{}')`).run(studentId,date,JSON.stringify(picks));
    row = await db.prepare(`SELECT * FROM daily_challenge_progress WHERE student_id=? AND challenge_date=?`).get(studentId,date);
  }
  const ids:string[] = JSON.parse(row.question_ids_json);
  const answered = JSON.parse(row.answered_json);
  const questions:any[] = [];
  for (const id of ids) {
    const q = await db.prepare(`SELECT * FROM questions WHERE id=?`).get(id) as any;
    if (q) questions.push(cleanQuestion(q,false));
  }
  return { date, completed: !!row.completed_at, answered, questions };
}

// ---------------------------------------------------------------------
// Tutor agent pool — one live agent (with its own MCP subprocess trio)
// per active chat session, instead of spawning three fresh subprocesses
// on every single message. Idle agents are closed after a timeout to
// free resources. Keyed by chat session id so different conversations
// (or different students) never share message history.
// ---------------------------------------------------------------------
const AGENT_IDLE_MS = 15 * 60 * 1000;
const agentPool = new Map<string, { agent: TutorAgent; lastUsed: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of agentPool) {
    if (now - entry.lastUsed > AGENT_IDLE_MS) { entry.agent.close().catch(()=>{}); agentPool.delete(key); }
  }
}, 60_000).unref();

async function getTutorAgent(sessionId: string, studentId: string) {
  const existing = agentPool.get(sessionId);
  if (existing) { existing.lastUsed = Date.now(); return existing.agent; }
  if (agentPool.size >= MAX_TUTOR_AGENTS) {
    // Free the least-recently-used tutor so a traffic spike can't exhaust server memory.
    let oldestKey: string | null = null, oldest = Infinity;
    for (const [k, v] of agentPool) if (v.lastUsed < oldest) { oldest = v.lastUsed; oldestKey = k; }
    if (oldestKey) { agentPool.get(oldestKey)!.agent.close().catch(()=>{}); agentPool.delete(oldestKey); }
  }
  const agent = new TutorAgent(process.env.GROQ_API_KEY, studentId);
  await agent.connectServers();
  const prior = await getDb().prepare(`SELECT role,content FROM chat_messages WHERE session_id=? ORDER BY id ASC`).all(sessionId) as any[];
  if (prior.length) agent.loadHistory(prior);
  agentPool.set(sessionId, { agent, lastUsed: Date.now() });
  return agent;
}

async function handle(req:http.IncomingMessage,res:http.ServerResponse) {
  securityHeaders(res);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/healthz") {
    try { await getDb().prepare(`SELECT 1`).get(); return json(res,200,{ok:true}); }
    catch { return json(res,503,{ok:false}); }
  }
  await purgeSessions();
  if (url.pathname.startsWith("/api/")) {
    const ip0 = clientIp(req);
    const authPath = /^\/api\/auth\/(login|register|forgot-password|resend-verification|reset-password)$/.test(url.pathname);
    if (!allowRate(`${ip0}:${url.pathname}`, url.pathname === "/api/chat" ? 30 : authPath ? 10 : 120)) return json(res,429,{error:"Too many requests. Please wait a minute and try again."});
    try {
      const db=getDb();
      if(req.method==='POST' && url.pathname==='/api/auth/register') {
        const b:any=await body(req); const email=String(b.email||'').trim().toLowerCase(); const password=String(b.password||''); const name=String(b.name||'').trim();
        if(!email||!/^\S+@\S+\.\S+$/.test(email)||name.length<2) return json(res,400,{error:'Name and a valid email address are required'});
        const pwdCheck = validatePasswordStrength(password);
        if(!pwdCheck.valid) return json(res,400,{error:`Password requirements not met: ${pwdCheck.errors.join('; ')}`});
        if(await db.prepare(`SELECT 1 FROM users WHERE email=?`).get(email)) return json(res,409,{error:'An account with that email already exists'});
        const id=newId('usr');
        await db.prepare(`INSERT INTO users (id,email,password_hash,name,email_verified) VALUES (?,?,?,?,?)`).run(id,email,hashPassword(password),name,!REQUIRE_EMAIL_VERIFICATION);
        await studentForUser(id);
        if(!REQUIRE_EMAIL_VERIFICATION){
          await audit(id,'register','user',id,{ email_verified: true, verification_disabled: true });
          return json(res,201,{ requiresVerification: false, message: 'Registration successful! You can now log in.', email });
        }
        const vt = await createVerificationToken(id);
        const baseUrl = publicBaseUrl(req);
        await sendVerificationEmail({ to: email, name, token: vt.token, baseUrl });
        await audit(id,'register','user',id,{ email_verified: false });
        return json(res,201,{ requiresVerification: true, message: 'Registration successful! Please check your email to verify your account before logging in.', email });
      }
      if((req.method==='GET' || req.method==='POST') && url.pathname==='/api/auth/verify-email') {
        let token = url.searchParams.get('token');
        if (!token && req.method === 'POST') {
          const b:any = await body(req).catch(()=>({}));
          token = b.token;
        }
        if (!token) return json(res,400,{error:'Verification token is required'});
        const result = await verifyEmailToken(token);
        if (!result.success) return json(res,400,{error:result.error});
        await audit(result.userId!,'verify_email','user',result.userId);
        return json(res,200,{ok:true,message:'Email verified successfully! You can now log in to your account.'});
      }
      if(req.method==='POST' && url.pathname==='/api/auth/resend-verification') {
        const b:any=await body(req); const email=String(b.email||'').trim().toLowerCase();
        if(!email) return json(res,400,{error:'Email address is required'});
        const u:any=await db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
        if (u) {
          const isVerified = u.email_verified === true || u.email_verified === 1 || u.email_verified === 't';
          if (!isVerified) {
            const vt = await createVerificationToken(u.id);
            const baseUrl = publicBaseUrl(req);
            await sendVerificationEmail({ to: u.email, name: u.name, token: vt.token, baseUrl });
            await audit(u.id,'resend_verification','user',u.id);
          }
        }
        return json(res,200,{ok:true,message:'If an unverified account exists for that email, a verification link has been sent.'});
      }
      if(req.method==='POST' && url.pathname==='/api/auth/login') {
        const b:any=await body(req); const email=String(b.email||'').trim().toLowerCase(), password=String(b.password||''); const u:any=await db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
        if(!u||u.status!=='active'||!verifyPassword(password,u.password_hash)) return json(res,401,{error:'Invalid email or password'});
        const isVerified = u.email_verified === true || u.email_verified === 1 || u.email_verified === 't';
        if(!isVerified) return json(res,403,{error:'Email not verified. Please check your inbox for the verification link.',requiresVerification:true,email:u.email});
        const ip = clientIp(req);
        const ua = (req.headers['user-agent'] || 'Unknown Browser').slice(0, 255);
        const s=await createSession(u.id, ip, ua); setCookie(res,'sat_session',s.id,14*24*60*60); await audit(u.id,'login','user',u.id); return json(res,200,{user:{id:u.id,email:u.email,name:u.name,role:u.role}});
      }
      if(req.method==='GET' && url.pathname==='/api/auth/sessions') {
        const u = await requireAuth(req,res); if(!u) return;
        const sessions = await listUserSessions(u.id, u.sessionId);
        return json(res,200,{sessions});
      }
      if(req.method==='DELETE' && url.pathname.startsWith('/api/auth/sessions/')) {
        const u = await requireAuth(req,res); if(!u) return;
        const sid = url.pathname.split('/').pop();
        if (sid) {
          await revokeUserSession(u.id, sid);
          await audit(u.id, 'revoke_session', 'session', sid);
        }
        return json(res,200,{ok:true});
      }
      if(req.method==='POST' && url.pathname==='/api/auth/sessions/revoke-all') {
        const u = await requireAuth(req,res); if(!u) return;
        await revokeAllUserSessions(u.id, u.sessionId);
        await audit(u.id, 'revoke_all_sessions', 'session', u.id);
        return json(res,200,{ok:true});
      }
      if(req.method==='POST' && url.pathname==='/api/auth/forgot-password') {
        const b:any=await body(req); const email=String(b.email||'').trim().toLowerCase();
        if(!email||!/^\S+@\S+\.\S+$/.test(email)) return json(res,400,{error:'A valid email address is required'});
        const u:any=await db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
        if (u) {
          const prt = await createPasswordResetToken(u.id);
          const baseUrl = publicBaseUrl(req);
          await sendPasswordResetEmail({ to: u.email, name: u.name, token: prt.token, baseUrl });
          await audit(u.id,'request_password_reset','user',u.id);
        }
        return json(res,200,{ok:true,message:'If an account with that email exists, a password reset link has been sent.'});
      }
      if(req.method==='POST' && url.pathname==='/api/auth/reset-password') {
        const b:any=await body(req); const token=String(b.token||''); const newPassword=String(b.newPassword||'');
        if (!token) return json(res,400,{error:'Password reset token is required'});
        if (!newPassword || newPassword.length < 8) return json(res,400,{error:'New password must be at least 8 characters long'});
        const result = await resetPasswordWithToken(token, newPassword);
        if (!result.success) return json(res,400,{error:result.error});
        await audit(result.userId!,'reset_password','user',result.userId);
        return json(res,200,{ok:true,message:'Password reset successfully! You can now log in with your new password.'});
      }
      if(req.method==='POST' && url.pathname==='/api/auth/logout'){ await destroySession(parseCookies(req).sat_session); setCookie(res,'sat_session','',0); return json(res,200,{ok:true}); }
      if(req.method==='GET' && url.pathname==='/api/me'){ const u=await requireAuth(req,res); if(!u) return; const s=await studentForUser(u.id); return json(res,200,{user:u,student:s}); }
      if(req.method==='DELETE' && url.pathname==='/api/me'){
        const u = await requireAuth(req,res); if(!u) return;
        const b:any = await body(req);
        const password = String(b.password || '');
        const result = await deleteUserAccount(u.id, password);
        if (!result.success) return json(res,400,{error:result.error});
        setCookie(res,'sat_session','',0);
        await audit(u.id,'delete_account','user',u.id);
        return json(res,200,{ok:true,message:'Your account and all associated data have been permanently deleted.'});
      }
      const u = await requireAuth(req,res); if(!u) return; const student=await studentForUser(u.id);
      if(req.method==='PATCH' && url.pathname==='/api/me') { const b:any=await body(req); await db.prepare(`UPDATE users SET name=?, updated_at=datetime('now') WHERE id=?`).run(String(b.name||u.name).trim(),u.id); await db.prepare(`UPDATE students SET name=?,target_score=?,test_date=?,weekly_available_minutes=?,timezone=? WHERE user_id=?`).run(String(b.name||u.name).trim(),b.target_score??null,b.test_date??null,b.weekly_available_minutes??null,b.timezone??null,u.id); return json(res,200,{ok:true}); }
      if(req.method==='GET' && url.pathname==='/api/progress') {
        const mastery=await db.prepare(`SELECT skill,ability,attempts,correct,avg_time_seconds,sr_due_at FROM mastery WHERE student_id=? ORDER BY ability ASC`).all(student.id);
        const stats=await db.prepare(`SELECT COUNT(*) attempts, COALESCE(SUM(is_correct),0) correct, COALESCE(AVG(time_seconds),0) avg_time FROM attempts WHERE student_id=?`).get(student.id) as any;
        const recent=await db.prepare(`SELECT a.id,a.student_answer,a.is_correct,a.time_seconds,a.created_at,q.section,q.skill,q.difficulty,q.id question_id FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.student_id=? ORDER BY a.id DESC LIMIT 12`).all(student.id);
        const due=await db.prepare(`SELECT skill,ability,attempts,correct,sr_due_at FROM mastery WHERE student_id=? AND sr_due_at <= datetime('now') ORDER BY sr_due_at ASC`).all(student.id);
        return json(res,200,{stats,mastery,recent,due});
      }
      if(req.method==='GET' && url.pathname==='/api/question-filters') {
        const domains=await db.prepare(`SELECT DISTINCT section,domain FROM questions WHERE status='approved' AND domain IS NOT NULL ORDER BY section,domain`).all();
        const skills=await db.prepare(`SELECT DISTINCT section,domain,skill FROM questions WHERE status='approved' ORDER BY section,domain,skill`).all();
        const frequencies=await db.prepare(`SELECT DISTINCT frequency_tier FROM questions WHERE status='approved' ORDER BY frequency_tier`).all();
        return json(res,200,{domains,skills,frequencies});
      }
      if(req.method==='POST' && url.pathname==='/api/practice/hint') {
        const b:any=await body(req); const level=Math.min(3,Math.max(1,Number(b.level||1))); const q=await db.prepare(`SELECT * FROM questions WHERE id=? AND validated=1 AND status='approved'`).get(String(b.question_id)) as any; if(!q)return json(res,404,{error:'Question not found'}); return json(res,200,{hint:hintForQuestion(q,level)});
      }
      if(req.method==='GET' && url.pathname==='/api/questions/next') { const result=await selectNext(student.id,url.searchParams.get('skill')||undefined,url.searchParams.get('section')||undefined,[],url.searchParams.get('domain')||undefined,url.searchParams.get('difficulty')?Number(url.searchParams.get('difficulty')):undefined,url.searchParams.get('frequency')||undefined); if(!result) return json(res,404,{error:'No matching question found for those filters. Try a broader topic or difficulty.'}); return json(res,200,result); }
      if(req.method==='GET' && url.pathname.startsWith('/api/questions/')) { const qid=url.pathname.split('/').pop(); const q=await db.prepare(`SELECT * FROM questions WHERE id=? AND validated=1 AND status='approved'`).get(qid); if(!q)return json(res,404,{error:'Question not found'}); return json(res,200,cleanQuestion(q as any,false)); }
      if(req.method==='POST' && url.pathname==='/api/practice/answer') { const b:any=await body(req); const q=await db.prepare(`SELECT * FROM questions WHERE id=? AND validated=1 AND status='approved'`).get(String(b.question_id)) as any; if(!q)return json(res,404,{error:'Question not found'}); const g=await grade(q.id,String(b.student_answer||'')); const mastery=await logAttempt(student.id,q,g,b.time_seconds,b.hints_used,b.mistake_type); return json(res,200,{...g,mastery,timeSeconds:Number(b.time_seconds||0),hintsUsed:Number(b.hints_used||0),learningPoint:`Review ${q.skill.replace(/[_\.]/g,' ')} and focus on the rule used in this question.`}); }
      if(req.method==='POST' && url.pathname==='/api/question-explanation') {
        const b:any=await body(req);
        const q=await db.prepare(`SELECT * FROM questions WHERE id=? AND validated=1 AND status='approved'`).get(String(b.question_id||'')) as any;
        if(!q) return json(res,404,{error:'Question not found'});
        try {
          const explanations=await generateQuestionExplanations([q]);
          return json(res,200,{explanation:explanations[q.id]});
        } catch(error:any) { return json(res,502,{error:error.message||'Could not generate a question explanation.'}); }
      }
      if(req.method==='POST' && url.pathname==='/api/chat') {
        if(!process.env.GROQ_API_KEY) return json(res,503,{error:'AI tutor is not configured. Set GROQ_API_KEY on the server.'});
        const b:any=await body(req); const text=String(b.message||'').trim(); if(!text)return json(res,400,{error:'Message is required'});
        const sessionId=String(b.session_id||newId('chat')); let session=await db.prepare(`SELECT * FROM chat_sessions WHERE id=? AND student_id=?`).get(sessionId,student.id) as any;
        if(!session){ await db.prepare(`INSERT INTO chat_sessions (id,student_id,title) VALUES (?,?,?)`).run(sessionId,student.id,text.slice(0,60)); session=await db.prepare(`SELECT * FROM chat_sessions WHERE id=?`).get(sessionId); }
        await db.prepare(`INSERT INTO chat_messages (session_id,role,content) VALUES (?,?,?)`).run(sessionId,'user',text);
        const agent=await getTutorAgent(sessionId, student.id); // pooled per session — avoids respawning 3 MCP subprocesses on every message
        // If the student is chatting while looking at a specific practice question,
        // tell the model which one so it can ground hints/explanations in it
        // (via get_question / grade_answer) instead of guessing what "this question" means.
        const contextNote = b.current_question_id ? `[Context: the student is currently looking at question_id="${String(b.current_question_id)}". Use get_question to see it if relevant to their message.]\n` : '';
        const reply=await agent.sendMessage(contextNote + text);
        await db.prepare(`INSERT INTO chat_messages (session_id,role,content,created_at) VALUES (?,?,?,datetime('now'))`).run(sessionId,'assistant',reply);
        await db.prepare(`UPDATE chat_sessions SET updated_at=datetime('now') WHERE id=?`).run(sessionId);
        return json(res,200,{session_id:sessionId,reply});
      }
      if(req.method==='GET' && url.pathname==='/api/chat/sessions'){ return json(res,200,await db.prepare(`SELECT id,title,created_at,updated_at FROM chat_sessions WHERE student_id=? ORDER BY updated_at DESC`).all(student.id)); }
      if(req.method==='GET' && url.pathname.startsWith('/api/chat/sessions/')){ const sid=url.pathname.split('/').pop(); const s=await db.prepare(`SELECT * FROM chat_sessions WHERE id=? AND student_id=?`).get(sid,student.id); if(!s)return json(res,404,{error:'Session not found'}); const messages=await db.prepare(`SELECT role,content,created_at FROM chat_messages WHERE session_id=? ORDER BY id`).all(sid); return json(res,200,{session:s,messages}); }

      // --- Bookmarks --------------------------------------------------
      if(req.method==='GET' && url.pathname==='/api/bookmarks') return json(res,200,await listBookmarks(student.id));
      if(req.method==='POST' && url.pathname==='/api/bookmarks') { const b:any=await body(req); const qid=String(b.question_id||''); if(!await db.prepare(`SELECT 1 FROM questions WHERE id=?`).get(qid)) return json(res,404,{error:'Question not found'}); await db.prepare(`INSERT INTO bookmarks (student_id,question_id,note) VALUES (?,?,?) ON CONFLICT(student_id,question_id) DO UPDATE SET note=excluded.note`).run(student.id,qid,b.note||null); return json(res,201,{ok:true}); }
      if(req.method==='DELETE' && url.pathname.startsWith('/api/bookmarks/')) { const qid=url.pathname.split('/').pop(); await db.prepare(`DELETE FROM bookmarks WHERE student_id=? AND question_id=?`).run(student.id,qid); return json(res,200,{ok:true}); }

      // --- Mistake review ----------------------------------------------
      if(req.method==='GET' && url.pathname==='/api/mistakes') return json(res,200,await listMistakes(student.id));

      // --- Study plan ---------------------------------------------------
      if(req.method==='GET' && url.pathname==='/api/study-plan') { const row=await db.prepare(`SELECT plan_json,generated_at FROM study_plans WHERE student_id=?`).get(student.id) as any; return json(res,200,row?{plan:JSON.parse(row.plan_json),generatedAt:row.generated_at}:{plan:null}); }
      if(req.method==='POST' && url.pathname==='/api/study-plan/generate') { const plan=await generateStudyPlan(student); await db.prepare(`INSERT INTO study_plans (student_id,plan_json,generated_at) VALUES (?,?,datetime('now')) ON CONFLICT(student_id) DO UPDATE SET plan_json=excluded.plan_json, generated_at=datetime('now')`).run(student.id,JSON.stringify(plan)); return json(res,200,{plan}); }

      // --- Achievements & streaks ----------------------------------------
      if(req.method==='GET' && url.pathname==='/api/achievements') return json(res,200,await computeAchievements(student.id));

      // --- Daily challenge -------------------------------------------------
      if(req.method==='GET' && url.pathname==='/api/daily-challenge') return json(res,200,await getOrCreateDailyChallenge(student.id));
      if(req.method==='POST' && url.pathname==='/api/daily-challenge/answer') {
        const b:any=await body(req); const qid=String(b.question_id||'');
        const date=todayKey(); const row=await db.prepare(`SELECT * FROM daily_challenge_progress WHERE student_id=? AND challenge_date=?`).get(student.id,date) as any;
        if(!row) return json(res,404,{error:'No daily challenge started yet for today'});
        const ids:string[]=JSON.parse(row.question_ids_json); if(!ids.includes(qid)) return json(res,400,{error:'That question is not part of today\'s challenge'});
        const q=await db.prepare(`SELECT * FROM questions WHERE id=?`).get(qid) as any; if(!q) return json(res,404,{error:'Question not found'});
        const g=await grade(qid,String(b.student_answer||'')); const mastery=await logAttempt(student.id,q,g,b.time_seconds,0);
        const answered=JSON.parse(row.answered_json); answered[qid]={isCorrect:g.isCorrect,answeredAt:new Date().toISOString()};
        const allAnswered = ids.every(id=>answered[id]);
        await db.prepare(`UPDATE daily_challenge_progress SET answered_json=?, completed_at=? WHERE student_id=? AND challenge_date=?`).run(JSON.stringify(answered), allAnswered? new Date().toISOString(): row.completed_at, student.id, date);
        return json(res,200,{...g,mastery,completed:allAnswered});
      }

      // --- Feedback (student-submitted) -----------------------------------
      if(req.method==='POST' && url.pathname==='/api/feedback') { const b:any=await body(req); const msg=String(b.message||'').trim(); if(!msg) return json(res,400,{error:'Message is required'}); const id=newId('fb'); await db.prepare(`INSERT INTO feedback (id,user_id,type,message,question_id) VALUES (?,?,?,?,?)`).run(id,u.id,b.type||'general',msg,b.question_id||null); return json(res,201,{id}); }
      if(req.method==='GET' && url.pathname==='/api/feedback/mine') return json(res,200,await db.prepare(`SELECT * FROM feedback WHERE user_id=? ORDER BY created_at DESC`).all(u.id));

      // --- Full-length / diagnostic / section practice tests ----------------
      if(req.method==='POST' && url.pathname==='/api/practice-test/start') { const b:any=await body(req); const mode=String(b.mode||'full'); try { const t=await buildPracticeTest(student.id,mode); return json(res,201,t); } catch(e:any){ return json(res,400,{error:e.message}); } }
      if(req.method==='GET' && url.pathname==='/api/practice-tests') return json(res,200,(await db.prepare(`SELECT id,config_json,status,score_json,started_at,finished_at FROM practice_tests WHERE student_id=? ORDER BY started_at DESC LIMIT 25`).all(student.id)).map((r:any)=>({id:r.id,mode:JSON.parse(r.config_json).mode,status:r.status,score:r.score_json?JSON.parse(r.score_json):null,startedAt:r.started_at,finishedAt:r.finished_at})));
      if(req.method==='GET' && url.pathname.match(/^\/api\/practice-test\/[^/]+$/)) { const id=url.pathname.split('/').pop(); const t=await getPracticeTest(student.id,id!); if(!t) return json(res,404,{error:'Test not found'}); return json(res,200,t); }
      if(req.method==='POST' && url.pathname.match(/^\/api\/practice-test\/[^/]+\/answer$/)) {
        const id=url.pathname.split('/')[3]; const b:any=await body(req);
        const item=await db.prepare(`SELECT pti.*, pt.status,pt.config_json,pt.started_at FROM practice_test_items pti JOIN practice_tests pt ON pt.id=pti.test_id WHERE pt.id=? AND pt.student_id=? AND pti.question_id=?`).get(id,student.id,String(b.question_id||'')) as any;
        if(!item) return json(res,404,{error:'Test item not found'});
        if(item.status!=='in_progress') return json(res,400,{error:'This test has already been finished'});
        const config=JSON.parse(item.config_json);
        const moduleIndex=config.modules.findIndex((module:any)=>module.module===item.module);
        if(moduleIndex<0) return json(res,400,{error:'Test module configuration is invalid'});
        const elapsedMs=Date.now()-new Date(item.started_at).getTime();
        const moduleStartMs=config.modules.slice(0,moduleIndex).reduce((total:number,module:any)=>total+(Number(module.minutes)||0)*60000,0);
        const moduleEndMs=moduleStartMs+(Number(config.modules[moduleIndex].minutes)||0)*60000;
        if(elapsedMs<moduleStartMs) return json(res,400,{error:'This module is not open yet'});
        if(elapsedMs>=moduleEndMs) return json(res,400,{error:'This module time has expired'});
        const q=await db.prepare(`SELECT * FROM questions WHERE id=?`).get(item.question_id) as any; const g=await grade(item.question_id,String(b.student_answer||''));
        await db.prepare(`UPDATE practice_test_items SET student_answer=?, is_correct=?, time_seconds=? WHERE test_id=? AND question_id=?`).run(String(b.student_answer||''),g.isCorrect?1:0,Number(b.time_seconds||0),id,item.question_id);
        return json(res,200,{isCorrect:g.isCorrect});
      }
      if(req.method==='POST' && url.pathname.match(/^\/api\/practice-test\/[^/]+\/finish$/)) {
        const id=url.pathname.split('/')[3];
        try {
          // Log every answered item into the normal attempt/mastery pipeline too,
          // so a full-length test contributes to overall mastery just like practice.
          const items=await db.prepare(`SELECT pti.*, q.skill,q.difficulty,q.explanation,q.correct_answer FROM practice_test_items pti JOIN questions q ON q.id=pti.question_id JOIN practice_tests pt ON pt.id=pti.test_id WHERE pt.id=? AND pt.student_id=? AND pt.status='in_progress'`).all(id,student.id) as any[];
          for (const it of items) { if (it.student_answer!=null) await logAttempt(student.id,{id:it.question_id,skill:it.skill,difficulty:it.difficulty},{studentAnswer:it.student_answer,isCorrect:!!it.is_correct},it.time_seconds,0); }
          const t=await finishPracticeTest(student.id,id!); if(!t) return json(res,404,{error:'Test not found'}); return json(res,200,t);
        } catch(e:any){ return json(res,400,{error:e.message}); }
      }
      if(req.method==='POST' && url.pathname.match(/^\/api\/practice-test\/[^/]+\/explanations$/)) {
        const id=url.pathname.split('/')[3];
        const test=await db.prepare(`SELECT status FROM practice_tests WHERE id=? AND student_id=?`).get(id,student.id) as any;
        if(!test) return json(res,404,{error:'Test not found'});
        if(test.status!=='finished') return json(res,400,{error:'Finish the test before requesting answer explanations'});
        const questions=await db.prepare(`SELECT q.id,q.section,q.skill,q.stem,q.choices_json,q.correct_answer,q.answer_type,q.explanation FROM practice_test_items pti JOIN questions q ON q.id=pti.question_id WHERE pti.test_id=? ORDER BY pti.order_index`).all(id) as any[];
        try { return json(res,200,{explanations:await generateQuestionExplanations(questions)}); }
        catch(e:any) { return json(res,502,{error:e.message||'Could not generate test explanations.'}); }
      }

      if(url.pathname.startsWith('/api/admin/')) {
        if(u.role!=='admin') return json(res,403,{error:'Admin access required'});
        if(req.method==='GET' && url.pathname==='/api/admin/stats'){
          const users=await db.prepare(`SELECT COUNT(*) c FROM users WHERE role='student'`).get() as any;
          const active=await db.prepare(`SELECT COUNT(DISTINCT student_id) c FROM attempts WHERE created_at >= datetime('now','-7 days')`).get() as any;
          const attempts=await db.prepare(`SELECT COUNT(*) c, COALESCE(AVG(is_correct),0) accuracy FROM attempts`).get() as any;
          const questions=await db.prepare(`SELECT COUNT(*) c FROM questions WHERE status='approved'`).get() as any;
          const pending=await db.prepare(`SELECT COUNT(*) c FROM questions WHERE status='human_review'`).get() as any;
          const pendingFeedback=await db.prepare(`SELECT COUNT(*) c FROM feedback WHERE status='open'`).get() as any;
          const testsCompleted=await db.prepare(`SELECT COUNT(*) c FROM practice_tests WHERE status='finished'`).get() as any;
          return json(res,200,{users:users.c,weeklyActive:active.c,attempts:attempts.c,accuracy:attempts.accuracy,questions:questions.c,pendingQuestions:pending.c,pendingFeedback:pendingFeedback.c,testsCompleted:testsCompleted.c});
        }
        if(req.method==='GET' && url.pathname==='/api/admin/users'){
          const search=String(url.searchParams.get('search')||'').trim();
          let sql=`SELECT u.id,u.email,u.name,u.status,u.created_at,s.id student_id,s.target_score,s.test_date,COALESCE((SELECT COUNT(*) FROM attempts a WHERE a.student_id=s.id),0) attempts,(SELECT COUNT(*) FROM attempts a WHERE a.student_id=s.id AND a.created_at>=datetime('now','-7 days')) recent_attempts FROM users u LEFT JOIN students s ON s.user_id=u.id WHERE u.role='student'`;
          const ps:any[]=[]; if(search){ sql+=` AND (u.email LIKE ? OR u.name LIKE ?)`; const q=`%${search}%`; ps.push(q,q); }
          sql+=` ORDER BY u.created_at DESC LIMIT 200`;
          return json(res,200,await db.prepare(sql).all(...ps));
        }
        if(req.method==='PATCH' && url.pathname.match(/^\/api\/admin\/users\/[^/]+$/)){
          const id=url.pathname.split('/').pop() as string; const b:any=await body(req); const target=await db.prepare(`SELECT id FROM users WHERE id=? AND role='student'`).get(id) as any; if(!target) return json(res,404,{error:'Student not found'});
          if(b.status && !['active','suspended'].includes(b.status)) return json(res,400,{error:'Invalid status'});
          if(b.status) await db.prepare(`UPDATE users SET status=?, updated_at=datetime('now') WHERE id=?`).run(b.status,id);
          await audit(u.id,'update_status','user',id,{status:b.status}); return json(res,200,{ok:true});
        }
        if(req.method==='GET' && url.pathname==='/api/admin/analytics'){
          const skillAccuracy=await db.prepare(`SELECT q.skill, COUNT(*) attempts, ROUND(AVG(a.is_correct)*100,1) accuracy FROM attempts a JOIN questions q ON q.id=a.question_id GROUP BY q.skill HAVING COUNT(*)>=3 ORDER BY accuracy ASC LIMIT 15`).all();
          const difficultyCalibration=await db.prepare(`SELECT q.difficulty, COUNT(*) attempts, ROUND(AVG(a.is_correct)*100,1) accuracy FROM attempts a JOIN questions q ON q.id=a.question_id GROUP BY q.difficulty ORDER BY q.difficulty ASC`).all();
          const mostMissed=await db.prepare(`SELECT q.id,q.stem,q.skill,q.difficulty,COUNT(*) attempts,ROUND(AVG(a.is_correct)*100,1) accuracy FROM attempts a JOIN questions q ON q.id=a.question_id GROUP BY q.id HAVING COUNT(*)>=5 ORDER BY accuracy ASC LIMIT 10`).all();
          const dailyActivity=await db.prepare(`SELECT date(created_at) day, COUNT(*) attempts FROM attempts WHERE created_at>=datetime('now','-14 days') GROUP BY day ORDER BY day ASC`).all();
          return json(res,200,{skillAccuracy,difficultyCalibration,mostMissed,dailyActivity});
        }
        if(req.method==='GET' && url.pathname==='/api/admin/feedback'){
          const status=url.searchParams.get('status')||'';
          let sql=`SELECT f.*,u.name user_name,u.email user_email,q.stem question_stem FROM feedback f JOIN users u ON u.id=f.user_id LEFT JOIN questions q ON q.id=f.question_id WHERE 1=1`; const ps:any[]=[];
          if(status){ sql+=` AND f.status=?`; ps.push(status); }
          sql+=` ORDER BY f.created_at DESC LIMIT 200`;
          return json(res,200,await db.prepare(sql).all(...ps));
        }
        if(req.method==='PATCH' && url.pathname.match(/^\/api\/admin\/feedback\/[^/]+$/)){
          const id=url.pathname.split('/').pop() as string; const b:any=await body(req); if(!['open','in_review','resolved','dismissed'].includes(b.status)) return json(res,400,{error:'Invalid status'});
          const existing=await db.prepare(`SELECT id FROM feedback WHERE id=?`).get(id) as any; if(!existing) return json(res,404,{error:'Feedback not found'});
          await db.prepare(`UPDATE feedback SET status=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?`).run(b.status,u.id,id); await audit(u.id,'update','feedback',id,{status:b.status}); return json(res,200,{ok:true});
        }
        if(req.method==='GET' && url.pathname==='/api/admin/questions'){
          const search=String(url.searchParams.get('search')||'').trim(), section=url.searchParams.get('section')||'', domain=url.searchParams.get('domain')||'', skill=url.searchParams.get('skill')||'', difficulty=url.searchParams.get('difficulty')||'', frequency=url.searchParams.get('frequency')||'', status=url.searchParams.get('status')||'';
          let sql=`SELECT id,section,domain,skill,difficulty,stem,choices_json,correct_answer,answer_type,explanation,source,validated,status,frequency_tier,previous_exam_occurrence_count,previous_exam_occurrence_basis,concept_tags_json,created_at,updated_at FROM questions WHERE 1=1`; const ps:any[]=[];
          if(search){sql+=` AND (stem LIKE ? OR skill LIKE ? OR id LIKE ?)`; const q=`%${search}%`; ps.push(q,q,q);}
          if(section){sql+=` AND section=?`;ps.push(section);} if(domain){sql+=` AND domain=?`;ps.push(domain);} if(skill){sql+=` AND skill=?`;ps.push(skill);} if(difficulty){sql+=` AND difficulty=?`;ps.push(Number(difficulty));} if(frequency){sql+=` AND frequency_tier=?`;ps.push(frequency);} if(status){sql+=` AND status=?`;ps.push(status);}
          const total=(await db.prepare(sql.replace(/SELECT id,section,domain,skill,difficulty,stem,choices_json,correct_answer,answer_type,explanation,source,validated,status,frequency_tier,previous_exam_occurrence_count,previous_exam_occurrence_basis,concept_tags_json,created_at,updated_at/,'SELECT COUNT(*) c')).get(...ps) as any).c;
          sql+=` ORDER BY created_at DESC LIMIT 250`; const rows=await db.prepare(sql).all(...ps) as any[];
          return json(res,200,{total,items:rows.map((r:any)=>({...r,choices:r.choices_json?JSON.parse(r.choices_json):null,concept_tags:r.concept_tags_json?JSON.parse(r.concept_tags_json):[]}))});
        }
        if(req.method==='GET' && url.pathname.startsWith('/api/admin/questions/')){
          const id=url.pathname.split('/').pop(); const r=await db.prepare(`SELECT * FROM questions WHERE id=?`).get(id) as any; if(!r)return json(res,404,{error:'Question not found'}); return json(res,200,{...r,choices:r.choices_json?JSON.parse(r.choices_json):null,concept_tags:r.concept_tags_json?JSON.parse(r.concept_tags_json):[]});
        }
        if(req.method==='POST' && url.pathname==='/api/admin/questions'){ const b:any=await body(req); const id=String(b.id||newId('q')); await db.prepare(`INSERT INTO questions (id,section,domain,skill,difficulty,stem,choices_json,correct_answer,answer_type,explanation,source,validated,status,frequency_tier,previous_exam_occurrence_count,previous_exam_occurrence_basis,concept_tags_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,b.section,b.domain||null,b.skill,Number(b.difficulty),b.stem,b.choices?JSON.stringify(b.choices):null,b.correct_answer,b.answer_type||'mcq',b.explanation,b.source||'admin',Number(b.validated??1),b.status||'approved',b.frequency_tier||'unknown',b.previous_exam_occurrence_count??null,b.previous_exam_occurrence_basis??null,b.concept_tags?JSON.stringify(b.concept_tags):null,u.id); await audit(u.id,'create','question',id); return json(res,201,{id}); }
        if(req.method==='PATCH' && url.pathname.startsWith('/api/admin/questions/')){
          const id=url.pathname.split('/').pop() as string; const existing=await db.prepare(`SELECT * FROM questions WHERE id=?`).get(id) as any; if(!existing)return json(res,404,{error:'Question not found'}); const b:any=await body(req);
          const merged:any={...existing,...b}; const choices = b.choices!==undefined ? b.choices : (existing.choices_json?JSON.parse(existing.choices_json):null);
          await db.prepare(`UPDATE questions SET section=?,domain=?,skill=?,difficulty=?,stem=?,choices_json=?,correct_answer=?,answer_type=?,explanation=?,source=?,validated=?,status=?,frequency_tier=?,previous_exam_occurrence_count=?,previous_exam_occurrence_basis=?,concept_tags_json=?,reviewed_by=?,updated_at=datetime('now') WHERE id=?`).run(merged.section,merged.domain,merged.skill,Number(merged.difficulty),merged.stem,choices?JSON.stringify(choices):null,merged.correct_answer,merged.answer_type||(choices?'mcq':'grid-in'),merged.explanation,merged.source||'admin',Number(merged.validated??existing.validated),merged.status||existing.status,merged.frequency_tier||existing.frequency_tier,merged.previous_exam_occurrence_count??existing.previous_exam_occurrence_count,merged.previous_exam_occurrence_basis??existing.previous_exam_occurrence_basis,merged.concept_tags?JSON.stringify(merged.concept_tags):existing.concept_tags_json,u.id,id); await audit(u.id,'update','question',id); return json(res,200,{ok:true}); }
        return json(res,404,{error:'Admin route not found'});
      }
      return json(res,404,{error:'API route not found'});
    } catch (e:any) { console.error(e); return json(res,500,{error:isProd?'Something went wrong':e.message}); }
  }
  return sendStatic(res,url.pathname);
}

const server=http.createServer((req,res)=>{ handle(req,res).catch((e)=>{ console.error(e); if(!res.headersSent) json(res,500,{error:"Something went wrong"}); else res.end(); }); });
server.listen(PORT,HOST,()=>console.log(`SAT Tutor web app listening on ${HOST}:${PORT}`));
function shutdown(){
  console.log("Shutting down...");
  for (const entry of agentPool.values()) entry.agent.close().catch(()=>{});
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(0),8000).unref();
}
process.on("SIGTERM",shutdown); process.on("SIGINT",shutdown);
process.on("unhandledRejection",(e)=>console.error("unhandledRejection",e));
