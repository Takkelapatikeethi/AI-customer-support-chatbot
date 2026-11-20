import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const session = { session_id: '12', title: 'Previous question', updated_at: '2026-10-20T12:00:00Z' };
const history = { messages: [
  { role: 'user', content: 'Previous question', created_at: '2026-10-20T12:00:00Z' },
  { role: 'assistant', content: 'Previous answer', created_at: '2026-10-20T12:00:01Z' },
] };
let originalFetch;
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); HTMLDialogElement.prototype.close = vi.fn(); HTMLDialogElement.prototype.showModal = vi.fn(); });
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  localStorage.setItem('chatbot-browser-token', 'a'.repeat(64));
  originalFetch = global.fetch;
  global.fetch = vi.fn(async (url) => ({ ok: true, json: async () => url.endsWith('/api/auth/me') ? { user: { id: 1, username: 'Member' } } : url.endsWith('/api/chats') ? { sessions: [session] } : history }));
});
afterEach(() => { global.fetch = originalFetch; });

test('opens a previous conversation and starts a new chat without deleting history', async () => {
  render(<App />);
  await screen.findByRole('textbox', { name: 'Message' });
  const previous = await screen.findByRole('button', { name: /Previous question/ });
  fireEvent.click(previous);
  expect(await screen.findByText('Previous answer')).toBeInTheDocument();
  expect(localStorage.getItem('chatbot-active-session')).toBe('12');
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(input, { target: { value: 'Unsent draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit question 1' }));
  expect(input).toHaveValue('Previous question');
  expect(screen.getByRole('button', { name: 'Send revision' })).toBeEnabled();
  expect(screen.getByText('Previous question', { selector: 'div' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
  expect(input).toHaveValue('Unsent draft');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  fireEvent.click(screen.getByRole('button', { name: 'Copy question 1' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Previous question'));
  expect(await screen.findByText('Message copied.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '+ New chat' }));
  expect(screen.getByText('Welcome! How can I help you today?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Previous question/ })).toBeInTheDocument();
  expect(localStorage.getItem('chatbot-active-session')).toBeNull();
});

test('restores the active saved chat after a refresh', async () => {
  localStorage.setItem('chatbot-active-session', '12');
  render(<App />);
  await screen.findByRole('textbox', { name: 'Message' });
  expect(await screen.findByText('Previous answer')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/chats/12/messages'), expect.objectContaining({ headers: expect.objectContaining({ 'X-Chat-Token': 'a'.repeat(64) }) }));
});

test('shows a history load error and lets the user send a message', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url.endsWith('/api/auth/me')) return { ok: true, json: async () => ({ user: { id: 1, username: 'Member' } }) };
    throw new Error('Network unavailable');
  });
  render(<App />);
  await screen.findByRole('textbox', { name: 'Message' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
});

test('sending a new message saves and selects the returned conversation', async () => {
  let sent = false;
  global.fetch = vi.fn(async (url, options) => {
    if (url.endsWith('/api/auth/me')) return { ok: true, json: async () => ({ user: { id: 1, username: 'Member' } }) };
    if (url.endsWith('/message')) {
      sent = true;
      expect(JSON.parse(options.body).sessionId).toBeNull();
      return { ok: true, json: async () => ({ sessionId: '12', reply: 'Previous answer', saved: true }) };
    }
    return { ok: true, json: async () => url.endsWith('/api/chats') ? { sessions: sent ? [session] : [] } : history };
  });
  render(<App />);
  await screen.findByRole('textbox', { name: 'Message' });
  const input = screen.getByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'Previous question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Previous answer')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /Previous question/ })).toBeInTheDocument();
  expect(localStorage.getItem('chatbot-active-session')).toBe('12');
});

test('requires sign-in, removes guest entry and opens dedicated signup and login pages', async () => {
  global.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ user: null }) }));
  render(<App />);
  expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use as guest' })).not.toBeInTheDocument();
  const signup = screen.getAllByRole('button', { name: 'Sign up' }).at(-1);
  await waitFor(() => expect(signup).toBeEnabled());
  expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/chats'), expect.anything());
  fireEvent.click(signup);
  expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to login' }));
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to chat options' }));
  await screen.findByText('Sign in to start chatting');
  expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use as guest' })).not.toBeInTheDocument();
});

test('failed login verification never exposes chat', async () => {
  global.fetch.mockRejectedValue(new Error('Network unavailable'));
  render(<App />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Log in' })[0]).toBeEnabled());
  expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use as guest' })).not.toBeInTheDocument();
});

test('an authenticated visitor can reopen account chats without choosing guest access', async () => {
  global.fetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.endsWith('/api/auth/me') ? { user: { id: 1, username: 'Member' } } : url.endsWith('/api/chats') ? { sessions: [session] } : history }));
  render(<App />);
  expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use as guest' })).not.toBeInTheDocument();
});

test('support topics personalize the welcome page and stage a suggested question without sending', async () => {
  render(<App />);
  expect(await screen.findByRole('heading', { name: /Hi Member/ })).toBeInTheDocument();
  const hr = screen.getByRole('button', { name: /HR & Leave/ });
  fireEvent.click(hr);
  expect(hr).toHaveAttribute('aria-pressed', 'true');
  const suggestion = screen.getByRole('button', { name: 'How do I request vacation?' });
  await waitFor(() => expect(suggestion).toBeEnabled());
  fireEvent.click(suggestion);
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('How do I request vacation?');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/message'), expect.anything());
  expect(screen.getByText(/NovaTech Solutions demo/)).toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Toggle chat history' });
  const wasExpanded = toggle.getAttribute('aria-expanded');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).not.toBe(wasExpanded);
});

test('password recovery link is hidden when email delivery is unavailable', async () => {
  window.history.replaceState(null, '', '/#login');
  global.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ user: null, passwordResetEnabled: false }) }));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Forgot password?' })).not.toBeInTheDocument();
});

test('password recovery link is shown when the backend reports configured email delivery', async () => {
  window.history.replaceState(null, '', '/#login');
  global.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ user: null, passwordResetEnabled: true }) }));
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
});
