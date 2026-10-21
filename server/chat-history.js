const { createHash } = require("node:crypto");
const { pool } = require("./database");

function browserIdentity(req, res, next) {
  const token = req.get("X-Chat-Token");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(401).json({ reply: "Browser identity is missing. Refresh the page." });
  }
  req.chatEmail = `guest-${createHash("sha256").update(token).digest("hex")}@chatbot.invalid`;
  res.set("Cache-Control", "no-store");
  next();
}

async function getUser(email, db = pool) {
  const [rows] = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
  return rows[0]?.id;
}

async function listChats(email) {
  const [rows] = await pool.execute(
    `SELECT s.session_id, s.title, s.created_at,
      COALESCE(MAX(m.created_at), s.created_at) AS updated_at
     FROM chat_sessions s JOIN users u ON u.id = s.user_id
     LEFT JOIN chat_messages m ON m.session_id = s.session_id
     WHERE u.email = ? GROUP BY s.session_id
     ORDER BY updated_at DESC, s.session_id DESC LIMIT 100`, [email]);
  return rows;
}

async function readChat(email, sessionId, includeFiles = false) {
  const [sessions] = await pool.execute(
    `SELECT s.session_id, s.title FROM chat_sessions s
     JOIN users u ON u.id = s.user_id WHERE u.email = ? AND s.session_id = ?`,
    [email, sessionId]);
  if (!sessions.length) return null;
  const [messages] = await pool.execute(
    `SELECT message_id, role, content, created_at, file_name${includeFiles ? ", file_content" : ""}
     FROM chat_messages WHERE session_id = ? ORDER BY message_id`, [sessionId]);
  return { ...sessions[0], messages };
}

async function saveQuestion(email, sessionId, text, file) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    let userId = await getUser(email, db);
    if (sessionId) {
      const [sessions] = await db.execute(
        "SELECT session_id FROM chat_sessions WHERE session_id = ? AND user_id = ? FOR UPDATE",
        [sessionId, userId || 0]);
      if (!sessions.length) {
        const error = new Error("Conversation not found.");
        error.status = 404;
        throw error;
      }
    } else {
      if (!userId) {
        const [user] = await db.execute(
          "INSERT INTO users (username, email) VALUES ('Guest', ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)", [email]);
        userId = user.insertId;
      }
      const [session] = await db.execute(
        "INSERT INTO chat_sessions (user_id, title) VALUES (?, ?)",
        [userId, text.slice(0, 100)]);
      sessionId = String(session.insertId);
    }
    await db.execute(
      "INSERT INTO chat_messages (session_id, role, content, file_name, file_content) VALUES (?, 'user', ?, ?, ?)",
      [sessionId, text, file?.name || null, file?.content ?? null]);
    await db.commit();
    return String(sessionId);
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

module.exports = { browserIdentity, listChats, readChat, saveQuestion };
