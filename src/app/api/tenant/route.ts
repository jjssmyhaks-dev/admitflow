import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepo, uid } from "@/lib/repo";

const Profile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["school", "college", "university"]),
  affiliation: z.string().default(""),
  city: z.string().default(""),
  sector: z.enum(["government", "private"]),
  languages: z.array(z.string()),
});

export async function POST(req: NextRequest) {
  const parsed = Profile.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const repo = await getRepo();
  const existing = await repo.getTenant(parsed.data.id);
  const slug =
    parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) ||
    parsed.data.id;
  const tenant = await repo.upsertTenant({
    id: parsed.data.id,
    name: parsed.data.name,
    type: parsed.data.type,
    affiliation: parsed.data.affiliation,
    city: parsed.data.city,
    sector: parsed.data.sector,
    languages: parsed.data.languages,
    slug,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });
  await repo.addAudit({
    id: uid(),
    tenantId: tenant.id,
    actor: "counselor",
    action: "tenant.profile",
    detail: `Updated institution profile: ${tenant.name} (${tenant.type}, ${tenant.city || "city n/a"})`,
    sources: [],
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ tenant });
}
