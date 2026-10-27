import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clerkConfigured } from "@/lib/env";
import { DEMO_USERS, SESSION_COOKIE } from "@/lib/session";
import { limitOr429 } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  // Login brute-force brake: 10 attempts/min per IP.
  const limited = limitOr429("login", req, 10, 60_000);
  if (limited) return limited;
  if (clerkConfigured) {
    return NextResponse.json(
      { error: "Clerk is configured — use the Clerk sign-in form." },
      { status: 400 },
    );
  }
  const { email, password } = await req.json();
  const user = DEMO_USERS.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.password === password,
  );
  if (!user) {
    return NextResponse.json({ error: "Unknown credentials. Use a prefilled demo account." }, { status: 401 });
  }
  const { password: _pw, ...session } = user;
  const store = await cookies();
  store.set(SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return NextResponse.json({ ok: true, session });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
