// Session abstraction: Clerk Organizations when keys are configured,
// otherwise a cookie-based demo session so every flow stays testable.
import { cookies } from "next/headers";
import { clerkConfigured } from "@/lib/env";
import type { Role, Session } from "@/lib/types";

const COOKIE = "demo_session";

export const DEMO_USERS: (Session & { password: string })[] = [
  {
    userId: "user_demo_owner",
    orgId: "org_greenfield",
    orgName: "Greenfield Public School",
    role: "owner",
    email: "owner@greenfield.edu",
    password: "demo1234",
  },
  {
    userId: "user_demo_counselor",
    orgId: "org_surya",
    orgName: "Surya Institute of Technology",
    role: "counselor",
    email: "counselor@suryainst.edu",
    password: "demo1234",
  },
];

export async function getSession(): Promise<Session | null> {
  if (clerkConfigured) {
    const { auth } = await import("@clerk/nextjs/server");
    const a = await auth();
    if (!a.userId) return null;
    const rawRole = a.orgRole ?? "org:member";
    const role: Role = rawRole.includes("admin") || rawRole.includes("owner")
      ? (rawRole.includes("owner") ? "owner" : "admin")
      : rawRole.includes("viewer")
        ? "viewer"
        : "counselor";
    // Signed in but no organization yet: return the session with an empty
    // orgId so requireSession can route to /create-org instead of looping.
    return {
      userId: a.userId,
      orgId: a.orgId ?? "",
      orgName: a.orgSlug ?? "",
      role,
      email: "",
    };
  }
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

/** Returns the session or redirects to /sign-in (server components).
 *  Signed-in users without an organization are routed to /create-org. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  const { redirect } = await import("next/navigation");
  if (!s) redirect("/sign-in");
  if (clerkConfigured && !s!.orgId) redirect("/create-org");
  return s!;
}

export const SESSION_COOKIE = COOKIE;
