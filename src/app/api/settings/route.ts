import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepo, uid } from "@/lib/repo";
import { requireTenant } from "@/lib/authz";

const SettingsSchema = z.object({
  tenantId: z.string().min(1),
  tone: z.string(),
  workingHours: z.string(),
  neverAnswer: z.array(z.string()),
  escalationTriggers: z.array(z.string()),
  hotThreshold: z.number().min(0).max(100),
  warmThreshold: z.number().min(0).max(100),
  sequences: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      tier: z.enum(["hot", "warm", "cold"]),
      enabled: z.boolean(),
      steps: z.array(z.object({ dayOffset: z.number(), message: z.string() })),
    }),
  ),
});

export async function GET() {
  const auth = await requireTenant("", "manage");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ settings: {} }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const parsed = SettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const auth = await requireTenant(parsed.data.tenantId, "manage");
  if (!auth.ok) return auth.response;
  const repo = await getRepo();
  const tenant = await repo.getTenant(parsed.data.tenantId);
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  await repo.saveSettings(parsed.data);
  await repo.addAudit({
    id: uid(),
    tenantId: parsed.data.tenantId,
    actor: "counselor",
    action: "settings.updated",
    detail: "Updated agent rules (tone, guardrails, thresholds, sequences)",
    sources: [],
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
