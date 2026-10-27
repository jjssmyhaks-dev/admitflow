// Minimal smoke probe routes for the 500 investigation.
// These are GET routes with no auth so we can curl them even on the
// public homepage. They call one small piece of app code at a time so
// we can see exactly which import/runtime path is crashing.

import { NextResponse } from "next/server";

function cat(...paths: string[]) {
  const out: string[] = [];
  for (const p of paths) {
    try { out.push(p + " OK"); } catch (e) {
      out.push(p + " FAIL: " + (e instanceof Error ? e.message : String(e)));
    }
  }
  return out;
}

export async function GET() {
  const env = cat(
    "clerkConfigured",
    "supabaseConfigured",
    "llmConfigured",
  );
  const lib = cat(
    "repo",
    "session",
    "authz",
    "roles",
    "types",
    "env",
    "embed",
    "ocr",
    "rawstore",
    "nurture",
    "whatsapp",
    "notify",
    "analytics",
    "limits",
    "agent",
    "clerk-tenant",
    "seed",
    "repo-d1",
    "repo-supabase",
    "ingest",
  );
  return NextResponse.json({ env, lib });
}
