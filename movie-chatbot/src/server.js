import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectDatabase } from "./database.js";
import { executeTool, queryDatabase, toolDefinitions } from "./tools.js";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(appDirectory, "..", "public");
const app = express();
const port = Number(process.env.PORT ?? 3000);
const maximumHistoryLength = 20;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(publicDirectory));

function isNonEmptyString(value, maximumLength = 200) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function friendlyError(error) {
  if (error?.name === "MongoServerSelectionError") {
    return "The database is temporarily unavailable. Check that MongoDB is running and try again.";
  }
  if (error?.status === 401 || error?.status === 403) {
    return "The AI service rejected its API key. Check OPENAI_API_KEY.";
  }
  return error?.message || "Something went wrong. Please try again.";
}

function apiError(response, status, message) {
  return response.status(status).json({ error: message });
}

function createConversationId(value) {
  return value ?? randomUUID();
}

async function saveToolUsage(db, { userId, conversationId, tool, error }) {
  await db.collection("tool_usage").insertOne({
    id: randomUUID(),
    userId,
    conversationId,
    tool,
    status: error ? "error" : "success",
    ...(error ? { error } : {}),
    createdAt: new Date(),
  });
}

app.get("/api/health", async (_request, response) => {
  try {
    await app.locals.db.command({ ping: 1 });
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    apiError(response, 503, friendlyError(error));
  }
});

app.post("/api/database", async (request, response) => {
  try {
    const result = await queryDatabase(app.locals.db, request.body ?? {});
    return response.json(result);
  } catch (error) {
    return apiError(response, 400, friendlyError(error));
  }
});

app.post("/api/chat", async (request, response) => {
  const { message, conversationId: requestedConversationId } = request.body ?? {};
  if (!isNonEmptyString(message, 2000)) {
    return apiError(response, 400, "Enter a message of up to 2000 characters.");
  }
  if (requestedConversationId !== undefined && !isNonEmptyString(requestedConversationId, 100)) {
    return apiError(response, 400, "Conversation ID is invalid.");
  }
  if (!process.env.OPENAI_API_KEY) {
    return apiError(response, 503, "Chat is unavailable. Set OPENAI_API_KEY in the app's .env file.");
  }

  const db = app.locals.db;
  const userId = "guest";
  const conversationId = createConversationId(requestedConversationId);
  const conversations = db.collection("conversations");

  try {
    const existing = await conversations.findOne({ id: conversationId, userId });
    const preference = await db.collection("preferences").findOne({ userId });
    const history = (existing?.messages ?? []).slice(-maximumHistoryLength);
    const userMessage = { role: "user", content: message.trim() };
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful movie and jokes chatbot. Use the provided tools for factual database, movie, and joke requests. " +
          "Never claim a tool succeeded if its result contains an error. Explain when movie recommendations come from the local cache.",
      },
      ...(preference?.favoriteGenre
        ? [{ role: "system", content: `The user's preferred movie genre is ${preference.favoriteGenre}.` }]
        : []),
      ...history,
      userMessage,
    ];

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const firstResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: toolDefinitions,
      tool_choice: "auto",
    });
    const assistantMessage = firstResponse.choices[0]?.message;
    if (!assistantMessage) {
      throw new Error("The AI service returned an empty response.");
    }

    const toolResults = [];
    let reply = assistantMessage.content ?? "";
    if (assistantMessage.tool_calls?.length) {
      const selectedCalls = assistantMessage.tool_calls.slice(0, 3);
      const toolMessages = [];
      for (const call of selectedCalls) {
        const toolName = call.function?.name;
        let args = {};
        try {
          if (!["database_query", "movie_lookup", "jokes"].includes(toolName)) {
            throw new Error("The AI requested an unsupported tool.");
          }
          args = JSON.parse(call.function.arguments || "{}");
          const data = await executeTool(db, toolName, args);
          toolResults.push({ tool: toolName, args, data });
          toolMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(data),
          });
          await saveToolUsage(db, { userId, conversationId, tool: toolName });
        } catch (error) {
          const messageText = friendlyError(error);
          toolResults.push({
            tool: toolName || "unknown",
            args,
            data: { kind: "error", message: messageText },
          });
          toolMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: messageText }),
          });
          await saveToolUsage(db, {
            userId,
            conversationId,
            tool: toolName || "unknown",
            error: messageText,
          });
        }
      }

      const finalResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          ...messages,
          {
            role: "assistant",
            content: assistantMessage.content,
            tool_calls: selectedCalls,
          },
          ...toolMessages,
        ],
      });
      reply = finalResponse.choices[0]?.message?.content ?? "";
    }

    if (!reply.trim()) {
      reply = toolResults.some(({ data }) => data.kind === "error")
        ? "I couldn't complete that request. See the tool error below and try again."
        : "I finished the tool request, but the AI service did not provide a text response.";
    }

    const storedMessages = [
      ...history,
      userMessage,
      { role: "assistant", content: reply },
    ].slice(-maximumHistoryLength);
    await conversations.updateOne(
      { id: conversationId, userId },
      {
        $set: { messages: storedMessages, updatedAt: new Date() },
        $setOnInsert: { id: conversationId, userId, createdAt: new Date() },
      },
      { upsert: true },
    );

    return response.json({ conversationId, reply, toolResults });
  } catch (error) {
    return apiError(response, 502, friendlyError(error));
  }
});

