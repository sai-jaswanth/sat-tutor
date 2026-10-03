import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function testServer(name: string, file: string) {
  const transport = new StdioClientTransport({ command: "npx", args: ["tsx", file] });
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(`\n=== ${name} tools ===`);
  console.log(tools.tools.map(t => t.name).join(", "));
  return client;
}

async function main() {
  const qb = await testServer("question-bank", "servers/question-bank/index.ts");
  const next = await qb.callTool({ name: "next_question", arguments: { student_id: "student_demo", skill: "math.algebra.linear_equations" } });
  console.log("next_question result:", (next.content as any)[0].text);

  const grading = await testServer("grading", "servers/grading/index.ts");
  const grade = await grading.callTool({ name: "grade_answer", arguments: { question_id: "q_math_linear_1", student_answer: "5" } });
  console.log("grade_answer result:", (grade.content as any)[0].text);

  const grade2 = await grading.callTool({ name: "grade_answer", arguments: { question_id: "q_math_linear_1", student_answer: "7" } });
  console.log("grade_answer (wrong) result:", (grade2.content as any)[0].text);

  const verify = await grading.callTool({ name: "verify_math_expression", arguments: { expression: "(13-5)/(6-2)" } });
  console.log("verify_math_expression result:", (verify.content as any)[0].text);

  const sd = await testServer("student-data", "servers/student-data/index.ts");
  const log = await sd.callTool({ name: "log_attempt", arguments: {
    student_id: "student_demo", question_id: "q_math_linear_1", skill: "math.algebra.linear_equations",
    student_answer: "5", is_correct: true, difficulty: 1, time_seconds: 12, hints_used: 0
  }});
  console.log("log_attempt result:", (log.content as any)[0].text);

  const mastery = await sd.callTool({ name: "get_mastery", arguments: { student_id: "student_demo" } });
  console.log("get_mastery result:", (mastery.content as any)[0].text);

  await qb.close(); await grading.close(); await sd.close();
}

main().catch(e => { console.error(e); process.exit(1); });
