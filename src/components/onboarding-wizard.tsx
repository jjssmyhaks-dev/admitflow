"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Tenant } from "@/lib/types";
import { trackGoLiveApproved, trackSandboxMessageSent, trackSetupGuideOpened } from "@/lib/analytics";

const STEPS = [
  "Profile",
  "Knowledge",
  "Rules",
  "Channels",
  "Sandbox",
  "Go live",
] as const;

interface Props {
  tenantId: string;
  tenant: Tenant | null;
  docCount: number;
  knowledgeTopics: string[];
  leadCount: number;
}

export function OnboardingWizard({ tenantId, tenant, docCount, knowledgeTopics, leadCount }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({
    name: tenant?.name ?? "",
    type: tenant?.type ?? "college",
    affiliation: tenant?.affiliation ?? "",
    city: tenant?.city ?? "",
    sector: tenant?.sector ?? "private",
    languages: tenant?.languages.join(", ") ?? "en, hi, hinglish",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const guideTracked = useRef(false);

  // One event per visit to the setup guide: the funnel's denominator.
  useEffect(() => {
    if (guideTracked.current) return;
    guideTracked.current = true;
    trackSetupGuideOpened({ hasProfile: Boolean(tenant?.name), knowledgeDocCount: docCount });
  }, [tenant?.name, docCount]);

  const completion = useMemo(() => {
    const checks = [
      Boolean(tenant?.name),
      docCount > 0,
      true, // rules always have defaults
      true, // channels have sandbox by default
      leadCount >= 0,
      false, // live flag local
    ];
    return checks;
  }, [tenant, docCount, leadCount]);

  async function saveProfile() {
    setSaving(true);
    try {
      const res = await fetch("/api/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: tenantId,
          ...profile,
          languages: profile.languages.split(",").map((l) => l.trim()).filter(Boolean),
        }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  const expected = ["fees", "eligibility", "dates", "courses", "campus"];
  const missing = expected.filter((t) => !knowledgeTopics.includes(t));

  return (
    <>
      <div className="steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            className={`step-chip ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => setStep(i)}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="panel">
          <h3>1 · Institution profile</h3>
          <p className="panel-sub">Basic identity used across the console, widget, and WhatsApp header.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="field">
              <label>Institution name</label>
              <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Greenfield Public School" />
            </div>
            <div className="field">
              <label>Type</label>
              <select className="select" value={profile.type} onChange={(e) => setProfile({ ...profile, type: e.target.value as Tenant["type"] })}>
                <option value="school">School</option>
                <option value="college">College</option>
                <option value="university">University</option>
              </select>
            </div>
            <div className="field">
              <label>Board / affiliation</label>
              <input className="input" value={profile.affiliation} onChange={(e) => setProfile({ ...profile, affiliation: e.target.value })} placeholder="CBSE / AICTE / UGC" />
            </div>
            <div className="field">
              <label>City</label>
              <input className="input" value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} placeholder="Pune" />
            </div>
            <div className="field">
              <label>Sector</label>
              <select className="select" value={profile.sector} onChange={(e) => setProfile({ ...profile, sector: e.target.value as Tenant["sector"] })}>
                <option value="private">Private</option>
                <option value="government">Government</option>
              </select>
            </div>
            <div className="field">
              <label>Languages (comma separated)</label>
              <input className="input" value={profile.languages} onChange={(e) => setProfile({ ...profile, languages: e.target.value })} placeholder="en, hi, hinglish" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="tines-button tines-button-solid" onClick={saveProfile} disabled={saving}>
              {saving ? "Saving…" : "Save & continue"}
            </button>
            {saved && <span className="pill pill-ok">Saved</span>}
            <button className="tines-nav-control" onClick={() => setStep(1)}>Skip to knowledge →</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="panel">
          <h3>2 · Add knowledge</h3>
          <p className="panel-sub">
            Upload brochures, fee structures, course lists, eligibility, and FAQs. Currently ingested:{" "}
            <strong>{docCount}</strong> document{docCount === 1 ? "" : "s"}.
          </p>
          {missing.length > 0 && docCount > 0 && (
            <p style={{ fontSize: 13.5, color: "var(--deep)" }}>
              ⚠ Knowledge health gap: no content for <strong>{missing.join(", ")}</strong>.
            </p>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <a className="tines-button tines-button-solid" href="/console/knowledge">Open knowledge base</a>
            <button className="tines-nav-control" onClick={() => setStep(2)}>Continue →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="panel">
          <h3>3 · Set rules</h3>
          <p className="panel-sub">
            Tone, working hours for human handoff, forbidden topics (scholarship promises, seat guarantees),
            escalation triggers, and nurture sequences.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <a className="tines-button tines-button-solid" href="/console/rules">Open agent rules</a>
            <button className="tines-nav-control" onClick={() => setStep(3)}>Continue →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="panel">
          <h3>4 · Connect channels</h3>
          <p className="panel-sub">Copy-paste snippet for your website; WhatsApp via Cloud API/BSP; lead-form webhook.</p>

          <div className="field">
            <label>Website chat widget</label>
            <textarea
              className="textarea"
              rows={4}
              readOnly
              value={`<script src="${typeof window !== "undefined" ? window.location.origin : "https://admitflow.app"}/widget.js" data-tenant="${tenantId}" defer></script>`}
            />
            <span className="hint">Paste before &lt;/body&gt; on your admission pages.</span>
          </div>

          <div className="field">
            <label>Lead form webhook</label>
            <textarea
              className="textarea"
              rows={4}
              readOnly
              value={`POST /api/webhook/lead
Headers: X-Webhook-Secret: $LEAD_WEBHOOK_SECRET
Body: { "tenantId": "${tenantId}", "name": "...", "phone": "+91...", "course": "...", "city": "..." }`}
            />
            <span className="hint">Facebook/Instagram lead ads: import CSV or POST the same endpoint.</span>
          </div>

          <div className="field">
            <label>WhatsApp Business</label>
            <p className="hint" style={{ margin: 0 }}>
              Guided setup with the Cloud API (or BSP — Gupshup/Twilio/Interakt) lands in Phase 0 week 1.
              Incoming messages hit <code>POST /api/chat</code> with <code>channel: "whatsapp"</code>.
            </p>
          </div>

          <button className="tines-nav-control" onClick={() => setStep(4)}>Continue to sandbox →</button>
        </div>
      )}

      {step === 4 && (
        <Sandbox
          tenantId={tenantId}
          hasProfile={Boolean(tenant?.name)}
          knowledgeDocCount={docCount}
          onNext={() => setStep(5)}
        />
      )}

      {step === 5 && (
        <div className="panel">
          <h3>6 · Go live 🎉</h3>
          <p className="panel-sub">
            Your dashboard shows leads in real time. First response target: under 30 seconds, 24×7.
          </p>
          <ul style={{ fontSize: 14.5, lineHeight: 2 }}>
            <li>✅ Profile {tenant?.name ? "configured" : "— go back and save it"}</li>
            <li>{docCount > 0 ? "✅" : "⚠"} {docCount} knowledge document{docCount === 1 ? "" : "s"} ingested</li>
            <li>✅ Rules and guardrails active</li>
            <li>✅ Widget + webhook snippets ready</li>
            <li>{leadCount > 0 ? "✅" : "ℹ"} {leadCount} lead{leadCount === 1 ? "" : "s"} in the funnel</li>
          </ul>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <a className="tines-button tines-button-solid" href="/console">Open dashboard</a>
            <a className="tines-button tines-button-outline" href="/console/inbox">Open inbox</a>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------- sandbox -------------------------------- */

interface SandboxMsg {
  role: "lead" | "agent";
  content: string;
  sources?: string[];
}

function Sandbox({
  tenantId,
  hasProfile,
  knowledgeDocCount,
  onNext,
}: {
  tenantId: string;
  hasProfile: boolean;
  knowledgeDocCount: number;
  onNext: (messagesSent: number) => void;
}) {
  const [msgs, setMsgs] = useState<SandboxMsg[]>([
    { role: "agent", content: "Namaste! I'm the admissions assistant. Ask me anything — fees, dates, eligibility." },
  ]);
  const [input, setInput] = useState("");
  const [convId, setConvId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "lead", content }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          text: content,
          channel: "web_widget",
          conversationId: convId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setConvId(data.conversationId);
        setMsgs((m) => [...m, { role: "agent", content: data.reply, sources: data.sources }]);
        if (data.handoff) {
          setMsgs((m) => [...m, { role: "agent", content: "🔔 A counselor has been notified with the full conversation." }]);
        }
        trackSandboxMessageSent({
          isFirstMessage: sent === 0,
          answerGrounded: Array.isArray(data.sources) && data.sources.length > 0,
          handoff: Boolean(data.handoff),
        });
        setSent((n) => n + 1);
      } else {
        setMsgs((m) => [...m, { role: "agent", content: `Error: ${data.error ?? "failed"}` }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: "agent", content: "Network error — try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>5 · Test in sandbox</h3>
      <p className="panel-sub">Chat as a parent would. Approve before going live.</p>
      <div className="chat-frame" style={{ height: 420 }}>
        <div className="chat-head">
          <span>Sandbox · web widget</span>
          <span className={`pill ${busy ? "pill-warm" : "pill-ok"}`}>{busy ? "thinking…" : "ready"}</span>
        </div>
        <div className="chat-body">
          {msgs.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role === "lead" ? "lead" : "agent"}`}>
              {m.content}
              {m.sources?.length ? <span className="sources">Sources: {m.sources.join(", ")}</span> : null}
            </div>
          ))}
        </div>
        <div className="chat-foot">
          <input
            className="input"
            value={input}
            placeholder="e.g. What are the Class 11 Science fees?"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="tines-button tines-button-solid" onClick={() => send()} disabled={busy}>
            Send
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {["What are the fees for Class 11 Science?", "When does admission close?", "Is there a scholarship?"].map((q) => (
          <button key={q} className="step-chip" style={{ cursor: "pointer" }} onClick={() => send(q)} disabled={busy}>
            {q}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button
          className="tines-button tines-button-solid"
          onClick={() => {
            trackGoLiveApproved({ hasProfile, knowledgeDocCount, sandboxMessages: sent });
            onNext(sent);
          }}
        >
          Approve &amp; go live →
        </button>
      </div>
    </div>
  );
}
