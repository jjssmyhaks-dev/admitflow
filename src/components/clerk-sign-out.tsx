"use client";

import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { resetAnalyticsIdentity } from "@/lib/analytics";

export function ClerkSignOut() {
  const { signOut } = useClerk();
  return (
    <button
      className="tines-nav-control"
      style={{ marginTop: 8, paddingLeft: 0, textAlign: "left" }}
      onClick={() => {
        resetAnalyticsIdentity();
        void signOut({ redirectUrl: "/" });
      }}
    >
      Sign out
    </button>
  );
}
