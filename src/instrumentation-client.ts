// Browser analytics bootstrap (Next.js instrumentation-client boundary).
// posthog-js is a module-level singleton, so installing it here means every
// instrumented component reuses this one client. initAnalytics() is a no-op
// without NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN/HOST and without analytics consent.
import posthog from "posthog-js";
import { initAnalytics, installAnalyticsClient } from "@/lib/analytics";

installAnalyticsClient(posthog);
initAnalytics();
