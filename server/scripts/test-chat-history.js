// Uses a unique test browser and removes only its records after the test.
const assert = require("node:assert/strict");
const { randomBytes, createHash } = require("node:crypto");
const { once } = require("node:events");
const { app } = require("../server");
const { pool } = require("../database");
const { initializeHistory } = require('../chat-history');

const token = randomBytes(32).toString("hex");
const otherToken = randomBytes(32).toString("hex");
const email = `guest-${createHash("sha256").update(token).digest("hex")}@chatbot.invalid`;
let server;
let base;
let captured;
let checks = 0;
const pass = (name) => { checks++; console.log(`PASS: ${name}`); };
async function request(route, body, identity = token, method) {
  const response = await fetch(base + route, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(identity ? { "X-Chat-Token": identity } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

(async () => {
  try {
    await initializeHistory();
    app.locals.generateReply = async (history) => { captured = history; return "Test answer"; };
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await request("/api/chats", null, null)).status, 401);
    pass("History requires browser identity");
    assert.deepEqual((await request("/api/chats")).data.sessions, []);
    pass("New browser has empty history");
    const first = await request("/message", { text: "History test question", fileContext: { name: "test.txt", content: "Saved context" } });
    assert.equal(first.status, 200);
    assert.equal(first.data.reply, "Test answer");
    assert.ok(first.data.sessionId);
    const id = first.data.sessionId;
    pass("First message creates conversation and reply");
    const listed = await request("/api/chats");
    assert.equal(listed.data.sessions.length, 1);
    assert.equal(listed.data.sessions[0].title, "History test question");
    pass("Conversation appears in history");
    const reopened = await request(`/api/chats/${id}/messages`);
    assert.deepEqual(reopened.data.messages.map((m) => m.role), ["user", "assistant"]);
    assert.equal(reopened.data.messages[0].file_name, "test.txt");
    assert.equal(reopened.data.messages[0].file_content, undefined);
    pass("Reopened conversation includes ordered messages and attachment name");
    assert.equal(captured[0].file_content, "Saved context");
    const second = await request("/message", { sessionId: id, text: "Follow-up question" });
    assert.equal(second.status, 200);
    assert.equal(second.data.sessionId, id);
    assert.equal(captured.length, 3);
    assert.equal(captured[1].content, "Test answer");
    pass("Follow-up uses saved conversation and file context");
    const [[count]] = await pool.execute("SELECT COUNT(*) AS total FROM chat_messages WHERE session_id=?", [id]);
    assert.equal(Number(count.total), 4);
    pass("Questions and answers persisted in MySQL");
    assert.deepEqual((await request("/api/chats", null, otherToken)).data.sessions, []);
    assert.equal((await request(`/api/chats/${id}/messages`, null, otherToken)).status, 404);
    assert.equal((await request("/message", { sessionId: id, text: "Unauthorized" }, otherToken)).status, 404);
    pass("Other browser cannot list, read, or append to conversation");
    assert.equal((await request("/message", { text: 42 })).status, 400);
    assert.equal((await request("/message", { text: "test", sessionId: "bad" })).status, 400);
    assert.equal((await request("/message", { text: "test", fileContext: { name: "bad.txt", content: 42 } })).status, 400);
    assert.equal((await request("/api/chats/bad/messages")).status, 400);
    pass("Malformed inputs rejected");
    app.locals.generateReply = async () => { const e = new Error("Test provider failure"); e.status = 429; throw e; };
    const failed = await request("/message", { sessionId: id, text: "Question during outage" });
    assert.equal(failed.status, 429);
    assert.equal(failed.data.sessionId, id);
    assert.equal(failed.data.saved, true);
    const afterFailure = await request(`/api/chats/${id}/messages`);
    assert.equal(afterFailure.data.messages.length, 5);
    assert.equal(afterFailure.data.messages[4].content, "Question during outage");
    pass("Provider failure retains question without saving error as assistant reply");
    app.locals.generateReply = async () => "New conversation answer";
    const fresh = await request("/message", { text: "A separate conversation" });
    assert.equal(fresh.status, 200);
    assert.notEqual(fresh.data.sessionId, id);
    assert.equal((await request("/api/chats")).data.sessions.length, 2);
    pass("New chat preserves previous conversations");
    const answerId = reopened.data.messages[1].message_id;
    const actionPath = `/api/chats/${id}/messages/${answerId}`;
    assert.equal((await request(`${actionPath}/feedback`, { rating: 1 })).status, 200);
    assert.equal(Number((await request(`/api/chats/${id}/messages`)).data.messages[1].rating), 1);
    assert.equal((await request(`${actionPath}/feedback`, { rating: -1 }, otherToken)).status, 404);
    assert.equal((await request(`${actionPath}/feedback`, { rating: 3 })).status, 400);
    assert.equal((await request(`${actionPath}/retry`, {}, otherToken)).status, 404);
    app.locals.generateReply = async (history) => { assert.equal(history.length, 1); return 'Retried answer'; };
    assert.equal((await request(`${actionPath}/retry`, {})).status, 200);
    const retried = (await request(`/api/chats/${id}/messages`)).data.messages;
    assert.equal(retried[1].content, 'Test answer');
    assert.equal(retried[retried.length - 1].content, 'Retried answer');
    pass('Feedback persists and retry uses original context, preserves replies, and enforces ownership');
    assert.equal((await request(`/api/chats/${id}`, { title: 'Renamed chat', pinned: true }, token, 'PATCH')).status, 200);
    let ordered = (await request('/api/chats')).data.sessions;
    assert.equal(String(ordered[0].session_id), id);
    assert.equal(ordered[0].title, 'Renamed chat');
    assert.equal(Number(ordered[0].pinned), 1);
    pass('Rename and pin persist; pinned chats sort first');
    assert.equal((await request(`/api/chats/${id}`, { title: 'Intrusion' }, otherToken, 'PATCH')).status, 404);
    assert.equal((await request(`/api/chats/${id}`, null, otherToken, 'DELETE')).status, 404);
    assert.equal((await request(`/api/chats/${id}`, { title: '' }, token, 'PATCH')).status, 400);
    assert.equal((await request(`/api/chats/${id}`, { pinned: 'true' }, token, 'PATCH')).status, 400);
    pass('Chat actions enforce ownership and validate inputs');
    assert.equal((await request(`/api/chats/${id}`, { pinned: false }, token, 'PATCH')).status, 200);
    assert.equal((await request(`/api/chats/${id}`, null, token, 'DELETE')).status, 200);
    assert.equal((await request(`/api/chats/${id}/messages`)).status, 404);
    const [[remaining]] = await pool.execute('SELECT COUNT(*) AS total FROM chat_messages WHERE session_id=?', [id]);
    assert.equal(Number(remaining.total), 0);
    assert.equal((await request('/api/chats')).data.sessions.length, 1);
    pass('Unpin and deletion work; deleted messages are removed and other chats remain');
    console.log(`${checks} chat-history checks passed. AI replies were mocked; MySQL was real.`);
  } catch (error) {
    console.error("Chat history test failed:", error.code || error.message);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
      await pool.execute("DELETE FROM users WHERE email=?", [email]);
      console.log("Removed test browser and its conversations.");
    } finally { await pool.end(); }
  }
})();
