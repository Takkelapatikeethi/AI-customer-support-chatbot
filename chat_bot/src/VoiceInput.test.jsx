import { vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VoiceInput from './VoiceInput';

afterEach(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
test('dictation adds recognized text to the draft and releases the microphone on unmount', () => {
  const recognition = { start: vi.fn(), stop: vi.fn(), abort: vi.fn() };
  window.SpeechRecognition = vi.fn(function () { return recognition; });
  const onText = vi.fn(); const onNotice = vi.fn(); const onListening = vi.fn();
  const { unmount } = render(<VoiceInput onText={onText} onNotice={onNotice} onListening={onListening} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }));
  expect(recognition.start).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Stop voice input' })).toHaveAttribute('aria-pressed', 'true');
  const result = [{ transcript: 'A dictated question' }]; result.isFinal = true;
  recognition.onresult({ results: [result] });
  expect(onText).toHaveBeenCalledWith('A dictated question');
  fireEvent.click(screen.getByRole('button', { name: 'Stop voice input' }));
  expect(recognition.stop).toHaveBeenCalled();
  unmount(); expect(recognition.abort).toHaveBeenCalled();
  expect(onListening).toHaveBeenLastCalledWith(false);
});
test('unsupported browsers show a helpful message', () => {
  const onNotice = vi.fn();
  render(<VoiceInput onText={vi.fn()} onNotice={onNotice} onListening={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }));
  expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('unavailable in this browser'));
});
