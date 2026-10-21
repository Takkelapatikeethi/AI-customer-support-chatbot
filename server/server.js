const { pool, checkDatabase } = require("./database");

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { browserIdentity, listChats, readChat, saveQuestion } = require("./chat-history");

const app = express();
const port = process.env.PORT || 5000;
const apiBaseUrl = process.env.OPENAI_BASE_URL;
const providerName = apiBaseUrl ? "AI provider" : "OpenAI";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(apiBaseUrl ? { baseURL: apiBaseUrl } : {}),
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function getOpenAIErrorReply(error) {
  if (error.code === "insufficient_quota") {
    return {
      status: 429,
      reply:
        `${providerName} quota exceeded. Please check your billing or credits.`,
    };
  }

  if (error.status === 401 || error.code === "invalid_api_key") {
    return {
      status: 401,
      reply: `${providerName} API key is invalid. Please check server/.env.`,
    };
  }

  if (error.status === 429) {
    return {
      status: 429,
      reply: `${providerName} is rate limiting requests. Please try again shortly.`,
    };
  }

  return {
    status: 500,
    reply: `Sorry, I could not get a response from ${providerName} right now.`,
  };
}

function isOpenRouter() {
  return apiBaseUrl && apiBaseUrl.includes("openrouter.ai");
}

function buildUserInput(userMessage, fileContext) {
  if (!fileContext?.content) {
    return userMessage;
  }

  return [
    "Use the uploaded file information as context when it is relevant.",
    `Uploaded file: ${fileContext.name || "uploaded-file"}`,
    "",
    fileContext.content,
    "",
    `User question: ${userMessage}`,
  ].join("\n");
}

async function createChatbotReply(history) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const instructions = "You are a helpful, friendly chatbot. Keep replies concise.";
  const input = history.slice(-40).map((message) => ({
    role: message.role,
    content: buildUserInput(message.content, message.file_name
      ? { name: message.file_name, content: message.file_content } : null),
  }));

  if (isOpenRouter()) {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: instructions },
        ...input,
      ],
    });

    return response.choices?.[0]?.message?.content;
  }

  const response = await openai.responses.create({
    model,
    instructions,
    input,
  });

  return response.output_text;
}

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.get("/health/db", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await checkDatabase();
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Database health check failed:", error.code || "DATABASE_ERROR");
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.locals.generateReply = createChatbotReply;

app.get("/api/chats", browserIdentity, async (req, res) => {
  try {
    res.json({ sessions: await listChats(req.chatEmail) });
  } catch (error) {
    console.error("History list failed:", error.code || "DATABASE_ERROR");
    res.status(503).json({ reply: "Could not load chat history. Please try again." });
  }
});

app.get("/api/chats/:sessionId/messages", browserIdentity, async (req, res) => {
  if (!/^[1-9]\d{0,19}$/.test(req.params.sessionId)) {
    return res.status(400).json({ reply: "Invalid conversation ID." });
  }
  try {
    const chat = await readChat(req.chatEmail, req.params.sessionId);
    if (!chat) return res.status(404).json({ reply: "Conversation not found." });
    res.json(chat);
  } catch (error) {
    console.error("History read failed:", error.code || "DATABASE_ERROR");
    res.status(503).json({ reply: "Could not load this conversation. Please try again." });
  }
});

app.post("/message", browserIdentity, async (req, res) => {
  const userMessage = req.body.text;
  const fileContext = req.body.fileContext;

  if (typeof userMessage !== "string" || !userMessage.trim()) {
    return res.status(400).json({ reply: "Please send a message." });
  }

  if (userMessage.length > 20000 || (req.body.sessionId != null &&
    !/^[1-9]\d{0,19}$/.test(String(req.body.sessionId)))) {
    return res.status(400).json({ reply: "Invalid message or conversation ID." });
  }
  if (fileContext != null && (typeof fileContext.name !== "string" ||
    !fileContext.name || fileContext.name.length > 255 ||
    typeof fileContext.content !== "string" ||
    Buffer.byteLength(fileContext.content, "utf8") > 150 * 1024)) {
    return res.status(400).json({ reply: "Please upload a text file smaller than 150 KB." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      reply: "API key is missing. Add OPENAI_API_KEY to server/.env.",
    });
  }

  let sessionId;
  try {
    sessionId = await saveQuestion(req.chatEmail, req.body.sessionId, userMessage.trim(), fileContext);
  } catch (error) {
    console.error("Saving question failed:", error.code || "DATABASE_ERROR");
    return res.status(error.status || 503).json({ reply: error.status === 404
      ? "Conversation not found." : "Your message could not be saved. Please try again." });
  }

  let reply;
  try {
    const chat = await readChat(req.chatEmail, sessionId, true);
    reply = await app.locals.generateReply(chat.messages);
    if (!reply) throw new Error("Empty AI response");
  } catch (error) {
    console.error(`${providerName} API error:`, error.code || error.status || "AI_ERROR");

    const { status, reply } = getOpenAIErrorReply(error);
    return res.status(status).json({ reply, sessionId, saved: true });
  }
  try {
    await pool.execute("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)",
      [sessionId, reply]);
    res.json({ reply, sessionId, saved: true });
  } catch (error) {
    console.error("Saving response failed:", error.code || "DATABASE_ERROR");
    res.status(503).json({ reply: "Your question was saved, but the response could not be saved. Please try again.", sessionId, saved: true });
  }
});

async function startServer() {
  await checkDatabase();
  console.log("Database connected");
  const server = app.listen(port);
  server.once("listening", () => {
    console.log(`Server running on port ${server.address().port}`);
  });

  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      try {
        await pool.end();
      } catch {
        process.exitCode = 1;
      }
    });
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.on("error", async (error) => {
    console.error("Server failed:", error.code || "SERVER_ERROR");
    process.exitCode = 1;
    await pool.end();
  });
  return server;
}

if (require.main === module) {
  startServer().catch(async (error) => {
    console.error("Backend startup failed:", error.code || "DATABASE_ERROR");
    process.exitCode = 1;
    await pool.end();
  });
}

module.exports = { app, startServer };
