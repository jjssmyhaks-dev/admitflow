import { clerkConfigured } from "@/lib/env";
import { DemoAuthForm } from "@/components/auth-form";

export default async function SignInPage() {
  if (clerkConfigured) {
    const { SignIn } = await import("@clerk/nextjs");
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <SignIn forceRedirectUrl="/console" />
      </div>
    );
  }
  return <DemoAuthForm mode="sign-in" />;
}
