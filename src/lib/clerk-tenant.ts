// First console visit for a real Clerk organization: create the tenant row
// so knowledge/settings/leads have a home (PRD 5.1 — org == institution).
import { clerkConfigured } from "@/lib/env";
import type { Repo } from "@/lib/repo";
import type { Session, Tenant } from "@/lib/types";

// Cache Clerk BAPI lookups per process so every console page render doesn't
// hit the API. Dev instances are low traffic; this is just a hot-path guard.
const orgCache = new Map<string, string>();
const emailCache = new Map<string, string>();

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "institution"
  );
}

async function clerkOrgName(orgId: string): Promise<string | null> {
  if (orgCache.has(orgId)) return orgCache.get(orgId)!;
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({ organizationId: orgId });
    orgCache.set(orgId, org.name);
    return org.name;
  } catch {
    return null;
  }
}

export async function clerkUserEmail(userId: string): Promise<string> {
  if (emailCache.has(userId)) return emailCache.get(userId)!;
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
        ?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? "";
    emailCache.set(userId, email);
    return email;
  } catch {
    return "";
  }
}

/** Returns the tenant for the session, bootstrapping it from Clerk if new. */
export async function ensureTenant(repo: Repo, session: Session): Promise<Tenant | null> {
  if (!session.orgId) return null;
  const existing = await repo.getTenant(session.orgId);
  if (existing) return existing;

  const name =
    (clerkConfigured ? await clerkOrgName(session.orgId) : null) ??
    session.orgName ??
    session.orgId;

  return repo.upsertTenant({
    id: session.orgId,
    name,
    type: "college",
    affiliation: "",
    city: "",
    sector: "private",
    languages: ["en", "hi", "hinglish"],
    slug: slugify(name),
    createdAt: new Date().toISOString(),
  });
}
