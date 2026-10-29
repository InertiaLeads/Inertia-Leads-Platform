"use client";

import { useRouter } from "next/navigation";

// Compact, in-page version of FeatureGate: same look (dark card, lock, "Available on Growth &
// Agency plans", Upgrade button) for features that live INSIDE a page — the dashboard
// Engagement card and the campaign Smart Sequences panel — rather than owning a whole page.
export default function UpgradeLock({ title, description }: { title: string; description: string }) {
  const router = useRouter();
  return (
    <div
      className="rounded-2xl p-5 flex flex-col items-start gap-3 h-full"
      style={{ background: "linear-gradient(145deg, #1a1540 0%, #2d2660 50%, #3d3580 100%)", border: "1px solid rgba(105,98,196,0.35)", boxShadow: "0 10px 30px rgba(13,10,37,0.25)" }}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(105,98,196,0.2)", border: "1px solid rgba(105,98,196,0.3)" }}>
          <svg className="w-5 h-5" style={{ color: "#a78bfa" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="text-xs text-gray-400 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium" style={{ background: "rgba(105,98,196,0.15)", color: "#c4b5fd", border: "1px solid rgba(105,98,196,0.35)" }}>
          Available on Growth &amp; Agency plans
        </span>
        <button
          onClick={() => router.push("/settings")}
          className="px-4 py-1.5 text-xs font-bold rounded-lg text-white transition-all hover:scale-[1.03]"
          style={{ background: "linear-gradient(135deg, #6962c4 0%, #8b5cf6 100%)", boxShadow: "0 4px 14px rgba(139,92,246,0.35)" }}
        >
          Upgrade Plan
        </button>
      </div>
    </div>
  );
}
