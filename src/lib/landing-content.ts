// Landing page copy (PRD §1, §2, §6). Kept separate from layout so the
// marketing site can be re-worded without touching components.

export const landingSections = {
  hero: {
    copy:
      "AdmitFlow answers every WhatsApp, web, and form inquiry in under 30 seconds — in the lead's language — qualifies it, and hands hot leads to your counselors with full context. Nothing leaks. Nothing goes cold.",
  },
  reality: {
    eyebrow: "The new reality for admissions teams",
    headline: "Inquiries arrive all day.",
    headlineStrong: "Most get answered too late — or not at all.",
    stats: [
      { label: "First reply today", value: "Hours–days", delta: "Parents ask on WhatsApp at 11pm" },
      { label: "Tracked in", value: "Excel", delta: "Or not tracked at all" },
      { label: "Repeat questions", value: "100s/week", delta: "Fees, eligibility, dates" },
      { label: "Funnel visibility", value: "None", delta: "Management flies blind" },
    ],
    caption: "The competitor who answers first wins the admission.",
    paragraphs: [
      "Inquiries arrive via WhatsApp, calls, website forms, Instagram, walk-ins, and portals — and live in Excel, or nowhere.",
      "Staff answer the same fee, eligibility, and date questions hundreds of times. Follow-ups are manual and inconsistent, and parents write in Hindi, Hinglish, Odia, and more.",
      "Meanwhile management has no view of funnel conversion or counselor performance.",
    ],
  },
  solution: {
    eyebrow: "Phase 1: two agents, one promise",
    title: "Answer in 30 seconds.",
    titleStrong: "Follow up until they apply.",
    items: [
      {
        icon: "⚡",
        title: "Inquiry & Lead Capture agent",
        text: "Greets on WhatsApp and your website widget, answers only from your approved knowledge, and captures name, phone, course, and city — one question at a time.",
      },
      {
        icon: "🧭",
        title: "Qualify & score every lead",
        text: "Interest, timeline, budget sensitivity, and eligibility fit produce a 0–100 score. Hot leads alert a counselor instantly; warm leads enter nurture.",
      },
      {
        icon: "🤝",
        title: "Counseling & Nurture agent",
        text: "Configurable multi-touch sequences run until the lead applies, declines, or types STOP. Counselors take over any thread with full context.",
      },
      {
        icon: "🛡️",
        title: "Guardrails & audit",
        text: "Answers grounded in approved documents only. No invented fees, dates, or guarantees. Every AI message is logged with the sources it used.",
      },
    ],
    ctaHighlight: "Three screens to value:",
    ctaText: "sign up, add knowledge, go live — under one day, no engineering help.",
  },
  teams: {
    eyebrow: "Three screens to value",
    headline: "Built for the people who run admissions.",
    sub: "Admins set it up once. Counselors live in the inbox. Leads get answers at midnight.",
    rows: [
      {
        screen: "Institution Admin onboarding",
        who: "Registrar, admissions head, school owner",
        what: "Create the institution, upload brochures and fee structures, set rules and working hours, connect WhatsApp and the web widget, test in a sandbox, go live — target under 60 minutes.",
      },
      {
        screen: "Counselor Inbox",
        who: "Admissions staff",
        what: "Leads sorted by score and urgency with an AI summary, full conversation, and suggested next action. Take over (AI pauses) or approve the suggested reply. Log outcomes.",
      },
      {
        screen: "Funnel dashboard",
        who: "Management",
        what: "Leads, response time, qualified %, visits booked, applications started — plus audit log, knowledge health, and CSV/webhook export.",
      },
      {
        screen: "Student / Parent journey",
        who: "The lead",
        what: "Messages WhatsApp or the widget, gets accurate answers in their language, books a campus visit or counselor call, and follows up until they apply or opt out.",
      },
      {
        screen: "Platform Owner",
        who: "Super admin",
        what: "Tenant list, plans and usage, per-tenant knowledge health, flagged conversations, and global quality metrics.",
      },
    ],
  },
  why: {
    eyebrow: "Why AdmitFlow?",
    headline: "Safe multi-tenancy,",
    headlineStrong: "grounded answers, real results.",
    sub: "One platform, isolated by institution. Knowledge, conversations, and audit trails never cross tenants — and the AI never leaves its approved sources.",
    items: [
      { glyph: "🔒", bold: "Tenant isolation by design.", text: "Row-level security on every table keyed to your organization." },
      { glyph: "📖", bold: "Grounded in your documents.", text: "Brochures, fee structures, FAQs — versioned, with a knowledge health score." },
      { glyph: "🌏", bold: "Speaks your lead's language.", text: "English, Hindi, and Hinglish at launch; six more regional languages next." },
      { glyph: "📈", bold: "Measurable in one cycle.", text: "Response time, qualification rate, visits booked — tracked from day one." },
    ],
    cta: "Start your pilot today, or talk to us about your admission cycle.",
  },
} as const;
