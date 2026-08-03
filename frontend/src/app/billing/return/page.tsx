"use client";

import { useEffect } from "react";

// Landing page for Dodo's checkout `return_url`.
//
// This route MUST live outside the (dashboard) group and stay public. Dodo's checkout runs
// inside an iframe, and when it redirects back, that navigation is cross-site (Dodo's
// domain → ours) *inside a frame*. Chrome withholds SameSite=Lax cookies on cross-site
// frame navigations, so Supabase's auth cookies are not sent. Pointing return_url at any
// page under (dashboard) therefore fails its server-side auth check and renders /login
// inside the checkout modal.
//
// So this page carries no auth requirement and does exactly one thing: break out of the
// iframe into the top window. That top-level navigation DOES carry the auth cookies, so
// /settings loads signed-in as normal — and navigating the top window also tears down the
// checkout modal, which is what leaves the UI clean.
//
// Note Dodo uses this same URL for BOTH success and failure ("The url to redirect after
// payment failure or success"), and the exact query params it appends aren't contractual.
// So we don't decide the outcome here — we hand off to /settings, which verifies against
// real subscription state from the API.
export default function BillingReturnPage() {
  useEffect(() => {
    // Preserve whatever Dodo appended, purely so it's inspectable in the address bar;
    // /settings does not trust it for the success/failure decision.
    const incoming = new URLSearchParams(window.location.search);
    incoming.set("payment", "return");
    const target = `/settings?${incoming.toString()}`;

    // window.top is null/cross-origin-guarded in odd embedding cases — fall back to a
    // same-window navigation so the user is never stranded on this page.
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = target;
        return;
      }
    } catch {
      // Accessing window.top threw (unexpected embedding) — fall through.
    }
    window.location.href = target;
  }, []);

  return (
    // Plain WHITE, deliberately — this page renders INSIDE the checkout modal's iframe.
    // The modal container is white with horizontal padding, so a tinted background of our
    // own appeared as a coloured panel inset within white gutters: a visible seam (which is
    // what it looked like before). White matches the container so it reads as one surface.
    // Note `transparent` is wrong here: the root layout paints <body> dark navy, which would
    // show a dark block inside the white modal.
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-6 bg-white">
      <div className="flex items-end gap-[7px] h-20">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="w-[7px] rounded-full bg-gradient-to-t from-[#6962c4] to-[#a9a4e8]"
            style={{ animation: "barWave 1s ease-in-out infinite", animationDelay: `${i * 0.1}s`, height: "16px" }}
          />
        ))}
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-gray-700">Finishing up…</p>
        <p className="mt-2 text-sm text-gray-400">Returning you to Inertia Leads</p>
      </div>
      <style jsx>{`
        @keyframes barWave {
          0%, 100% { height: 16px; opacity: 0.4; }
          50% { height: 72px; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
