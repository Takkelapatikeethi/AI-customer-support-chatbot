import React, { useEffect, useRef, useState } from 'react';
import './Account.css';
export default function Account({ api, user, busy, placement = 'nav', onGuest, initialMode }) {
  const page = placement === 'page';
  const reset = page ? window.location.hash.match(/^#reset=([a-f0-9]{64})$/)?.[1] : null;
  const [guestSelected, setGuestSelected] = useState(false);
  const [mode, setMode] = useState(initialMode || (reset ? 'reset' : null));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  useEffect(() => {
    if (page) return;
    if (mode) dialog.current?.showModal();
    else dialog.current?.close();
  }, [mode, page]);
  const request = async (path, body) => {
    const response = await fetch(`${api}/api/auth/${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.reply || 'Could not complete your request.');
    return data;
  };
  const submit = async (event) => {
    event.preventDefault();
    setPending(true); setError(''); setNotice('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    if (fields.confirm !== undefined && fields.password !== fields.confirm) { setError('Passwords must match.'); setPending(false); return; }
    try {
      const data = await request(mode, { ...fields, token: reset });
      if (mode === 'signup' || mode === 'login') { window.location.hash = 'assistant'; window.location.reload(); return; }
      setNotice(data.reply);
      if (mode === 'reset') { window.history.replaceState(null, '', window.location.pathname); setMode('login'); }
    } catch (err) { setError(err.message); }
    finally { setPending(false); }
  };
  const switchMode = (value) => { window.location.hash = value; };
  const logout = async () => {
    setPending(true); setError('');
    try { await request('logout', {}); window.location.reload(); }
    catch (err) { setError(err.message); setPending(false); }
  };
  const useGuest = () => {
    setGuestSelected(true);
    onGuest?.();
    requestAnimationFrame(() => document.querySelector('#assistant textarea[aria-label="Message"]')?.focus());
  };
  const FormContainer = page ? 'section' : 'dialog';
  return <div className={placement === 'chat' ? 'chat-account-panel' : undefined}>
    {placement === 'chat' && <div className="chat-account-intro"><strong>{user ? `Welcome, ${user.username}` : 'Choose how you want to chat'}</strong><p>{user ? 'Your conversations are saved to your account.' : 'Sign up or log in to access chats across devices, or continue as a guest in this browser.'}</p></div>}
    <div className="account-controls">
    {!page && (user ? <><span className="account-name">{user.username}</span><button type="button" disabled={busy || pending} onClick={logout}>Log out</button></> : <><button type="button" disabled={busy} onClick={() => switchMode('login')}>Log in</button><button className="account-signup" type="button" disabled={busy} onClick={() => switchMode('signup')}>Sign up</button></>)}
    {placement === 'chat' && !user && <button type="button" disabled={busy} onClick={useGuest}>Use as guest</button>}
    {placement === 'chat' && guestSelected && !user && <span className="guest-status" role="status">You are chatting as a guest.</span>}
    {!mode && error && <span role="alert">{error}</span>}
    <FormContainer ref={dialog} className="account-dialog" aria-label="Account access" onCancel={(e) => { if (pending) e.preventDefault(); else setMode(null); }}>
      <button className="account-close" type="button" disabled={pending} onClick={() => setMode(null)} aria-label="Close account dialog">×</button>
      <p className="eyebrow">YOUR SPACE TO EXPLORE</p>
      <h2>{mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Forgot your password?' : mode === 'reset' ? 'Set a new password' : 'Welcome back'}</h2>
      <p>{mode === 'signup' || mode === 'login' ? 'Sign in to keep your account conversations together across devices. Guest chats stay in this browser.' : 'Reset links expire after 30 minutes.'}</p>
      <form key={mode} onSubmit={submit}>
        {mode === 'signup' && <label>Name<input name="name" autoComplete="name" required maxLength={100} autoFocus /></label>}
        {mode !== 'reset' && <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} autoFocus={mode !== 'signup'} /></label>}
        {mode !== 'forgot' && <label>Password<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} /><small>12–128 characters</small></label>}
        {(mode === 'signup' || mode === 'reset') && <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>}
        {error && <p className="account-error" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <button type="submit" disabled={pending}>{pending ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Log in'}</button>
      </form>
      <div className="account-links">{mode === 'login' ? <><button disabled={pending} onClick={() => switchMode('forgot')}>Forgot password?</button><button disabled={pending} onClick={() => switchMode('signup')}>Create an account</button></> : <button disabled={pending} onClick={() => switchMode('login')}>Back to login</button>}</div>
      {page && <button type="button" disabled={pending} onClick={() => { window.location.hash = 'assistant'; }}>Back to chat options</button>}
    </FormContainer>
    </div>
  </div>;
}
