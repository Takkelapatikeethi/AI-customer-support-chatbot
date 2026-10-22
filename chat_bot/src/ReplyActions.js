import React, { useEffect, useRef, useState } from 'react';
export default function ReplyActions({ message, disabled, request, onNotice, onRetry }) {
  const [rating, setRating] = useState(Number(message.rating) || 0);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const utterance = useRef(null);
  useEffect(() => () => { if (utterance.current) window.speechSynthesis?.cancel(); }, []);
  const rate = async (value) => {
    setSaving(true);
    try { const next = rating === value ? 0 : value; await request('feedback', { rating: next }); setRating(next); onNotice(next ? 'Thanks for your feedback.' : 'Feedback removed.'); }
    catch (err) { onNotice(err.message); } finally { setSaving(false); }
  };
  const read = () => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { onNotice('Read aloud is unavailable in this browser.'); return; }
    window.speechSynthesis.cancel();
    if (reading) { setReading(false); return; }
    const speech = new window.SpeechSynthesisUtterance(message.text);
    utterance.current = speech;
    speech.onend = () => { setReading(false); utterance.current = null; };
    speech.onerror = () => { setReading(false); utterance.current = null; };
    setReading(true); window.speechSynthesis.speak(speech);
  };
  const icon = (path) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
  return <>
    <button type="button" title="Like" aria-label="Like reply" aria-pressed={rating === 1} disabled={disabled || saving} onClick={() => rate(1)}>{icon('M7 10v11H3V10h4Zm0 0 5-8c3 0 2 5 2 7h5a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7')}</button>
    <button type="button" title="Dislike" aria-label="Dislike reply" aria-pressed={rating === -1} disabled={disabled || saving} onClick={() => rate(-1)}>{icon('M7 14V3H3v11h4Zm0 0 5 8c3 0 2-5 2-7h5a2 2 0 0 0 2-2l-2-8a2 2 0 0 0-2-2H7')}</button>
    <button type="button" title={reading ? 'Stop reading' : 'Read aloud'} aria-label={reading ? 'Stop reading reply' : 'Read reply aloud'} aria-pressed={reading} onClick={read}>{icon(reading ? 'M7 5h10v14H7z' : 'M11 4 6 8H2v8h4l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14')}</button>
    <button type="button" title="Try again" aria-label="Try reply again" disabled={disabled || saving} onClick={onRetry}>{icon('M20 4v6h-6M20 10a8 8 0 1 0 0 5')}</button>
  </>;
}
