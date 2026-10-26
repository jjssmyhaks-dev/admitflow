import type { Metadata } from "next";
import "./globals.css";
import { clerkConfigured } from "@/lib/env";
import { AnalyticsConsent } from "@/components/analytics-consent";

export const metadata: Metadata = {
  title: "AdmitFlow — Never miss an admission lead",
  description:
    "Multi-tenant AI agents that answer, qualify, and nurture every admission lead in under 30 seconds — in the lead's language, 24x7.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let body = children;
  if (clerkConfigured) {
    const { ClerkProvider } = await import("@clerk/nextjs");
    body = <ClerkProvider>{children}</ClerkProvider>;
  }
  return (
    <html lang="en">
      <body>
        {body}
        <AnalyticsConsent />
      </body>
    </html>
  );
}