app.delete("/api/conversations/:id", async (request, response) => {
  try {
    await app.locals.db.collection("conversations").deleteOne({
      id: request.params.id,
      userId: "guest",
    });
    return response.json({ cleared: true });
  } catch (error) {
    return apiError(response, 503, friendlyError(error));
  }
});

app.get("/api/conversations/:id", async (request, response) => {
  try {
    const conversation = await app.locals.db.collection("conversations").findOne(
      { id: request.params.id, userId: "guest" },
      { projection: { _id: 0, id: 1, messages: 1 } },
    );
    return response.json({ messages: conversation?.messages ?? [] });
  } catch (error) {
    return apiError(response, 503, friendlyError(error));
  }
});

app.get("/api/preferences", async (_request, response) => {
  try {
    const preferences = await app.locals.db.collection("preferences")
      .findOne({ userId: "guest" }, { projection: { _id: 0 } });
    return response.json(preferences ?? { userId: "guest", favoriteGenre: "" });
  } catch (error) {
    return apiError(response, 503, friendlyError(error));
  }
});

app.put("/api/preferences", async (request, response) => {
  const { favoriteGenre } = request.body ?? {};
  if (typeof favoriteGenre !== "string" || favoriteGenre.length > 60) {
    return apiError(response, 400, "Favorite genre must be a string of up to 60 characters.");
  }
  try {
    await app.locals.db.collection("preferences").updateOne(
      { userId: "guest" },
      {
        $set: { favoriteGenre: favoriteGenre.trim(), updatedAt: new Date() },
        $setOnInsert: { userId: "guest", createdAt: new Date() },
      },
      { upsert: true },
    );
    return response.json({ userId: "guest", favoriteGenre: favoriteGenre.trim() });
  } catch (error) {
    return apiError(response, 503, friendlyError(error));
  }
});

app.post("/api/jokes/:id/vote", async (request, response) => {
  const { vote } = request.body ?? {};
  if (!isNonEmptyString(request.params.id, 120) || (vote !== "up" && vote !== "down")) {
    return apiError(response, 400, "Choose thumbs up or thumbs down for a valid joke.");
  }
  try {
    const collection = app.locals.db.collection("jokes");
    const result = await collection.updateOne(
      { id: request.params.id },
      { $inc: { [`votes.${vote}`]: 1 } },
    );
    if (result.matchedCount !== 1) {
      return apiError(response, 404, "That joke could not be found.");
    }
    const joke = await collection.findOne(
      { id: request.params.id },
      { projection: { _id: 0 } },
    );
    return response.json({ joke });
  } catch (error) {
    return apiError(response, 503, friendlyError(error));
  }
});

app.use((error, _request, response, _next) => {
  if (error?.type === "entity.parse.failed") {
    return apiError(response, 400, "Request body must contain valid JSON.");
  }
  if (error?.type === "entity.too.large") {
    return apiError(response, 413, "Request body is too large.");
  }
  return apiError(response, 500, friendlyError(error));
});

async function start() {
  let connection;
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be a whole number between 1 and 65535.");
    }
    connection = await connectDatabase(
      process.env.MONGODB_URI,
      process.env.MONGODB_DATABASE ?? "movie_chatbot",
    );
    app.locals.db = connection.db;
    const server = app.listen(port, () => {
      console.log(`Movie Chatbot is running at http://localhost:${port}`);
    });
    server.on("error", async (error) => {
      console.error(`\nUnable to start Movie Chatbot: ${friendlyError(error)}`);
      process.exitCode = 1;
      await connection.client.close();
    });

    const shutdown = async () => {
      await new Promise((resolve) => server.close(resolve));
      await connection.client.close();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    console.error(`\nUnable to start Movie Chatbot: ${friendlyError(error)}`);
    process.exitCode = 1;
    await connection?.client.close();
  }
}

start();
