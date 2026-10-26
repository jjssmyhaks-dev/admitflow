import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtected = createRouteMatcher(["/console(.*)", "/api/console(.*)"]);
const isCreateOrg = createRouteMatcher(["/create-org"]);
const isAuthPage = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

const clerkEnabled = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

const handler = clerkEnabled
  ? clerkMiddleware(async (auth, req) => {
      const { userId, orgId } = await auth();
      const url = new URL(req.url);

      if (isProtected(req)) {
        if (!userId) return NextResponse.redirect(new URL("/sign-in", url));
        // Signed in but no organization yet (PRD 5.1: create org = institution)
        if (!orgId) return NextResponse.redirect(new URL("/create-org", url));
      }

      if (isCreateOrg(req)) {
        if (!userId) return NextResponse.redirect(new URL("/sign-in", url));
        if (orgId) return NextResponse.redirect(new URL("/console", url));
      }

      // Already signed in with an org: skip the auth screens.
      if (userId && orgId && isAuthPage(req)) {
        return NextResponse.redirect(new URL("/console", url));
      }

      return NextResponse.next();
    })
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
