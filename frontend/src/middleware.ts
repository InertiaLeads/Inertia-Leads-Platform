import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // `monitoring` is the Sentry tunnel route (see tunnelRoute in next.config.ts).
    // It MUST be excluded: updateSession redirects any unauthenticated request to
    // /login, which would silently swallow every client-side error report.
    "/((?!_next/static|_next/image|favicon.ico|monitoring|docs/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf)$).*)",
  ],
};
