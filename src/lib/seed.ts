// Seeded demo data so the console is meaningful before real leads arrive.
import { getRepo, uid } from "@/lib/repo";
import { defaultSettings } from "@/lib/repo";
import type { AuditEvent, Conversation, KnowledgeChunk, KnowledgeDoc, Lead, Message, Tenant } from "@/lib/types";

const DAY = 86400000;
const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

const TENANTS: Tenant[] = [
  {
    id: "org_greenfield",
    name: "Greenfield Public School",
    type: "school",
    affiliation: "CBSE",
    city: "Pune",
    sector: "private",
    languages: ["en", "hi", "hinglish"],
    slug: "greenfield",
    createdAt: iso(-30 * DAY),
  },
  {
    id: "org_surya",
    name: "Surya Institute of Technology",
    type: "college",
    affiliation: "AICTE",
    city: "Hyderabad",
    sector: "private",
    languages: ["en", "hi"],
    slug: "surya",
    createdAt: iso(-20 * DAY),
  },
];

const GF_DOCS: { doc: Omit<KnowledgeDoc, "id">; chunks: string[]; topics: string[][] }[] = [
  {
    doc: {
      tenantId: "org_greenfield",
      name: "Fee Structure 2026-27.pdf",
      kind: "pdf",
      status: "ingested",
      version: 2,
      updatedAt: iso(-5 * DAY),
      chunkCount: 4,
      topics: ["fees"],
    },
    chunks: [
      "Annual fee for Class 1 to 5 is INR 48,000, payable in two installments (April and October). Sibling discount of 10% applies to the second child.",
      "Annual fee for Class 6 to 8 is INR 56,000. Annual fee for Class 9 and 10 is INR 64,000 including lab charges.",
      "Admission registration fee is INR 2,000 and is non-refundable. It is adjusted against the first term fee if the admission is confirmed.",
      "Transport fee is INR 9,000 per year for Zone A and INR 12,000 per year for Zone B.",
    ],
    topics: [["fees"], ["fees"], ["fees", "admission"], ["fees", "transport"]],
  },
  {
    doc: {
      tenantId: "org_greenfield",
      name: "Admission Eligibility & Dates.docx",
      kind: "docx",
      status: "ingested",
      version: 1,
      updatedAt: iso(-10 * DAY),
      chunkCount: 4,
      topics: ["eligibility", "dates"],
    },
    chunks: [
      "Admissions for 2026-27 open on 15 November 2026. Registration closes on 31 January 2027. Entrance assessment for Class 2 and above is held in February 2027.",
      "For Class 1 admission, the child must be 6 years old as on 31 March 2027. No entrance test is conducted for Class 1.",
      "Students transferring from other boards are eligible for direct admission subject to seat availability and a transfer certificate.",
      "NRI and outstation candidates may apply online; the entrance assessment is conducted remotely.",
    ],
    topics: [["dates"], ["eligibility"], ["eligibility"], ["eligibility"]],
  },
  {
    doc: {
      tenantId: "org_greenfield",
      name: "Courses & Campus FAQ.xlsx",
      kind: "xlsx",
      status: "ingested",
      version: 1,
      updatedAt: iso(-3 * DAY),
      chunkCount: 3,
      topics: ["courses", "campus"],
    },
    chunks: [
      "Greenfield offers Science (PCM/PCB), Commerce, and Humanities streams in Class 11 with optional Mathematics and Computer Science.",
      "Campus tours run Monday to Saturday, 10:00 to 16:00. Parents can book a visit by replying VISIT or calling the admissions office.",
      "The school runs bus routes across Pune including Kothrud, Baner, Hinjewadi, and Hadapsar.",
    ],
    topics: [["courses"], ["campus", "visit"], ["transport", "campus"]],
  },
];

const SURYA_CHUNKS: { content: string; topics: string[] }[] = [
  {
    content:
      "B.Tech tuition fee is INR 1,20,000 per year. MBA fee is INR 1,80,000 per year. Hostel fee is INR 78,000 per year including mess.",
    topics: ["fees"],
  },
  {
    content:
      "B.Tech admission requires 45% marks in 10+2 with Physics, Mathematics, and one of Chemistry/Biology/Computer Science. Admissions are through TS EAMCET or management quota.",
    topics: ["eligibility"],
  },
  {
    content:
      "Counselling and seat allotment for the 2026 session starts on 1 August 2027. Classes begin on 15 August 2027.",
    topics: ["dates"],
  },
  {
    content:
      "Campus recruiters include TCS, Infosys, Wipro, and Cognizant. The 2026 batch recorded 92% placement with an average package of INR 4.8 LPA.",
    topics: ["placement", "courses"],
  },
  {
    content:
      "Hostel is available for boys and girls on campus with 24x7 Wi-Fi, mess, and study hall. Single and double sharing rooms are offered.",
    topics: ["hostel", "campus"],
  },
];

