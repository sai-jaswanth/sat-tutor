// Lets the (text-only) tutor model "see" pictures: a vision model transcribes/describes
// each image once, the result is cached by image id, and the tutor receives it as text.
import { getDb } from "../db/database.js";

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
// Groq's current vision-capable model; override with GROQ_VISION_MODEL if Groq renames/retires it.
const VISION_MODEL = () => process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";

const VISION_PROMPT = `You are the eyes of an SAT/PSAT tutor. A student attached this image. Report what it contains so a tutor who cannot see it can help. Do NOT solve anything.

- If it shows a question (a photo, screenshot or scan): transcribe it completely and exactly - passage or stem, every answer choice labelled A-D, and any given values. Write math in plain text (x^2, sqrt(x), 3/4).
- Describe every figure precisely: graphs (axis labels, units, scale, tick values, plotted points, line/curve behaviour, intercepts, legends), tables (all rows and columns), geometry diagrams (labelled points, lengths, angles, marks), charts (categories and values).
- If it is handwriting or student work, transcribe it step by step and note where the work looks unclear.
- If it is anything else, say what it shows in a few sentences.
- Mark anything you cannot read as [unclear: your best guess?]. Never invent values.
Start with one line: "Type: <question | graph/figure | student work | notes | other>".`;

export const IMAGE_TOKEN_RE = /!\[[^\]]*\]\(img:([A-Za-z0-9]+)\)/g;
export const MAX_CHAT_IMAGES = 3; // Groq accepts at most 3 images per request

export async function describeImage(id: string): Promise<string> {
  const db = getDb();
  const cached = await db.prepare(`SELECT description FROM image_descriptions WHERE image_id=?`).get(id) as any;
  if (cached?.description) return cached.description;
  const img = await db.prepare(`SELECT content_type,data FROM question_images WHERE id=?`).get(id) as any;
  if (!img) throw new Error("Image not found");
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Image understanding requires GROQ_API_KEY.");
  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL(), temperature: 0.1, max_tokens: 1800,
      messages: [{ role: "user", content: [
        { type: "text", text: VISION_PROMPT },
        { type: "image_url", image_url: { url: `data:${img.content_type};base64,${Buffer.from(img.data).toString("base64")}` } },
      ] }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Could not read the image (vision service ${res.status}). ${raw.slice(0, 200)}`);
  let text = "";
  try { text = String(JSON.parse(raw).choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(); } catch { /* handled below */ }
  if (text.length < 10) throw new Error("The vision service returned no description for that image.");
  await db.prepare(`INSERT INTO image_descriptions (image_id,description,model) VALUES (?,?,?) ON CONFLICT (image_id) DO NOTHING`).run(id, text, VISION_MODEL());
  return text;
}

/** Replace image tokens in a stored chat message with the cached/generated descriptions, for the text-only tutor model. */
export async function expandImagesForTutor(content: string, opts: { generate: boolean }): Promise<string> {
  const ids = [...new Set([...String(content).matchAll(IMAGE_TOKEN_RE)].map((m) => m[1]))];
  if (!ids.length) return content;
  const descriptions = new Map<string, string>();
  for (const id of ids) {
    try {
      if (opts.generate) descriptions.set(id, await describeImage(id));
      else {
        const row = await getDb().prepare(`SELECT description FROM image_descriptions WHERE image_id=?`).get(id) as any;
        descriptions.set(id, row?.description || "(description unavailable)");
      }
    } catch (e: any) { if (opts.generate) throw e; descriptions.set(id, "(description unavailable)"); }
  }
  let n = 0;
  return String(content).replace(IMAGE_TOKEN_RE, (_m, id) => `\n[Student attached image ${++n}. Transcription by the vision system:\n${descriptions.get(id)}\n]\n`).trim();
}
