import React, { useEffect, useRef, useState } from 'react';

export default function VoiceInput({ disabled, onText, onNotice, onListening }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const callbacks = useRef({ onText, onNotice, onListening });
  callbacks.current = { onText, onNotice, onListening };
  useEffect(() => () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null; recognition.onerror = null; recognition.onend = null;
      recognition.abort();
    }
    callbacks.current.onListening(false);
  }, []);
  const toggle = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { onNotice('Voice input is unavailable in this browser. Please type your message or try a browser with speech recognition.'); return; }
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results).filter((result) => result.isFinal).map((result) => result[0].transcript).join(' ');
      if (text) { callbacks.current.onText(text); callbacks.current.onNotice('Voice added to your draft. Review it before sending.'); }
    };
    recognition.onerror = (event) => callbacks.current.onNotice(event.error === 'not-allowed' ? 'Microphone access was denied. Allow microphone access in your browser to use voice input.' : 'Voice input stopped. Please try again or type your message.');
    recognition.onend = () => { setListening(false); callbacks.current.onListening(false); recognitionRef.current = null; };
    try {
      recognition.start(); setListening(true); onListening(true);
      onNotice('Listening… Click the microphone again to stop. Your browser may use its speech service to transcribe audio.');
    } catch { setListening(false); onListening(false); onNotice('Could not start voice input. Please try again.'); }
  };
  return <button type="button" className={`composer-icon microphone-button ${listening ? 'listening' : ''}`} disabled={disabled} onClick={toggle} aria-label={listening ? 'Stop voice input' : 'Start voice input'} aria-pressed={listening} title={listening ? 'Stop listening' : 'Dictate a message'}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></svg>
  </button>;
}
