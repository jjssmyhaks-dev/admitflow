"use client";

import { useEffect } from "react";
import { identifySession } from "@/lib/analytics";

/** Associates the session with the opaque auth id (never the email) once
 *  analytics consent exists; otherwise the visitor stays anonymous. */
export function AnalyticsIdentity({ subjectId }: { subjectId: string }) {
  useEffect(() => {
    identifySession(subjectId);
  }, [subjectId]);
  return null;
}
