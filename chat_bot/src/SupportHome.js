import React from 'react';
import Account from './Account';
import './styles/SupportHome.css';

function HomeIcon({ kind }) {
  const paths = {
    spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    message: 'M4 4h16v12H9l-5 4zM8 8h8m-8 4h5',
    history: 'M4 5v5h5M4 10a8 8 0 1 1 1 8m7-11v5l3 2',
    folder: 'M3 6h7l2 3h9v11H3zM3 6V4h7l2 2',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

export default function SupportHome({ api, busy }) {
  return <div className="support-home">
    <header className="support-home-nav"><a href="#home" aria-label="Support Desk home"><span className="support-brand-mark" aria-hidden="true">N</span><strong>Support Desk</strong></a><span className="home-demo-tag">NovaTech Solutions · Fictional demo</span></header>
    <div className="support-home-grid">
      <section className="home-story" aria-labelledby="home-title">
        <div className="home-story-orbit" aria-hidden="true" />
        <div className="home-story-content">
          <p className="home-kicker"><span /> A LITTLE HELP GOES A LONG WAY</p>
          <h1 id="home-title">Less searching.<br /><span>More getting<br /> things done.</span></h1>
          <p className="home-story-description">From a forgotten password to your next day off.<br className="home-desktop-break" /> Find your company-support answers in one place.</p>
          <div className="home-topic-tags" aria-label="Example support topics"><span>IT & devices</span><span>HR & leave</span><span>Expenses & more</span></div>
          <div className="home-chat-preview" aria-label="Example conversation, fictional demo">
            <div className="home-preview-header"><span className="home-preview-avatar"><HomeIcon kind="spark" /></span><div><strong>A simpler way to find help</strong><span>Example conversation</span></div></div>
            <p className="home-preview-question">How do I request vacation?</p>
            <div className="home-preview-answer"><span aria-hidden="true">↳</span><p>Check your leave balance in the Employee Portal, discuss your dates with your manager, and submit your request for approval.</p></div>
            <div className="home-preview-source">Sample topic <span>HR & Leave</span></div>
          </div>
          <p className="home-story-footer">Your workday has enough questions.<br /><strong>Getting help should feel simple.</strong></p>
        </div>
      </section>
      <section className="home-entry" aria-label="Get started with company support">
        <span className="home-entry-symbol"><HomeIcon kind="message" /></span>
        <Account api={api} user={null} busy={busy} placement="chat" />
        <div className="home-benefits">
          <div><span><HomeIcon kind="message" /></span><p><strong>Start with a question</strong><span>Explore support topics and ready-to-use prompts.</span></p></div>
          <div><span><HomeIcon kind="history" /></span><p><strong>Pick up where you left off</strong><span>Keep your saved conversations in your account.</span></p></div>
          <div><span><HomeIcon kind="folder" /></span><p><strong>Everyday support, together</strong><span>IT, HR, security, finance, and workplace guidance.</span></p></div>
        </div>
        <p className="home-entry-note">A demonstration with fictional company policies.<br />Please don’t enter real confidential information.</p>
      </section>
    </div>
    <footer className="support-home-footer"><span>A little help. A better workday.</span><span>Fictional company · Real project</span></footer>
  </div>;
}
