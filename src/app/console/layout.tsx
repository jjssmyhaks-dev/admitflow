import Link from "next/link";
import {
  Activity,
  BookOpen,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  ScrollText,
  Settings,
  Sparkles,
} from "lucide-react";
import { requireSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";
import { Brand } from "@/components/marketing";
import { DemoSignOut } from "@/components/demo-sign-out";
import { ClerkSignOut } from "@/components/clerk-sign-out";
import { clerkConfigured } from "@/lib/env";
import { clerkUserEmail, ensureTenant } from "@/lib/clerk-tenant";
import { AnalyticsIdentity } from "@/components/analytics-identity";

const NAV = [
  { href: "/console", label: "Dashboard", icon: LayoutDashboard, end: true },
  { href: "/console/inbox", label: "Inbox", icon: Inbox },
  { href: "/console/leads", label: "Leads", icon: GraduationCap },
  { href: "/console/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/console/onboarding", label: "Setup guide", icon: Sparkles },
  { href: "/console/rules", label: "Agent rules", icon: Settings },
  { href: "/console/audit", label: "Audit log", icon: ScrollText },
  { href: "/console/activity", label: "Nurture queue", icon: Activity },
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  await ensureSeed();
  const repo = await getRepo();
  const tenant = await ensureTenant(repo, session);
  const email = session.email || (clerkConfigured ? await clerkUserEmail(session.userId) : "");

  return (
    <div className="console-shell">
      <AnalyticsIdentity subjectId={session.userId} />
      <aside className="console-sidebar">
        <div style={{ marginBottom: 10, paddingLeft: 10 }}>
          <Brand />
        </div>
        <div className="side-label">Institution</div>
        <div style={{ padding: "0 10px 8px", fontSize: 14, fontWeight: 600 }}>
          {tenant?.name ?? session.orgName}
        </div>
        <div className="side-label">Console</div>
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="console-link">
            <item.icon size={16} />
            {item.label}
          </Link>
        ))}
        <div style={{ marginTop: "auto", padding: "14px 10px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
          <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{email || session.userId}</div>
          <div style={{ color: "var(--muted-foreground)", textTransform: "capitalize" }}>{session.role}</div>
          {clerkConfigured ? <ClerkSignOut /> : <DemoSignOut />}
        </div>
      </aside>
      <div className="console-main">{children}</div>
    </div>
  );
}
