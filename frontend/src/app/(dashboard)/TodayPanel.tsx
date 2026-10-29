"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { usePlan } from "./PlanContext";
import UpgradeLock from "./UpgradeLock";

// =============================================
// Dashboard → "Engagement" card (V2 Tier 1)
// =============================================
// One compact, fixed-size card with three numbers: replies, audit-report clicks, email
// opens. All-time total as the headline, today's movement underneath. Takes one third of
// the row so the rest of the dashboard stays free for future features.

interface Engagement {
  replies: { total: number; today: number };
  clicks: { total: number; today: number };
  opens: { total: number; today: number };
}

export default function TodayPanel() {
  const plan = usePlan();
  const enabled = plan.loaded && plan.canAccessFeatures && plan.features.emailTracking;
  const [data, setData] = useState<Engagement | null>(null);

  useEffect(() => {
    if (!enabled) return; // Starter: engagement tracking is a Growth+ feature
    let cancelled = false;
    const load = () => apiGet<Engagement>("/stats/engagement").then((d) => { if (!cancelled) setData(d); }).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  const rows = [
    {
      label: "Replies",
      hint: "Emails a lead replied to",
      value: data?.replies,
      color: "#4f46e5",
      bg: "linear-gradient(135deg, #4f46e5, #818cf8)",
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />,
    },
    {
      label: "Audit clicks",
      hint: "Leads opening their audit report",
      value: data?.clicks,
      color: "#047857",
      bg: "linear-gradient(135deg, #059669, #34d399)",
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />,
    },
    {
      label: "Email opens",
      hint: "Emails opened by leads",
      value: data?.opens,
      color: "#c2410c",
      bg: "linear-gradient(135deg, #ea580c, #fb923c)",
      icon: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>,
    },
  ];

  if (plan.loaded && !plan.features.emailTracking) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <UpgradeLock title="Engagement tracking" description="See who replied, who clicked their audit report and who opened your emails — at a glance." />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="relative rounded-2xl p-[1.5px]" style={{ background: "linear-gradient(135deg, #818cf8, #c7d2fe, #a78bfa)", boxShadow: "0 2px 12px rgba(99,102,241,0.10)" }}>
        <div className="relative rounded-[14.5px] p-5 h-full" style={{ background: "linear-gradient(135deg, #ffffff 0%, #fafaff 100%)" }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Engagement</p>
            <span className="text-[10px] text-gray-400">all time · today</span>
          </div>

          <div className="space-y-2.5">
            {rows.map((r) => (
              <div
                key={r.label}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                style={{ background: "rgba(47,39,108,0.035)", border: "1px solid rgba(47,39,108,0.08)" }}
              >
                <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: r.bg }}>
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">{r.icon}</svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-gray-900">{r.label}</span>
                  <span className="block text-[10px] text-gray-400 truncate">{r.hint}</span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-xl font-black tracking-tight leading-none" style={{ color: r.color }}>
                    {data ? r.value?.total ?? 0 : <span className="inline-block w-8 h-5 rounded bg-gray-200 animate-pulse" />}
                  </span>
                  <span className="block text-[10px] font-semibold mt-0.5" style={{ color: data && (r.value?.today ?? 0) > 0 ? r.color : "#9ca3af" }}>
                    {data ? `+${r.value?.today ?? 0} today` : ""}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Two remaining columns intentionally empty — reserved for future dashboard cards. */}
    </div>
  );
}
