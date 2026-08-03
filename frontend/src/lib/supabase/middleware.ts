import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Build a redirect that preserves any auth cookies that getUser() just
  // refreshed onto supabaseResponse. Returning a bare NextResponse.redirect
  // drops those Set-Cookie headers, so the browser keeps the old (now-rotated)
  // refresh token and gets logged out on the next request.
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  // Redirect unauthenticated users to login (except for public routes)
  const publicRoutes = ["/login", "/signup", "/verify-email", "/forgot-password", "/reset-password", "/privacy", "/terms"];
  // /auth/callback must be reachable without a session — it's where the OAuth
  // code gets exchanged FOR the session. Blocking it recreates the login loop.
  //
  // /billing/return must ALSO be public, for a subtler reason: it's the return_url of
  // Dodo's checkout, which runs in an iframe. When Dodo redirects back, that's a
  // cross-site navigation into a frame, and Chrome withholds SameSite=Lax cookies on
  // those — so getUser() sees no session here even though the user is signed in. Gating
  // it would bounce the iframe to /login and render the login page inside the checkout
  // modal. The page itself holds no data; it only breaks out to the top window, and that
  // top-level navigation does carry the cookies.
  const isPublicRoute =
    publicRoutes.includes(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith("/audit") ||
    request.nextUrl.pathname.startsWith("/billing/return") ||
    request.nextUrl.pathname.startsWith("/auth/");

  if (!user && !isPublicRoute) {
    return redirectTo("/login");
  }

  // Redirect authenticated but unverified users to verify-email page
  // (Supabase sets email_confirmed_at when user verifies their email)
  if (
    user &&
    !user.email_confirmed_at &&
    request.nextUrl.pathname !== "/verify-email" &&
    !isPublicRoute
  ) {
    return redirectTo("/verify-email");
  }

  // Redirect verified users away from verify-email page
  if (user && user.email_confirmed_at && request.nextUrl.pathname === "/verify-email") {
    return redirectTo("/settings");
  }

  // Redirect authenticated users away from login/signup to dashboard
  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    return redirectTo("/");
  }

  return supabaseResponse;
}
