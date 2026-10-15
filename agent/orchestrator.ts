import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const SYSTEM_PROMPT = `You are an SAT/PSAT tutor agent. You have tools connected via MCP \
servers for student data (profile, mastery, attempt logging), the question bank \
(fetching and adaptively selecting questions), and grading (determining correctness \
and verifying math).

Hard rules — follow these exactly:
1. NEVER decide whether an answer is correct yourself. Always call grade_answer for \
   any bank question, and report only what it returns.
2. NEVER state a numeric calculation result in an explanation without first verifying \
   it with verify_math_expression, if there's any chance of arithmetic error.
3. After grading any attempt (correct or incorrect), ALWAYS call log_attempt so mastery \
   stays accurate. Do this even if the student seems to want to move on quickly.
4. When the student asks for practice, call next_question rather than inventing a \
   question yourself — the bank is the only source of validated questions right now.
5. Teach Socratically by default: give a hint before a full solution, unless the \
   student explicitly asks for the full worked answer or has already gotten it wrong \
   twice on the same question.
6. If a tool call fails or returns no data (e.g. empty question bank for a skill), say \
   so plainly instead of inventing a question or a mastery number.
7. Keep responses focused and conversational — this is a tutoring chat, not a report.`;

interface McpServerHandle { name: string; client: Client; }
type ChatMessage = any;

export class TutorAgent {
  private messages: ChatMessage[] = [];
  private apiKey: string;

  constructor(apiKey?: string, private readonly studentId?: string) {
    this.apiKey = apiKey ?? process.env.GROQ_API_KEY ?? "";
    if (!this.apiKey) throw new Error("GROQ_API_KEY is not configured");
  }

  private servers: McpServerHandle[] = [];

  async connectServers() {
    // Compiled build (dist/*.js, production): run the compiled servers with plain node.
    // Source run (tsx, local dev): run the .ts servers through tsx.
    const compiled = __filename.endsWith(".js");
    const specs = [
      { name: "student-data", file: "servers/student-data/index" },
      { name: "question-bank", file: "servers/question-bank/index" },
      { name: "grading", file: "servers/grading/index" },
    ];
    // The MCP SDK only forwards a tiny whitelist of env vars by default, so pass the
    // full environment explicitly (DATABASE_URL etc. must reach the child servers).
    const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>;
    for (const spec of specs) {
      const transport = new StdioClientTransport(compiled
        ? { command: process.execPath, args: [path.join(ROOT, `${spec.file}.js`)], env }
        : { command: "npx", args: ["tsx", path.join(ROOT, `${spec.file}.ts`)], env });
      const client = new Client({ name: `tutor-agent-${spec.name}-client`, version: "0.1.0" });
      await client.connect(transport);
      this.servers.push({ name: spec.name, client });
    }
  }

  async close() { for (const s of this.servers) await s.client.close(); }

  private async listAllTools(): Promise<{ tools: any[]; ownerByName: Map<string, Client> }> {
    const tools: any[] = [];
    const ownerByName = new Map<string, Client>();
    for (const s of this.servers) {
      const res = await s.client.listTools();
      for (const t of res.tools) {
        tools.push({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema } });
        ownerByName.set(t.name, s.client);
      }
    }
    return { tools, ownerByName };
  }

  loadHistory(messages: Array<{ role: "user" | "assistant"; content: string }>) {
    this.messages = messages.map((m) => ({ role: m.role, content: m.content }));
  }

  private async chat(tools: any[]) {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: "system", content: SYSTEM_PROMPT }, ...this.messages], tools, tool_choice: "auto", temperature: 0.2, max_tokens: 1500 }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Groq API error ${res.status}: ${raw.slice(0, 500)}`);
    return JSON.parse(raw);
  }

  async sendMessage(userText: string, onEvent?: (event: string) => void): Promise<string> {
    this.messages.push({ role: "user", content: userText });
    const { tools, ownerByName } = await this.listAllTools();

    for (let turn = 0; turn < 8; turn++) {
      const response = await this.chat(tools);
      const message = response?.choices?.[0]?.message;
      if (!message) throw new Error("Groq returned an empty response");
      const toolCalls = message.tool_calls || [];
      if (!toolCalls.length) {
        const text = typeof message.content === "string" ? message.content : "";
        this.messages.push({ role: "assistant", content: text });
        return text;
      }

      this.messages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const name = call.function?.name;
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(call.function?.arguments || "{}"); } catch { input = {}; }
        onEvent?.(`[tool] ${name}(${JSON.stringify(input)})`);
        const client = ownerByName.get(name);
        if (!client) {
          this.messages.push({ role: "tool", tool_call_id: call.id, content: `Error: no server owns tool ${name}` });
          continue;
        }
        try {
          const toolArgs = { ...input };
          if (this.studentId && ["get_profile", "get_mastery", "log_attempt", "get_review_queue", "next_question"].includes(name)) toolArgs.student_id = this.studentId;
          const result = await client.callTool({ name, arguments: toolArgs });
          const text = (result.content as any[]).map((c) => c.type === "text" ? c.text : "").join("\n");
          this.messages.push({ role: "tool", tool_call_id: call.id, content: text || "(no tool output)" });
        } catch (e: any) {
          this.messages.push({ role: "tool", tool_call_id: call.id, content: `Error calling ${name}: ${e?.message || String(e)}` });
        }
      }
    }
    return "(stopped after too many tool-call turns — something may be looping)";
  }
}
