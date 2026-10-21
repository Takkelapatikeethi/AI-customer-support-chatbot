import React, { useEffect, useRef, useState } from "react";

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";
const storedMessages = (rows) => rows.map((row) => ({
  text: row.content, sender: row.role === "user" ? "user" : "bot",
  time: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  fileName: row.file_name,
}));
function browserToken() {
  try {
    let token = localStorage.getItem("chatbot-browser-token");
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("chatbot-browser-token", token);
    }
    return token;
  } catch { return null; }
}
async function chatRequest(path, token, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options, headers: { "Content-Type": "application/json", "X-Chat-Token": token, ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.reply || "Could not load chat history.");
  return data;
}
function rememberSession(id) {
  try {
    if (id) localStorage.setItem("chatbot-active-session", id);
    else localStorage.removeItem("chatbot-active-session");
  } catch { /* The current conversation can still be used without remembering it. */ }
}

const getTime = () => {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

function App() {
  const [message, setMessage] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [messages, setMessages] = useState([
    {
      text: "Welcome! How can I help you today?",
      sender: "bot",
      time: getTime(),
    },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [token] = useState(browserToken);
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!token) throw new Error("Enable browser storage to save and reopen chats.");
        const data = await chatRequest("/api/chats", token);
        if (cancelled) return;
        setSessions(data.sessions);
        const previous = localStorage.getItem("chatbot-active-session");
        if (previous && data.sessions.some((s) => String(s.session_id) === previous)) {
          const chat = await chatRequest(`/api/chats/${previous}/messages`, token);
          if (cancelled) return;
          setSessionId(previous);
          setMessages(storedMessages(chat.messages));
        }
      } catch (err) { if (!cancelled) setError(err.message); }
      finally { if (!cancelled) setHistoryLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const openChat = async (id) => {
    if (isTyping || historyLoading) return;
    setHistoryLoading(true);
    setError("");
    try {
      const chat = await chatRequest(`/api/chats/${id}/messages`, token);
      setSessionId(String(id));
      rememberSession(String(id));
      setMessages(storedMessages(chat.messages));
      setMessage("");
      setUploadedFile(null);
      setActiveTab("chat");
    } catch (err) { setError(err.message); }
    finally { setHistoryLoading(false); }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async () => {
    const userText = message.trim();
    if ((userText === "" && !uploadedFile) || isTyping || historyLoading || !token) return;

    setError("");
    const previousMessages = messages;

    setMessage("");
    setIsTyping(true);
    const fileToSend = uploadedFile;
    setUploadedFile(null);

    setMessages((prev) => [
      ...prev,
      {
        text: userText || "Please review this file.",
        sender: "user",
        time: getTime(),
        fileName: fileToSend?.name,
      },
    ]);

    try {
      const response = await fetch(`${API_BASE}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Chat-Token": token,
        },
        body: JSON.stringify({
          sessionId,
          text: userText || "Please review this uploaded file.",
          fileContext: fileToSend
            ? {
                name: fileToSend.name,
                content: fileToSend.content,
              }
            : null,
        }),
      });

      const data = await response.json();
      if (data.sessionId) {
        const id = String(data.sessionId);
        setSessionId(id);
        rememberSession(id);
        const chat = await chatRequest(`/api/chats/${id}/messages`, token);
        setMessages(storedMessages(chat.messages));
      }
      if (!response.ok) {
        if (!data.saved) {
          setMessages(previousMessages);
          setMessage(userText);
          setUploadedFile(fileToSend);
        }
        setError(data.reply || "Could not send your message.");
      }
    } catch (error) {
      setError("Could not confirm your message was saved. Check chat history before retrying.");
    } finally {
      try {
        const data = await chatRequest("/api/chats", token);
        setSessions(data.sessions);
      } catch { setError((current) => current || "Could not refresh chat history. Please refresh the page."); }
      setIsTyping(false);
    }
  };

  const clearChat = () => {
    if (isTyping || historyLoading) return;
    setSessionId(null);
    rememberSession(null);
    setMessage("");
    setError("");
    setActiveTab("chat");
    setUploadedFile(null);
    setMessages([
      {
        text: "Welcome! How can I help you today?",
        sender: "bot",
        time: getTime(),
      },
    ]);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxSize = 150 * 1024;
    const allowedTypes = [
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
    ];
    const allowedExtensions = [".txt", ".md", ".csv", ".json"];
    const lowerName = file.name.toLowerCase();
    const isAllowed =
      allowedTypes.includes(file.type) ||
      allowedExtensions.some((extension) => lowerName.endsWith(extension));

    if (!isAllowed) {
      setMessages((prev) => [
        ...prev,
        {
          text: "Please upload a text file: TXT, MD, CSV, or JSON.",
          sender: "bot",
          time: getTime(),
        },
      ]);
      event.target.value = "";
      return;
    }

    if (file.size > maxSize) {
      setMessages((prev) => [
        ...prev,
        {
          text: "Please upload a file smaller than 150 KB.",
          sender: "bot",
          time: getTime(),
        },
      ]);
      event.target.value = "";
      return;
    }

    const content = await file.text();
    setUploadedFile({
      name: file.name,
      content,
    });
    event.target.value = "";
  };

  return (
    <div style={styles.container}>
      <div className="chat-layout">
      <aside className="chat-history" aria-label="Chat history">
        <h2>Chat history</h2>
        <button className="new-chat" type="button" onClick={clearChat} disabled={isTyping || historyLoading}>+ New chat</button>
        <p className="history-note">Saved for this browser</p>
        {historyLoading && <p role="status">Loading conversations…</p>}
        {!historyLoading && sessions.length === 0 && <p>No saved chats yet. Send a message to start.</p>}
        <div className="history-list">
          {sessions.map((session) => (
            <button key={session.session_id} type="button"
              className={`history-item ${String(session.session_id) === sessionId ? "selected" : ""}`}
              aria-current={String(session.session_id) === sessionId ? "true" : undefined}
              disabled={isTyping || historyLoading} onClick={() => openChat(session.session_id)}>
              <span>{session.title || "Untitled conversation"}</span>
              <small>{new Date(session.updated_at).toLocaleDateString()}</small>
            </button>
          ))}
        </div>
      </aside>
      <div style={styles.chatBox}>
        <div style={styles.header}>
          <div>
            <div style={styles.headerTitle}>Support Assistant</div>
            <div style={styles.headerSubtitle}>Online and ready to help</div>
          </div>

          <button style={styles.clearButton} onClick={clearChat} type="button" disabled={isTyping || historyLoading}>
            New chat
          </button>
        </div>

        {error && <div className="chat-error" role="alert">{error}</div>}

        <div style={styles.tabBar}>
          {[
            { id: "chat", label: "Chat" },
            { id: "faq", label: "FAQ" },
            { id: "contact", label: "Contact" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              style={{
                ...styles.tabButton,
                ...(activeTab === tab.id ? styles.activeTabButton : {}),
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "chat" && (
          <>
            <div style={styles.messages}>
              {messages.map((msg, index) => (
                <div
                  key={index}
                  style={{
                    ...styles.messageRow,
                    justifyContent:
                      msg.sender === "user" ? "flex-end" : "flex-start",
                    alignItems: "center",
                  }}
                >
                  {msg.sender === "bot" && (
                    <img
                      src="/robot-avatar.svg"
                      alt="Robot"
                      style={styles.botAvatar}
                    />
                  )}

                  <div
                    style={{
                      ...styles.messageBubble,
                      backgroundColor:
                        msg.sender === "user" ? "#2563eb" : "#f3f4f6",
                      color: msg.sender === "user" ? "#fff" : "#111827",
                    }}
                  >
                    {msg.fileName && (
                      <div style={styles.attachmentInMessage}>
                        <span style={styles.attachmentIcon}>+</span>
                        {msg.fileName}
                      </div>
                    )}
                    <div>{msg.text}</div>
                    <div style={styles.time}>{msg.time}</div>
                  </div>

                  {msg.sender === "user" && (
                    <img
                      src="/user-avatar.svg"
                      alt="User"
                      style={styles.userAvatar}
                    />
                  )}
                </div>
              ))}

              {isTyping && (
                <div
                  style={{ ...styles.messageRow, justifyContent: "flex-start" }}
                >
                  <img
                    src="/robot-avatar.svg"
                    alt="Robot"
                    style={styles.botAvatar}
                  />
                  <div
                    style={{
                      ...styles.messageBubble,
                      backgroundColor: "#f3f4f6",
                    }}
                  >
                    <div className="typing">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {uploadedFile && (
              <div style={styles.pendingAttachmentWrap}>
                <div style={styles.pendingAttachment}>
                  <span style={styles.pendingAttachmentIcon}>+</span>
                  <span style={styles.pendingAttachmentName}>
                    {uploadedFile.name}
                  </span>
                  <button
                    type="button"
                    style={styles.removeAttachmentButton}
                    onClick={() => setUploadedFile(null)}
                    title="Remove file"
                  >
                    x
                  </button>
                </div>
              </div>
            )}

            <div style={styles.inputArea}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json"
                style={styles.hiddenFileInput}
                onChange={handleFileUpload}
              />
              <button
                style={styles.uploadButton}
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isTyping || historyLoading || !token}
                title="Upload file"
              >
                +
              </button>
              <textarea
                style={styles.input}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type a message..."
                aria-label="Message"
                disabled={isTyping || historyLoading || !token}
                rows={1}
              />

              <button
                style={styles.button}
                onClick={handleSend}
                disabled={isTyping || historyLoading || !token || (message.trim() === "" && !uploadedFile)}
              >
                Send
              </button>
            </div>
          </>
        )}

        {activeTab === "faq" && (
          <div style={styles.tabPanel}>
            <h3 style={styles.panelTitle}>Frequently Asked Questions</h3>
            <div style={styles.infoCard}>
              <strong>What can this assistant do?</strong>
              <p style={styles.infoText}>
                It can answer questions, explain services, and help with basic
                support requests.
              </p>
            </div>
            <div style={styles.infoCard}>
              <strong>How fast does it respond?</strong>
              <p style={styles.infoText}>
                Replies appear as soon as the backend receives a response.
              </p>
            </div>
            <div style={styles.infoCard}>
              <strong>Can I clear the conversation?</strong>
              <p style={styles.infoText}>
                Use New chat to start another conversation. Previous conversations stay in Chat history.
              </p>
            </div>
          </div>
        )}

        {activeTab === "contact" && (
          <div style={styles.tabPanel}>
            <h3 style={styles.panelTitle}>Contact Support</h3>
            <div style={styles.infoCard}>
              <strong>Email</strong>
              <p style={styles.infoText}>support@example.com</p>
            </div>
            <div style={styles.infoCard}>
              <strong>Need help now?</strong>
              <p style={styles.infoText}>
                Go back to the Chat tab and send your question.
              </p>
            </div>
          </div>
        )}
      </div>
      </div>

      <style>
        {`
          .typing span {
            font-size: 20px;
            animation: blink 1.4s infinite;
          }

          .typing span:nth-child(2) {
            animation-delay: 0.2s;
          }

          .typing span:nth-child(3) {
            animation-delay: 0.4s;
          }

          @keyframes blink {
            0% { opacity: 0.2; }
            20% { opacity: 1; }
            100% { opacity: 0.2; }
          }
        `}
      </style>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    backgroundColor: "#eef2f7",
  },
  chatBox: {
    flex: 1,
    minWidth: 0,
    height: "min(720px, 88vh)",
    backgroundColor: "#fff",
    display: "flex",
    flexDirection: "column",
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0px 16px 40px rgba(15,23,42,0.18)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "14px 15px",
    backgroundColor: "#1e3a8a",
    color: "#fff",
  },
  headerTitle: {
    fontWeight: "bold",
    fontSize: "16px",
  },
  headerSubtitle: {
    marginTop: "3px",
    fontSize: "12px",
    opacity: 0.82,
  },
  clearButton: {
    padding: "7px 10px",
    border: "1px solid rgba(255,255,255,0.45)",
    backgroundColor: "rgba(255,255,255,0.12)",
    color: "#fff",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "bold",
  },
  tabBar: {
    display: "flex",
    gap: "6px",
    padding: "8px",
    backgroundColor: "#e5e7eb",
    borderBottom: "1px solid #d1d5db",
  },
  tabButton: {
    flex: 1,
    padding: "9px 10px",
    border: "none",
    backgroundColor: "transparent",
    color: "#4b5563",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "bold",
  },
  activeTabButton: {
    backgroundColor: "#ffffff",
    color: "#1e3a8a",
    boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
  },
  tabPanel: {
    flex: 1,
    padding: "16px",
    backgroundColor: "#f8fafc",
    overflowY: "auto",
  },
  panelTitle: {
    margin: "0 0 14px",
    color: "#111827",
    fontSize: "17px",
  },
  infoCard: {
    padding: "13px",
    marginBottom: "10px",
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    color: "#111827",
  },
  infoText: {
    margin: "6px 0 0",
    color: "#4b5563",
    fontSize: "14px",
    lineHeight: 1.4,
  },
  messages: {
    flex: 1,
    padding: "10px",
    overflowY: "auto",
    backgroundColor: "#f8fafc",
  },
  messageRow: {
    display: "flex",
    marginBottom: "10px",
  },
  messageBubble: {
    padding: "10px 15px",
    borderRadius: "20px",
    maxWidth: "70%",
    whiteSpace: "pre-wrap",
  },
  attachmentInMessage: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "5px 8px",
    marginBottom: "7px",
    backgroundColor: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: "10px",
    fontSize: "12px",
    fontWeight: "bold",
  },
  attachmentIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    backgroundColor: "#ffffff",
    color: "#2563eb",
    borderRadius: "50%",
    lineHeight: 1,
  },
  time: {
    fontSize: "10px",
    marginTop: "5px",
    textAlign: "right",
    opacity: 0.7,
  },
  icon: {
    minWidth: "28px",
    fontSize: "12px",
    fontWeight: "bold",
    margin: "0 8px",
    textAlign: "center",
  },
  userAvatar: {
    width: "32px",
    height: "32px",
    margin: "0 6px",
    borderRadius: "50%",
  },
  botAvatar: {
    width: "32px",
    height: "32px",
    margin: "0 6px",
    borderRadius: "50%",
  },
  inputArea: {
    display: "flex",
    gap: "8px",
    padding: "10px",
    borderTop: "1px solid #ccc",
  },
  hiddenFileInput: {
    display: "none",
  },
  uploadButton: {
    width: "38px",
    minWidth: "38px",
    height: "38px",
    padding: "0",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#1e3a8a",
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: "22px",
    lineHeight: "1",
    fontWeight: "bold",
  },
  input: {
    flex: 1,
    padding: "10px",
    borderRadius: "10px",
    border: "1px solid #ccc",
    outline: "none",
    resize: "none",
  },
  button: {
    padding: "10px 15px",
    border: "none",
    backgroundColor: "#2563eb",
    color: "#fff",
    borderRadius: "20px",
    cursor: "pointer",
  },
  pendingAttachmentWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: "8px 10px",
    backgroundColor: "#f8fafc",
    borderTop: "1px solid #bfdbfe",
  },
  pendingAttachment: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    maxWidth: "240px",
    padding: "7px 8px",
    backgroundColor: "#ffffff",
    border: "1px solid #c7d2fe",
    borderRadius: "12px",
    color: "#1e3a8a",
    fontSize: "12px",
    boxShadow: "0 1px 3px rgba(15,23,42,0.1)",
  },
  pendingAttachmentIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    flex: "0 0 auto",
    backgroundColor: "#eff6ff",
    borderRadius: "6px",
    color: "#2563eb",
    fontWeight: "bold",
  },
  pendingAttachmentName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  removeAttachmentButton: {
    width: "20px",
    height: "20px",
    flex: "0 0 auto",
    border: "none",
    backgroundColor: "#eef2ff",
    color: "#475569",
    borderRadius: "50%",
    cursor: "pointer",
    fontWeight: "bold",
    lineHeight: "18px",
    padding: 0,
  },
};

export default App;
