import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { TutorAgent } from "./orchestrator.js";

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error(
      "GROQ_API_KEY is not set. Run:\n  export GROQ_API_KEY=gsk_...\nthen re-run `npm run chat`."
    );
    process.exit(1);
  }

  console.log("Connecting to MCP servers (student-data, question-bank, grading)...");
  const agent = new TutorAgent();
  await agent.connectServers();
  console.log("Connected. Demo student id is 'student_demo'. Type your message (or 'exit').\n");

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    while (true) {
      const userInput = await rl.question("you> ");
      if (userInput.trim().toLowerCase() === "exit") break;

      const reply = await agent.sendMessage(userInput, (event) => console.log(event));
      console.log(`\ntutor> ${reply}\n`);
    }
  } finally {
    rl.close();
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
