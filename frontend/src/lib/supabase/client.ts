import { createBrowserClient } from "@supabase/ssr";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: true,
          detectSessionInUrl: true,
        },
      }
    );

    // Tell Sentry who is hitting each error. Registered here, inside the `!client`
    // branch, so it attaches exactly once per page load however many components call
    // createClient(). Supabase fires INITIAL_SESSION on subscribe, so a restored
    // session from localStorage identifies the user too — not just a fresh login.
    //
    // ONLY id and email are sent. Never the access token, refresh token, or anything
    // else off the session object.
    client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (session?.user) {
        Sentry.setUser({ id: session.user.id, email: session.user.email });
      } else {
        Sentry.setUser(null);
      }
    });
  }
  return client;
}
