"use client";

import { useEffect, useState } from "react";
import {
  analyticsConfigured,
  readConsentDecision,
  setConsentDecision,
  type ConsentDecision,
} from "@/lib/analytics";

/** One-time analytics consent control. Renders only when PostHog is configured
 *  and the visitor has not decided yet — no decision means analytics stays off. */
export function AnalyticsConsent() {
  const [decision, setDecision] = useState<ConsentDecision | null>(null);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    if (!analyticsConfigured()) return;
    setConfigured(true);
    setDecision(readConsentDecision());
  }, []);

  if (!configured || decision) return null;

  function choose(next: ConsentDecision) {
    setConsentDecision(next);
    setDecision(next);
  }

  return (
    <aside className="consent-bar" role="region" aria-label="Analytics consent">
      <p>
        <strong>Optional product analytics.</strong> Allow us to record which admission-setup steps work?
        No session replay, no page tracking, no lead data.
      </p>
      <div className="consent-actions">
        <button type="button" className="tines-button tines-button-solid" onClick={() => choose("granted")}>
          Allow
        </button>
        <button type="button" className="tines-nav-control" onClick={() => choose("denied")}>
          No thanks
        </button>
      </div>
    </aside>
  );
}
