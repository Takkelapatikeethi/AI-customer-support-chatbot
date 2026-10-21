import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const session = { session_id: '12', title: 'Previous question', updated_at: '2026-10-20T12:00:00Z' };
const history = { messages: [
  { role: 'user', content: 'Previous question', created_at: '2026-10-20T12:00:00Z' },
  { role: 'assistant', content: 'Previous answer', created_at: '2026-10-20T12:00:01Z' },
] };
let originalFetch;
beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('chatbot-browser-token', 'a'.repeat(64));
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (url) => ({ ok: true, json: async () => url.endsWith('/api/chats') ? { sessions: [session] } : history }));
});
afterEach(() => { global.fetch = originalFetch; });

test('opens a previous conversation and starts a new chat without deleting history', async () => {
  render(<App />);
  const previous = await screen.findByRole('button', { name: /Previous question/ });
  fireEvent.click(previous);
  expect(await screen.findByText('Previous answer')).toBeInTheDocument();
  expect(localStorage.getItem('chatbot-active-session')).toBe('12');
  fireEvent.click(screen.getByRole('button', { name: '+ New chat' }));
  expect(screen.getByText('Welcome! How can I help you today?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Previous question/ })).toBeInTheDocument();
  expect(localStorage.getItem('chatbot-active-session')).toBeNull();
});

test('restores the active saved chat after a refresh', async () => {
  localStorage.setItem('chatbot-active-session', '12');
  render(<App />);
  expect(await screen.findByText('Previous answer')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/chats/12/messages'), expect.objectContaining({ headers: expect.objectContaining({ 'X-Chat-Token': 'a'.repeat(64) }) }));
});

test('shows a history load error and lets the user send a message', async () => {
  global.fetch.mockRejectedValue(new Error('Network unavailable'));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
});

test('sending a new message saves and selects the returned conversation', async () => {
  let sent = false;
  global.fetch = jest.fn(async (url, options) => {
    if (url.endsWith('/message')) {
      sent = true;
      expect(JSON.parse(options.body).sessionId).toBeNull();
      return { ok: true, json: async () => ({ sessionId: '12', reply: 'Previous answer', saved: true }) };
    }
    return { ok: true, json: async () => url.endsWith('/api/chats') ? { sessions: sent ? [session] : [] } : history };
  });
  render(<App />);
  const input = screen.getByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'Previous question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Previous answer')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /Previous question/ })).toBeInTheDocument();
  expect(localStorage.getItem('chatbot-active-session')).toBe('12');
});
