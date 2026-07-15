import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// OAuth (e.g. "Continue with Google") returns here with a `?code=...`.
// We exchange that code for a session cookie, then send the user into the app.
// Without this route the code is never exchanged, so the user has no session
// and the middleware bounces them straight back to /login (the redirect loop).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Behind Vercel's proxy `origin` can be the internal host, so prefer the
      // forwarded host in production to build a correct absolute redirect URL.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  // No code, or exchange failed — send back to login with an error flag.
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
