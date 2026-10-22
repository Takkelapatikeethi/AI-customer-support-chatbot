const { createHash } = require("node:crypto");
const { pool } = require("./database");
const { account, sessionToken } = require('./auth');

async function browserIdentity(req, res, next) {
  res.set('Cache-Control', 'no-store');
  try {
    if (sessionToken(req)) {
      const user = await account(req);
      if (!user) return res.status(401).json({ reply: 'Your login expired. Please log in again.' });
      req.chatEmail = user.email;
      return next();
    }
  } catch { return res.status(503).json({ reply: 'Could not verify your account. Please try again.' }); }
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
    `SELECT s.session_id, s.title, s.created_at, COALESCE(p.pinned, 0) AS pinned,
      COALESCE(MAX(m.created_at), s.created_at) AS updated_at
     FROM chat_sessions s JOIN users u ON u.id = s.user_id
     LEFT JOIN chat_messages m ON m.session_id = s.session_id
     LEFT JOIN chat_preferences p ON p.session_id = s.session_id
     WHERE u.email = ? GROUP BY s.session_id
     ORDER BY pinned DESC, updated_at DESC, s.session_id DESC LIMIT 100`, [email]);
  return rows;
}

async function readChat(email, sessionId, includeFiles = false) {
  const [sessions] = await pool.execute(
    `SELECT s.session_id, s.title FROM chat_sessions s
     JOIN users u ON u.id = s.user_id WHERE u.email = ? AND s.session_id = ?`,
    [email, sessionId]);
  if (!sessions.length) return null;
  const [messages] = await pool.execute(
    `SELECT message_id, role, content, created_at, file_name, (SELECT rating FROM reply_ratings r WHERE r.message_id=chat_messages.message_id) AS rating${includeFiles ? ", file_content" : ""}
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

async function initializeHistory() {
  await pool.query(`CREATE TABLE IF NOT EXISTS reply_ratings (message_id BIGINT UNSIGNED PRIMARY KEY, rating TINYINT NOT NULL, FOREIGN KEY (message_id) REFERENCES chat_messages(message_id) ON DELETE CASCADE) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_preferences (
    session_id BIGINT UNSIGNED PRIMARY KEY, pinned BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
}

function installHistoryActions(app) {
  const handle = (fn) => async (req, res) => {
    if (!/^[1-9]\d{0,19}$/.test(req.params.sessionId)) return res.status(400).json({ reply: 'Invalid conversation ID.' });
    try { await fn(req, res); }
    catch (error) { console.error('Chat action failed:', error.code || 'DATABASE_ERROR'); res.status(503).json({ reply: 'Could not update conversation. Please try again.' }); }
  };
  app.post('/api/chats/:sessionId/messages/:messageId/feedback', browserIdentity, handle(async (req, res) => {
    if (!/^[1-9]\d{0,19}$/.test(req.params.messageId) || ![-1, 0, 1].includes(req.body.rating)) return res.status(400).json({ reply: 'Invalid feedback.' });
    const [owned] = await pool.execute("SELECT m.message_id FROM chat_messages m JOIN chat_sessions s ON s.session_id=m.session_id JOIN users u ON u.id=s.user_id WHERE u.email=? AND s.session_id=? AND m.message_id=? AND m.role='assistant'", [req.chatEmail, req.params.sessionId, req.params.messageId]);
    if (!owned.length) return res.status(404).json({ reply: 'Reply not found.' });
    await pool.execute('INSERT INTO reply_ratings (message_id,rating) VALUES (?,?) ON DUPLICATE KEY UPDATE rating=VALUES(rating)', [req.params.messageId, req.body.rating]);
    res.json({ ok: true });
  }));
  app.patch('/api/chats/:sessionId', browserIdentity, handle(async (req, res) => {
    const { title, pinned } = req.body;
    if ((title === undefined && pinned === undefined) || (title !== undefined && (typeof title !== 'string' || !title.trim() || title.trim().length > 100)) || (pinned !== undefined && typeof pinned !== 'boolean')) return res.status(400).json({ reply: 'Use a title of 1–100 characters and a valid pin option.' });
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      const [owned] = await db.execute('SELECT s.session_id FROM chat_sessions s JOIN users u ON u.id=s.user_id WHERE s.session_id=? AND u.email=? FOR UPDATE', [req.params.sessionId, req.chatEmail]);
      if (!owned.length) { await db.rollback(); return res.status(404).json({ reply: 'Conversation not found.' }); }
      if (title !== undefined) await db.execute('UPDATE chat_sessions SET title=? WHERE session_id=?', [title.trim(), req.params.sessionId]);
      if (pinned !== undefined) await db.execute('INSERT INTO chat_preferences (session_id,pinned) VALUES (?,?) ON DUPLICATE KEY UPDATE pinned=VALUES(pinned)', [req.params.sessionId, pinned]);
      await db.commit(); res.json({ ok: true });
    } catch (err) { await db.rollback(); throw err; } finally { db.release(); }
  }));
  app.delete('/api/chats/:sessionId', browserIdentity, handle(async (req, res) => {
    const [result] = await pool.execute('DELETE s FROM chat_sessions s JOIN users u ON u.id=s.user_id WHERE s.session_id=? AND u.email=?', [req.params.sessionId, req.chatEmail]);
    if (!result.affectedRows) return res.status(404).json({ reply: 'Conversation not found.' });
    res.json({ ok: true });
  }));
}
module.exports = { browserIdentity, listChats, readChat, saveQuestion, initializeHistory, installHistoryActions };
