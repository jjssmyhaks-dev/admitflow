import { clerkConfigured } from "@/lib/env";
import { redirect } from "next/navigation";

// PRD 5.1 step 1: sign up via Clerk, then "Create an Organization = the
// institution". New users land here before /console.
export default async function CreateOrgPage() {
  if (!clerkConfigured) {
    // Demo mode always has an organization already.
    redirect("/console");
  }
  const { CreateOrganization } = await import("@clerk/nextjs");
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <p className="eyebrow" style={{ marginBottom: 12 }}>
        Step 1 of setup
      </p>
      <h1 style={{ fontSize: 30, fontWeight: 500, margin: "0 0 6px" }}>
        Create your institution
      </h1>
      <p
        style={{
          color: "var(--muted-foreground)",
          fontSize: 14.5,
          margin: "0 0 22px",
          textAlign: "center",
        }}
      >
        The organization you create here is your tenant — all knowledge,
        leads, and conversations stay isolated inside it.
      </p>
      <CreateOrganization afterCreateOrganizationUrl="/console" />
    </div>
  );
}
