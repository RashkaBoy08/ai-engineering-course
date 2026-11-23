import readline from "node:readline/promises";
import "dotenv/config";
import OpenAI from "openai";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY.");
  console.error("Set it in your environment or create a .env file.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function streamCompletion(messages, temperature) {
  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature,
    messages,
    stream: true,
  });

  let text = "";
  for await (const part of stream) {
    const content = part.choices[0]?.delta?.content;
    if (content) {
      process.stdout.write(content);
      text += content;
    }
  }
  process.stdout.write("\n");
  return text.trim();
}

async function askQuestion(question) {
  return rl.question(question);
}

async function main() {
  console.log("Smart Content Assistant\n");

  const topic = await askQuestion("Enter a topic: ");
  if (!topic.trim()) {
    throw new Error("Topic cannot be empty.");
  }

  const mode = (
    await askQuestion("Creative or factual? (creative/factual, default factual): ")
  )
    .trim()
    .toLowerCase();
  const temperature = mode === "creative" ? 0.9 : 0.2;

  const messages = [
    {
      role: "system",
      content:
        "You are a helpful content writing assistant. Be clear and useful.",
    },
  ];

  console.log("\nGenerating blog outline...\n");
  const outline = await streamCompletion(
    [
      ...messages,
      {
        role: "user",
        content: `Create a detailed blog post outline about "${topic}". Include a title, introduction, 4-6 main sections, and a conclusion. Use clear headings.`,
      },
    ],
    temperature,
  );

  console.log("\nSummary (2 sentences):\n");
  const summary = await streamCompletion(
    [
      ...messages,
      {
        role: "user",
        content: `Summarize this blog outline in exactly 2 sentences:\n\n${outline}`,
      },
    ],
    temperature,
  );

  const conversation = [
    ...messages,
    {
      role: "user",
      content: `Topic: "${topic}"\nBlog outline:\n${outline}`,
    },
    {
      role: "assistant",
      content: outline,
    },
  ];

  console.log("\nFollow-up mode (type 'exit' to quit).\n");
  while (true) {
    const question = await askQuestion("Question: ");
    if (question.trim().toLowerCase() === "exit") break;
    if (!question.trim()) continue;

    console.log();
    conversation.push({ role: "user", content: question });
    const answer = await streamCompletion(conversation, temperature);
    conversation.push({ role: "assistant", content: answer });
    console.log();
  }

  rl.close();
  console.log("\nSummary saved in this session:");
  console.log(summary);
}

main().catch((error) => {
  rl.close();
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
