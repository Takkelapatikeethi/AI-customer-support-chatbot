const { pool, checkDatabase } = require("./database");

const express = require("express");
const cors = require("cors");
const { createDatabaseReply } = require('./database-answers');
const { browserIdentity, listChats, readChat, saveQuestion, initializeHistory, installHistoryActions } = require("./chat-history");
const { installAuth, initializeAuth, origin } = require('./auth');

const app = express();
const port = process.env.PORT || 5000;
app.use(cors({ origin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
installAuth(app);
installHistoryActions(app);

function getReplyError(error) {
  return {
    status: error.status === 429 ? 429 : 503,
    reply: "The answer database is temporarily unavailable. Please try again.",
  };
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

app.locals.generateReply = createDatabaseReply;
app.post('/api/chats/:sessionId/messages/:messageId/retry', browserIdentity, async (req, res) => {
  if (![req.params.sessionId, req.params.messageId].every((id) => /^[1-9]\d{0,19}$/.test(id))) return res.status(400).json({ reply: 'Invalid reply ID.' });
  try {
    const chat = await readChat(req.chatEmail, req.params.sessionId, true);
    const index = chat?.messages.findIndex((m) => String(m.message_id) === req.params.messageId && m.role === 'assistant');
    if (!chat || index < 0) return res.status(404).json({ reply: 'Reply not found.' });
    const history = chat.messages.slice(0, index);
    if (!history.some((m) => m.role === 'user')) return res.status(400).json({ reply: 'No question to retry.' });
    const reply = await app.locals.generateReply(history);
    if (!reply) throw new Error('Empty reply');
    await pool.execute("INSERT INTO chat_messages (session_id,role,content) VALUES (?,'assistant',?)", [req.params.sessionId, reply]);
    res.json({ ok: true });
  } catch (error) {
    const result = getReplyError(error);
    res.status(result.status).json({ reply: result.reply });
  }
});

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
    if (!reply) throw new Error("Empty database answer");
  } catch (error) {
    console.error("Answer lookup failed:", error.code || "DATABASE_ERROR");

    const { status, reply } = getReplyError(error);
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
  await initializeAuth();
  await initializeHistory();
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
