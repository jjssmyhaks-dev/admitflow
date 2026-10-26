"use client";

import { useEffect, useState } from "react";

const SCRIPT: { role: "lead" | "agent"; text: string; sources?: string }[] = [
  { role: "lead", text: "Hi, what are the Class 11 Science fees for 2026-27?" },
  {
    role: "agent",
    text: "Class 11 Science (PCM/PCB) is offered with optional Mathematics and Computer Science. Fee details are in our approved fee structure — I'll share them now. May I know your name?",
    sources: "Sources: Fee Structure 2026-27.pdf",
  },
  { role: "lead", text: "Priya. Also, is the entrance test in February?" },
  {
    role: "agent",
    text: "Yes Priya — admissions for 2026-27 open 15 Nov, registration closes 31 Jan, and the entrance assessment runs in February. Which city are you based in?",
    sources: "Sources: Admission Eligibility & Dates.docx",
  },
  { role: "lead", text: "Pune. I want to apply this year." },
  {
    role: "agent",
    text: "Perfect — I'm alerting a counselor for a campus visit slot this week. They'll call you shortly. 🎯",
    sources: "Hot lead · score 84 · handed off in 22s",
  },
];

export function InquiryShowcase() {
  const [visible, setVisible] = useState(1);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || visible >= SCRIPT.length) return;
    const id = setTimeout(() => setVisible((v) => v + 1), 2200);
    return () => clearTimeout(id);
  }, [playing, visible]);

  useEffect(() => {
    if (visible >= SCRIPT.length) {
      const id = setTimeout(() => setVisible(1), 4000);
      return () => clearTimeout(id);
    }
  }, [visible]);

  return (
    <div className="workspace-wrap">
      <span className="video-label" style={{ position: "static", display: "block", marginBottom: 8 }}>
        Live inquiry → qualified lead
      </span>
      <div className="video-controls">
        <button
          className="tines-nav-control"
          style={{ width: 26 }}
          aria-label={playing ? "Pause preview" : "Play preview"}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "❚❚" : "►"}
        </button>
        <input
          type="range"
          min={1}
          max={SCRIPT.length}
          value={visible}
          onChange={(e) => setVisible(Number(e.target.value))}
          aria-label="Preview timeline"
        />
        <span className="video-time">{visible}:{String((visible * 13) % 60).padStart(2, "0")} / 0:{SCRIPT.length * 13}</span>
      </div>
      <div className="chat-frame" style={{ height: 460, borderRadius: "0 0 14px 14px" }}>
        <div className="chat-head">
          <span>WhatsApp · Greenfield Public School</span>
          <span className="pill pill-ok">● AI agent live</span>
        </div>
        <div className="chat-body">
          {SCRIPT.slice(0, visible).map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.text}
              {m.sources ? <span className="sources">{m.sources}</span> : null}
            </div>
          ))}
        </div>
        <div className="chat-foot">
          <input className="input" placeholder="Reply as a parent…" disabled />
          <button className="tines-button tines-button-solid" disabled style={{ opacity: 0.6 }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
