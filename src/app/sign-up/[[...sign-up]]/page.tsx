import { clerkConfigured } from "@/lib/env";
import { DemoAuthForm } from "@/components/auth-form";

export default async function SignUpPage() {
  if (clerkConfigured) {
    const { SignUp } = await import("@clerk/nextjs");
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* New users have no org yet → middleware sends them to /create-org */}
        <SignUp forceRedirectUrl="/console" />
      </div>
    );
  }
  return <DemoAuthForm mode="sign-up" />;
}
