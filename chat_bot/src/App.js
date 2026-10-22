import React, { useEffect, useRef, useState } from "react";
import "./Website.css";
import './MessageActions.css';
import './HistoryActions.css';
import VoiceInput from './VoiceInput';
import './ChatWorkspace.css';
import ReplyActions from './ReplyActions';
import Account from './Account';

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";
function MenuIcon({ name }) {
  const paths = {
    rename: 'm15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z',
    pin: 'm16 3 5 5-3 1-4 5v3l-3-3-6 6m2-12h3l5-4z',
    share: 'M12 16V3m-5 5 5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
    delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    menu: 'M5 12h.01M12 12h.01M19 12h.01',
    attachment: 'm8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9m-1 7-6 6a1 1 0 0 0 2 2l7-7',
    send: 'm3 3 18 9-18 9 3-9-3-9Zm3 9h15',
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'menu' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
const storedMessages = (rows) => rows.map((row) => ({
  id: row.message_id,
  rating: row.rating,
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
    ...options, credentials: 'include', headers: { "Content-Type": "application/json", "X-Chat-Token": token, ...options.headers },
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
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState(() => window.location.hash.slice(1));
  const [guestAccess, setGuestAccess] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const [actionNotice, setActionNotice] = useState('');
  const [listening, setListening] = useState(false);
  const composerRef = useRef(null);
  const editMessage = (msg, index) => {
    setEditingMessage({ index, draft: message, file: uploadedFile });
    setMessage(msg.text);
    setUploadedFile(null);
    setActionNotice('');
    requestAnimationFrame(() => composerRef.current?.focus());
  };
  const cancelEdit = () => {
    setMessage(editingMessage.draft);
    setUploadedFile(editingMessage.file);
    setEditingMessage(null);
  };
  const copyMessage = async (text) => {
    try { await navigator.clipboard.writeText(text); setActionNotice('Message copied.'); }
    catch { setActionNotice('Could not copy. Select the message text and copy it manually.'); }
  };
  const historyAction = async (session, action) => {
    if (isTyping || historyLoading) return;
    let title;
    if (action === 'rename') {
      title = window.prompt('Rename conversation (up to 100 characters)', session.title || '');
      if (title === null) return;
      title = title.trim();
      if (!title || title.length > 100) { setError('Use a title of 1–100 characters.'); return; }
    }
    if (action === 'delete' && !window.confirm(`Delete "${session.title || 'Untitled conversation'}" and all its messages? This cannot be undone.`)) return;
    setHistoryLoading(true); setError(''); setActionNotice('');
    try {
      const path = `/api/chats/${session.session_id}`;
      if (action === 'share') {
        const chat = await chatRequest(`${path}/messages`, token);
        const text = [chat.title || 'Conversation', ...chat.messages.map((item) => `${item.role === 'user' ? 'You' : 'AI assistant'}: ${item.content}${item.file_name ? `\nAttachment: ${item.file_name}` : ''}`)].join('\n\n');
        try { await navigator.clipboard.writeText(text); setActionNotice('Conversation copied. Paste it wherever you want to share it.'); }
        catch {
          const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
          const link = document.createElement('a'); link.href = url; link.download = `conversation-${session.session_id}.txt`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setActionNotice('Conversation downloaded as a text file to share.');
        }
      } else {
        await chatRequest(path, token, { method: action === 'delete' ? 'DELETE' : 'PATCH', ...(action !== 'delete' ? { body: JSON.stringify(action === 'rename' ? { title } : { pinned: !Boolean(Number(session.pinned)) }) } : {}) });
        if (action === 'delete' && String(session.session_id) === sessionId) {
          setSessionId(null); rememberSession(null); setMessage(''); setUploadedFile(null); setEditingMessage(null);
          setMessages([{ text: 'Welcome! How can I help you today?', sender: 'bot', time: getTime() }]);
        }
        const data = await chatRequest('/api/chats', token); setSessions(data.sessions);
        setActionNotice(action === 'delete' ? 'Conversation deleted.' : action === 'rename' ? 'Conversation renamed.' : Number(session.pinned) ? 'Conversation unpinned.' : 'Conversation pinned.');
      }
    } catch (err) { setError(err.message); }
    finally { setHistoryLoading(false); }
  };
  useEffect(() => {
    const navigate = () => setRoute(window.location.hash.slice(1));
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const identity = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
        if (!identity.ok) throw new Error('Could not check your login. Please refresh the page.');
        const { user: currentUser } = await identity.json();
        if (cancelled) return;
        setUser(currentUser);
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
      setEditingMessage(null);
      setActionNotice('');
      setUploadedFile(null);
      setActiveTab("chat");
    } catch (err) { setError(err.message); }
    finally { setHistoryLoading(false); }
  };

  useEffect(() => {
    const panel = messagesEndRef.current?.parentElement;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [messages, isTyping]);

  const handleSend = async () => {
    const userText = message.trim();
    if ((userText === "" && !uploadedFile) || isTyping || historyLoading || !token || listening) return;

    setError("");
    const previousMessages = messages;

    setMessage("");
    setIsTyping(true);
    setEditingMessage(null);
    setActionNotice('');
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
        credentials: 'include',
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
    setEditingMessage(null);
    setActionNotice('');
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

  const accountPage = ['signup', 'login', 'forgot'].includes(route) || /^reset=[a-f0-9]{64}$/.test(route);
  if (accountPage) return (
    <main className="account-page">
      <a className="site-mark" href="#home">AI Assistant</a>
      <Account key={route} api={API_BASE} user={user} busy={false} placement="page" initialMode={route.startsWith('reset=') ? 'reset' : route} />
    </main>
  );

  return (
    <div className="website">
      <a className="skip-link" href="#assistant">Skip to assistant</a>
      <header className="site-nav">
        <a className="site-mark" href="#home" aria-label="Home"><span className="mark-icon">✳</span> AI Assistant</a>
        <nav aria-label="Main navigation"><a href="#explore">Explore</a><a href="#how-it-works">How it works</a><a href="#questions">FAQs</a></nav>
        <a className="nav-cta" href="#assistant">Let’s talk <span aria-hidden="true">↗</span></a>
        <Account api={API_BASE} user={user} busy={isTyping || historyLoading} />
      </header>
      <main>
      <section className="hero page-width" id="home">
        <div className="hero-copy">
          <p className="eyebrow"><span /> A LITTLE HELP. A CLEARER NEXT STEP.</p>
          <h1>Good questions.<br />Better <em>possibilities.</em></h1>
          <p className="hero-description">A space to explore ideas, make sense of information, and find your way forward. Start a conversation with your AI assistant.</p>
          <a className="primary-link" href="#assistant">Ask your first question <span aria-hidden="true">↗</span></a>
          <p className="hero-note">Try as a guest · Sign in to access chats across devices</p>
        </div>
        <div className="hero-art" aria-label="Illustration of a conversation with an AI assistant" role="img">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <span className="art-label">A NEW PERSPECTIVE STARTS HERE</span>
          <div className="art-star">✳</div>
          <div className="art-question">Where should I start?</div>
          <div className="art-answer"><span>✦</span> Let’s work through it, together.</div>
          <span className="art-bottom">YOUR CURIOSITY. A CONVERSATION AWAY. ↗</span>
        </div>
      </section>
      <section className="explore page-width" id="explore">
        <div className="section-heading"><p className="eyebrow">ROOM TO EXPLORE</p><h2>Make the everyday a little easier.</h2></div>
        <div className="feature-grid">
          <article><span className="feature-number">01 / UNDERSTAND</span><h3>Find a clearer explanation.</h3><p>Break down a complex topic, ask follow-up questions, and explore it at your own pace.</p></article>
          <article><span className="feature-number">02 / CREATE</span><h3>Give your ideas a starting point.</h3><p>Brainstorm a fresh approach, draft a message, or turn a rough thought into a useful outline.</p></article>
          <article><span className="feature-number">03 / EXPLORE</span><h3>Bring your own context.</h3><p>Attach a small text file and ask questions about its content, all in the same conversation.</p></article>
        </div>
      </section>
      <section className="assistant-section" id="assistant" aria-labelledby="assistant-heading">
      <div className="page-width assistant-intro"><div><p className="eyebrow">LET’S START WITH YOU</p><h2 id="assistant-heading">What’s on your mind?</h2></div><p>Ask naturally. Follow your curiosity.<br />Your next idea could start right here.</p></div>
      {!user && !guestAccess && <div className="page-width"><Account api={API_BASE} user={user} busy={historyLoading} placement="chat" onGuest={() => { setGuestAccess(true); setActiveTab('chat'); }} /></div>}
    {(user || guestAccess) && <><div className="page-width chat-access-status"><span>{user ? `Signed in as ${user.username}` : 'You are chatting as a guest'}</span>{!user && <button type="button" disabled={isTyping || historyLoading} onClick={() => setGuestAccess(false)}>Back to chat options</button>}</div>
    <div className="assistant-workspace" style={styles.container}>
      <div className="chat-layout unified-chat">
      <aside className="chat-history" aria-label="Chat history">
        <h2>Chat history</h2>
        <button className="new-chat" type="button" onClick={clearChat} disabled={isTyping || historyLoading}>+ New chat</button>
        <p className="history-note">{user ? `Saved to ${user.username}'s account` : 'Saved for this browser'}</p>
        {historyLoading && <p role="status">Loading conversations…</p>}
        {!historyLoading && sessions.length === 0 && <p>No saved chats yet. Send a message to start.</p>}
        <div className="history-list">
          {sessions.map((session) => (
            <div className="history-entry" key={session.session_id}><button type="button"
              className={`history-item ${String(session.session_id) === sessionId ? "selected" : ""}`}
              aria-current={String(session.session_id) === sessionId ? "true" : undefined}
              disabled={isTyping || historyLoading} onClick={() => openChat(session.session_id)}>
              <span>{session.title || "Untitled conversation"}</span>
              {Boolean(Number(session.pinned)) && <small className="pin-label">Pinned</small>}
            </button>
            <details className="history-menu"><summary aria-label={`Options for ${session.title || 'Untitled conversation'}`} title="Conversation options"><MenuIcon name="menu" /></summary><div className="history-menu-items">
              <button type="button" disabled={isTyping || historyLoading} onClick={() => historyAction(session, 'rename')}><MenuIcon name="rename" />Rename</button>
              <button type="button" disabled={isTyping || historyLoading} onClick={() => historyAction(session, 'pin')}><MenuIcon name="pin" />{Number(session.pinned) ? 'Unpin' : 'Pin'}</button>
              <button type="button" disabled={isTyping || historyLoading} onClick={() => historyAction(session, 'share')}><MenuIcon name="share" />Share</button>
              <button className="delete-chat" type="button" disabled={isTyping || historyLoading} onClick={() => historyAction(session, 'delete')}><MenuIcon name="delete" />Delete</button>
            </div></details></div>
          ))}
        </div>
      </aside>
      <div style={styles.chatBox}>
        <div style={styles.header}>
          <div>
            <div style={styles.headerTitle}>Support Assistant</div>
            <div style={styles.headerSubtitle}>AI-powered · Answers may need checking</div>
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
            <div style={styles.messages} role="log" aria-label="Conversation" aria-live="polite">
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

                  <div className={`message-content ${msg.sender}`}>
                  <div
                    style={{
                      ...styles.messageBubble,
                      maxWidth: '100%',
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
                  </div>
                    <div className="message-actions">
                      <button type="button" title="Copy message" onClick={() => copyMessage(msg.text)} aria-label={`Copy ${msg.sender === 'user' ? 'question' : 'answer'} ${index + 1}`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
                      {msg.sender === 'user' && <button type="button" title="Edit question" disabled={isTyping || historyLoading || editingMessage !== null} onClick={() => editMessage(msg, index)} aria-label={`Edit question ${index + 1}`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button>}
                      {msg.sender === 'bot' && msg.id && <ReplyActions key={`${sessionId}-${msg.id}`} message={msg} disabled={isTyping || historyLoading || listening} onNotice={setActionNotice} request={(action, body) => chatRequest(`/api/chats/${sessionId}/messages/${msg.id}/${action}`, token, { method: 'POST', body: JSON.stringify(body) })} onRetry={async () => {
                        setIsTyping(true); setActionNotice('');
                        try {
                          await chatRequest(`/api/chats/${sessionId}/messages/${msg.id}/retry`, token, { method: 'POST', body: '{}' });
                          const chat = await chatRequest(`/api/chats/${sessionId}/messages`, token);
                          setMessages(storedMessages(chat.messages));
                          const data = await chatRequest('/api/chats', token); setSessions(data.sessions);
                          setActionNotice('A new answer was added. The original reply is still available.');
                        } catch (err) { setActionNotice(err.message); }
                        finally { setIsTyping(false); }
                      }} />}
                    </div>
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

            {actionNotice && <p className="message-action-notice" role="status">{actionNotice}</p>}
            {editingMessage && <div className="editing-notice"><div><strong>Edit and resend your question</strong><p>The revision will be sent as a new message. The original stays in your history.{messages[editingMessage.index]?.fileName ? ' Reattach the original file if you want to include it again.' : ''}</p></div><button type="button" onClick={cancelEdit}>Cancel edit</button></div>}
            <div className="message-composer">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json"
                style={styles.hiddenFileInput}
                onChange={handleFileUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isTyping || historyLoading || !token}
                title="Upload file"
                aria-label="Upload a text file"
                className="composer-icon"
              >
                <MenuIcon name="attachment" />
              </button>
              <textarea
                ref={composerRef}
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

              <VoiceInput key={`${sessionId}-${activeTab}`} disabled={isTyping || historyLoading || !token} onListening={setListening} onNotice={setActionNotice} onText={(text) => { setMessage((current) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${text}`); composerRef.current?.focus(); }} />
              <button
                className="composer-icon send-icon"
                type="button"
                aria-label={editingMessage ? 'Send revision' : 'Send'}
                title={editingMessage ? 'Send revision' : 'Send message'}
                onClick={handleSend}
                disabled={isTyping || historyLoading || !token || listening || (message.trim() === "" && !uploadedFile)}
              >
                <MenuIcon name="send" />
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
              <strong>Have a question?</strong>
              <p style={styles.infoText}>Use the Chat tab to talk with the AI assistant. Human support contact details have not been provided.</p>
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
      </div><p className="assistant-disclosure">Signed-in chats are saved to your account. Guest chats belong to this browser; clearing browser storage loses guest access. Avoid sharing sensitive information. Text uploads: TXT, MD, CSV, JSON · up to 150 KB.</p></>}
      </section>
      <section className="how-section page-width" id="how-it-works"><div><p className="eyebrow">FROM QUESTION TO CLARITY</p><h2>A conversation,<br />at your pace.</h2></div><ol><li><strong>Start with a question.</strong><p>Type what you need help with. There’s no special format.</p></li><li><strong>Add a little context.</strong><p>Ask a follow-up or attach a text file to explore further.</p></li><li><strong>Come back to your ideas.</strong><p>Reopen a saved conversation from this browser’s chat history.</p></li></ol></section>
      <section className="faq-section page-width" id="questions"><p className="eyebrow">A FEW USEFUL ANSWERS</p><h2>Before you begin.</h2><details><summary>Do I need an account?</summary><p>You can chat as a guest, or create an account to reopen your account chats across devices. Guest chats remain separate. People sharing a browser can see its guest chats.</p></details><details><summary>Can the assistant answer questions about a specific business?</summary><p>This is a general AI assistant. Verified business information has not been added yet, so it cannot confirm company services, prices, policies, or availability.</p></details><details><summary>Are AI answers always accurate?</summary><p>AI can make mistakes. Check important details with a reliable source before acting on an answer.</p></details><details><summary>What happens when I start a new chat?</summary><p>You begin a separate conversation. Your previous chats remain available in this browser’s chat history.</p></details></section>
      </main>
      <footer className="site-footer page-width"><a className="site-mark" href="#home"><span className="mark-icon">✳</span> AI Assistant</a><p>A little curiosity goes a long way.</p><a href="#home">Back to top ↑</a></footer>

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
    minHeight: "0",
    backgroundColor: "transparent",
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


