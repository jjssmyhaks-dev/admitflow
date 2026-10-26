"use client";

import { useRouter } from "next/navigation";
import { resetAnalyticsIdentity } from "@/lib/analytics";

export function DemoSignOut() {
  const router = useRouter();
  return (
    <button
      className="tines-nav-control"
      style={{ marginTop: 8, paddingLeft: 0, textAlign: "left" }}
      onClick={async () => {
        resetAnalyticsIdentity();
        await fetch("/api/session", { method: "DELETE" });
        router.push("/");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
