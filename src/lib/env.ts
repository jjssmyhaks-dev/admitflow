// Environment capability detection. The app runs fully without keys
// (demo mode); pasting Clerk/Supabase keys into .env.local flips it on.

export const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

export const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const llmConfigured = Boolean(process.env.LLM_API_KEY);

export function isDemoMode() {
  return !clerkConfigured || !supabaseConfigured;
}
