// Server-side API authorization. Every tenant-scoped route resolves its
// tenant from the caller's session — never from client input alone — and
// checks the caller's role before mutating anything.
import { NextResponse } from "next/server";
import { clerkConfigured } from "@/lib/env";
import { getSession } from "@/lib/session";
import type { Session } from "@/lib/types";
import { can, type Perm } from "@/lib/roles";

export { can as hasPerm, type Perm } from "@/lib/roles";

export interface AuthzOk {
  ok: true;
  session: Session;
  tenantId: string;
}

export type AuthzResult = AuthzOk | { ok: false; response: NextResponse };

const json = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

/** Authenticate the caller, enforce the permission tier, and resolve the
 *  tenant they may act on. `requested` is whatever the client sent; if it
 *  doesn't match the session's organization the request is a cross-tenant
 *  attempt and is refused. */
export async function requireTenant(
  requested: string | null | undefined,
  perm: Perm,
): Promise<AuthzResult> {
  const session = await getSession();
  if (!session) return { ok: false, response: json("unauthorized", 401) };
  if (clerkConfigured && !session.orgId) {
    return { ok: false, response: json("no organization", 403) };
  }
  if (!session.orgId) return { ok: false, response: json("no organization", 403) };
  if (requested && requested !== session.orgId) {
    return { ok: false, response: json("forbidden", 403) };
  }
  if (!can(session.role, perm)) {
    return { ok: false, response: json(`role '${session.role}' cannot ${perm}`, 403) };
  }
  return { ok: true, session, tenantId: session.orgId };
}

/** Machine access for schedulers and webhooks: a shared secret (CRON_SECRET
 *  via x-cron-secret, or one of `secretEnvs` via x-webhook-secret), or an
 *  admin session. Deliberately no insecure default — a missing secret never
 *  means "accept". */
export type MachineAuthz =
  | { ok: true; via: "secret" }
  | { ok: true; via: "session"; session: Session; tenantId: string }
  | { ok: false; response: NextResponse };

export async function requireCronOrAdmin(
  req: Request,
  perm: Perm,
  ...secretEnvs: string[]
): Promise<MachineAuthz> {
  const cron = process.env.CRON_SECRET;
  const cronProvided = req.headers.get("x-cron-secret") ?? undefined;
  if (cron && cronProvided && cronProvided === cron) return { ok: true, via: "secret" };

  const webhook = req.headers.get("x-webhook-secret") ?? undefined;
  if (webhook) {
    const expected = secretEnvs.map((n) => process.env[n]).find((v) => v && v.length > 0);
    if (expected && webhook === expected) return { ok: true, via: "secret" };
  }

  const session = await getSession();
  if (!session) return { ok: false, response: json("unauthorized", 401) };
  if (!can(session.role, perm)) {
    return { ok: false, response: json(`role '${session.role}' cannot ${perm}`, 403) };
  }
  return { ok: true, via: "session", session, tenantId: session.orgId };
}

/** Shared-secret check for machine webhooks (lead form, OCR). Returns
 *  configured:false when no secret env is set — callers must then reject
 *  instead of falling back to a default value. */
export function webhookSecretOk(
  provided: string | undefined,
  ...envNames: string[]
): { ok: boolean; configured: boolean } {
  const expected = envNames.map((n) => process.env[n]).find((v) => v && v.length > 0);
  if (!expected) return { ok: false, configured: false };
  return { ok: Boolean(provided && provided === expected), configured: true };
}