const LEADS: (Partial<Lead> & { phone: string; name: string })[] = [
  { phone: "+919876543210", name: "Priya Sharma", city: "Pune", courseInterest: "Class 11 Science", tier: "hot", score: 84, status: "qualified", language: "hinglish", source: "whatsapp" },
  { phone: "+919812345678", name: "Ramesh Iyer", city: "Pune", courseInterest: "Class 6", tier: "warm", score: 55, status: "nurturing", language: "en", source: "web_widget" },
  { phone: "+919000011111", name: "Ayesha Khan", city: "Mumbai", courseInterest: "Class 9 Transfer", tier: "warm", score: 48, status: "nurturing", language: "en", source: "lead_form" },
  { phone: "+919222233333", name: "Suresh Patil", city: "Nashik", courseInterest: "Class 1", tier: "cold", score: 22, status: "new", language: "hi", source: "whatsapp" },
  { phone: "+919444455555", name: "Meera Nair", city: "Pune", courseInterest: "Class 11 Commerce", tier: "hot", score: 76, status: "visit_booked", language: "en", source: "web_widget" },
  { phone: "+919555566666", name: "Vikram Rao", city: "Hyderabad", courseInterest: "B.Tech CSE", tier: "hot", score: 91, status: "qualified", language: "en", source: "whatsapp" },
  { phone: "+919666677777", name: "Anita Deshpande", city: "Hyderabad", courseInterest: "MBA", tier: "warm", score: 61, status: "nurturing", language: "hinglish", source: "web_widget" },
  { phone: "+919777788888", name: "John D'Souza", city: "Warangal", courseInterest: "B.Tech ECE", tier: "cold", score: 18, status: "new", language: "en", source: "lead_form" },
];

// In-process lock: parallel requests during first boot must not double-seed.
let seeding: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  seeding ??= doEnsureSeed().catch((err) => {
    seeding = null;
    throw err;
  });
  return seeding;
}

async function doEnsureSeed() {
  const repo = await getRepo();
  const marker = await repo.getTenant("org_greenfield");
  if (marker) return;

  for (const t of TENANTS) await repo.upsertTenant(t);
  await repo.saveSettings(defaultSettings("org_greenfield"));
  await repo.saveSettings(defaultSettings("org_surya"));

  for (const d of GF_DOCS) {
    const docId = uid();
    const doc: KnowledgeDoc = { id: docId, ...d.doc };
    const chunks: Omit<KnowledgeChunk, "id">[] = d.chunks.map((content, i) => ({
      docId,
      tenantId: "org_greenfield",
      content,
      topics: d.topics[i],
    }));
    await repo.addKnowledge(doc, chunks);
  }
  const sDocId = uid();
  const suryaDoc: KnowledgeDoc = {
    id: sDocId,
    tenantId: "org_surya",
    name: "Syllabus & Fee Brochure.pdf",
    kind: "pdf",
    status: "ingested",
    version: 1,
    updatedAt: iso(-7 * DAY),
    chunkCount: SURYA_CHUNKS.length,
    topics: ["fees", "eligibility", "placement"],
  };
  await repo.addKnowledge(
    suryaDoc,
    SURYA_CHUNKS.map((c) => ({ docId: sDocId, tenantId: "org_surya", ...c })),
  );

  for (const l of LEADS) {
    const tenantId = l.name === "Vikram Rao" || l.name === "Anita Deshpande" || l.name === "John D'Souza"
      ? "org_surya"
      : "org_greenfield";
    const lead: Lead = {
      id: uid(),
      tenantId,
      name: l.name,
      phone: l.phone,
      city: l.city,
      courseInterest: l.courseInterest,
      source: l.source as Lead["source"],
      score: l.score ?? 0,
      tier: l.tier ?? "cold",
      status: l.status as Lead["status"],
      language: l.language ?? "en",
      optedOut: false,
      createdAt: iso(-(Math.floor(Math.random() * 6) + 1) * DAY),
      updatedAt: iso(-Math.floor(Math.random() * 12) * 3600000),
      summary: `${l.name} inquired about ${l.courseInterest}. Lead scored ${l.score} (${l.tier}).`,
    };
    const saved = await repo.upsertLead(lead);
    const conv: Conversation = {
      id: uid(),
      tenantId,
      leadId: saved.id,
      channel: lead.source,
      status: lead.tier === "hot" && lead.status === "qualified" ? "human" : "ai",
      summary: lead.summary,
      lastActivityAt: lead.updatedAt,
      createdAt: lead.createdAt,
    };
    await repo.upsertConversation(conv);
    const msgs: Omit<Message, "id">[] = [
      { conversationId: conv.id, tenantId, role: "lead", content: `Hi, I want to know about ${lead.courseInterest} admission.`, sources: [], createdAt: lead.createdAt },
      { conversationId: conv.id, tenantId, role: "ai", content: `Hello ${lead.name}! Happy to help with ${lead.courseInterest}. Could you share your city so I can check seat availability?`, sources: [], createdAt: new Date(new Date(lead.createdAt).getTime() + 25000).toISOString() },
    ];
    for (const m of msgs) await repo.addMessage({ ...m, id: uid() } as Message);
  }

  const audits: AuditEvent[] = [
    { id: uid(), tenantId: "org_greenfield", actor: "ai", action: "answer.grounded", detail: "Answered fee question for Priya Sharma", sources: ["Fee Structure 2026-27.pdf"], createdAt: iso(-2 * DAY) },
    { id: uid(), tenantId: "org_greenfield", actor: "ai", action: "handoff.requested", detail: "Hot lead Priya Sharma handed to counselor", sources: [], createdAt: iso(-2 * DAY + 300000) },
    { id: uid(), tenantId: "org_greenfield", actor: "counselor", action: "lead.outcome", detail: "Meera Nair marked visit_booked", sources: [], createdAt: iso(-DAY) },
    { id: uid(), tenantId: "org_surya", actor: "ai", action: "answer.fallback", detail: "No retrieval hit for scholarship question — counselor fallback used", sources: [], createdAt: iso(-DAY) },
  ];
  for (const a of audits) await repo.addAudit(a);
}
