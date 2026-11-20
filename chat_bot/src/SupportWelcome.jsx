import React, { useState } from 'react';

const categories = [
  { id: 'it', name: 'IT Support', description: 'Devices, passwords & connectivity', icon: 'M3 4h18v12H3zM8 21h8m-4-5v5', questions: ['How do I reset my company password?', 'How do I request a replacement laptop?', 'How do I connect to an office printer?'] },
  { id: 'hr', name: 'HR & Leave', description: 'Time off, benefits & employee details', icon: 'M8 3v4m8-4v4M3 10h18M4 5h16v16H4zM8 14h3m2 3h3', questions: ['How do I request vacation?', 'Where can I check my paid time off balance?', 'Where can I view my payslips?'] },
  { id: 'security', name: 'Security', description: 'Stay secure & report concerns', icon: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7zM8 12l3 3 5-6', questions: ['How do I report a phishing email?', 'What should I do if a company device is lost or stolen?', 'What should I do when my MFA code does not work?'] },
  { id: 'finance', name: 'Finance', description: 'Expenses, travel & purchasing', icon: 'M3 6h18v14H3zM3 10h18m-6 5h3M6 3h12', questions: ['How do I submit an expense reimbursement?', 'What is the process for business travel expenses?', 'How do I request approval to purchase equipment for my team?'] },
  { id: 'access', name: 'App Access', description: 'Tools, permissions & shared folders', icon: 'M8 11V7a4 4 0 0 1 8 0v4M5 11h14v10H5zM12 15v3', questions: ['How do I request access to a business application?', 'How do I change or remove application access?', 'How do I request access to a shared team folder?'] },
  { id: 'workplace', name: 'Workplace', description: 'Office spaces & everyday essentials', icon: 'M4 21V3h12v18m0-12h4v12M8 7h4m-4 4h4m-4 4h4M2 21h20', questions: ['How do I book a meeting room?', 'How do I request remote or hybrid working?', 'How do I arrange a visitor to the office?'] },
];

export default function SupportWelcome({ name, disabled, onChoose }) {
  const [selected, setSelected] = useState('it');
  const category = categories.find(item => item.id === selected);
  const firstName = name?.trim().split(/\s+/)[0] || 'there';
  return <section className="support-welcome" aria-label="Company support topics">
    <div className="support-eyebrow"><span className="support-dot" /> YOUR EMPLOYEE HELP DESK</div>
    <h1>Hi {firstName},<br /><span>let’s make work a little easier.</span></h1>
    <p className="support-lead">Find a starting point below, or ask a company-support question.</p>
    <div className="support-category-heading"><h2>What do you need help with?</h2><span>Explore a topic</span></div>
    <div className="support-category-grid" aria-label="Support categories">
      {categories.map(item => <button type="button" key={item.id} className={`support-category ${selected === item.id ? 'is-selected' : ''}`}
        aria-pressed={selected === item.id} disabled={disabled} onClick={() => setSelected(item.id)}>
        <span className="support-category-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.icon} /></svg></span>
        <strong>{item.name}</strong><span className="support-category-description">{item.description}</span>
        <span className="support-category-arrow" aria-hidden="true">↗</span>
      </button>)}
    </div>
    <div className="support-suggestions" aria-label={`${category.name} suggested questions`}>
      <p>POPULAR IN <strong>{category.name.toUpperCase()}</strong></p>
      <div>{category.questions.map(question => <button type="button" key={question} disabled={disabled} onClick={() => onChoose(question)}>{question}<span aria-hidden="true">↗</span></button>)}</div>
      <span className="support-suggestion-hint">Choose a question to add it to your message. Send when you’re ready.</span>
    </div>
    <p className="support-demo-note"><span aria-hidden="true">◇</span> NovaTech Solutions demo · Fictional policies for testing.</p>
  </section>;
}
