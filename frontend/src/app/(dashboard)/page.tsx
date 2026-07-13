"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPut } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { DashboardSkeleton } from "./Skeleton";
import { usePlan } from "./PlanContext";

interface Stats {
  totalLeads: number;
  totalCampaigns: number;
  emailsSent: number;
  totalEmails: number;
  emailsFailed: number;
  repliesReceived: number;
  replyRate: string;
  avgLeadScore: number;
  callLeads: number;
  sentToday: number;
  weeklyLeads: number[];
  weeklyEmails: number[];
  weeklyLabels: string[];
  dailySendLimit: number;
  plan: string;
  planLabel: string;
  priceMonthly: number;
  maxDailyEmails: number;
  warmupDay: number;
  warmupComplete: boolean;
  warmupWeek: number;
  warmupPaused: boolean;
  leadsFoundThisMonth: number;
  monthlyLeadFindLimit: number;
  leadsFoundToday: number;
  dailyLeadFindLimit: number;
  subscriptionStatus: string;
  isOnTrial: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number;
  features: {
    hotLeadTracking: boolean;
    csvUpload: boolean;
    auditReports: boolean;
    prioritySupport: boolean;
  };
}

interface AuditView {
  id: string;
  lead_id: string;
  device: string;
  viewed_at: string;
}

interface AuditViewsResponse {
  views: AuditView[];
  leads: Record<string, { company: string; campaign_id: string }>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalLeads: 0, totalCampaigns: 0, emailsSent: 0, totalEmails: 0,
    emailsFailed: 0, repliesReceived: 0, replyRate: "0.0%", avgLeadScore: 0,
    callLeads: 0, sentToday: 0,
    weeklyLeads: [0, 0, 0, 0, 0, 0, 0], weeklyEmails: [0, 0, 0, 0, 0, 0, 0],
    weeklyLabels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Today"],
    dailySendLimit: 0,
    plan: "starter", planLabel: "Starter", priceMonthly: 39,
    maxDailyEmails: 50, warmupDay: 0, warmupComplete: false, warmupWeek: 0, warmupPaused: false,
    leadsFoundThisMonth: 0, monthlyLeadFindLimit: 100,
    leadsFoundToday: 0, dailyLeadFindLimit: 50,
    subscriptionStatus: "trialing", isOnTrial: true, trialEndsAt: null, trialDaysLeft: 7,
    features: { hotLeadTracking: true, csvUpload: true, auditReports: true, prioritySupport: true },
  });
  const [displayName, setDisplayName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [auditViews, setAuditViews] = useState<AuditViewsResponse>({ views: [], leads: {} });
  const [onboarding, setOnboarding] = useState<{ hasProfile: boolean; hasEmail: boolean; hasServiceType: boolean; hasLeads: boolean } | null>(null);
  const router = useRouter();
  const plan = usePlan();

  // Early redirect: if PlanContext already knows status is "none", go to settings immediately
  useEffect(() => {
    if (plan.loaded && plan.subscriptionStatus === "none") {
      router.push("/settings");
    }
  }, [plan.loaded, plan.subscriptionStatus, router]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        setDisplayName(user?.user_metadata?.full_name || user?.email || "");

        // Check if onboarding already dismissed
        const onboardingDone = user?.user_metadata?.onboarding_completed === true;

        const data = await apiGet<Stats & { serviceType?: string }>("/stats");
        setStats(data);

        // Redirect brand-new users (no plan selected) to settings to complete setup
        if (data.subscriptionStatus === "none") {
          router.push("/settings");
          return;
        }

        // Determine onboarding state (only if not dismissed)
        if (!onboardingDone) {
          const hasProfile = !!(user?.user_metadata?.full_name);
          const hasEmail = (data.warmupDay || 0) > 0 || (data.dailySendLimit || 0) > 0;
          const hasServiceType = !!(data.serviceType && data.serviceType !== "web_dev") || !!(user?.user_metadata?.service_type_set);
          const hasLeads = (data.totalLeads || 0) > 0;

          const allDone = hasProfile && hasEmail && hasServiceType && hasLeads;
          if (allDone) {
            // Mark onboarding as complete permanently
            await supabase.auth.updateUser({ data: { onboarding_completed: true } });
            setOnboarding(null);
          } else {
            setOnboarding({ hasProfile, hasEmail, hasServiceType, hasLeads });
          }
        }

        // Fetch recent audit views (fire-and-forget, non-blocking)
        apiGet<AuditViewsResponse>("/audit/views/recent")
          .then(vd => setAuditViews(vd))
          .catch(() => {});

        // Sync browser timezone to backend (fire-and-forget)
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) apiPut("/stats/timezone", { timezone: tz }).catch(() => {});
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const v = (val: number | string) => loading ? "—" : val;

  // Real last-7-days activity from the backend (index 6 = today)
  const leadSpark = stats.weeklyLeads;
  const emailSpark = stats.weeklyEmails;

  const leadPct = stats.dailyLeadFindLimit > 0 ? Math.round((stats.leadsFoundToday / stats.dailyLeadFindLimit) * 100) : 0;
  const monthPct = stats.monthlyLeadFindLimit > 0 ? Math.round((stats.leadsFoundThisMonth / stats.monthlyLeadFindLimit) * 100) : 0;

  if (loading) return <DashboardSkeleton />;

  return (
    <div>
      {/* Welcome Header */}
      <div className="relative overflow-hidden rounded-2xl p-8 mb-6" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #2a2158 100%)" }}>
        <div className="absolute inset-0">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl" style={{ background: "rgba(105,98,196,0.15)" }} />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full blur-3xl" style={{ background: "rgba(167,139,250,0.1)" }} />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-sm font-medium" style={{ color: "#a78bfa" }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <h1 className="text-3xl font-bold text-white mt-1">
              Welcome back, {displayName.split(" ")[0]} 👋
            </h1>
            <div className="flex items-center gap-3 mt-3">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "rgba(105,98,196,0.2)", color: "#c4b5fd", boxShadow: "inset 0 0 0 1px rgba(105,98,196,0.4)" }}>
                {stats.isOnTrial ? "Free Trial" : `${stats.planLabel} Plan`}
              </span>
              {stats.isOnTrial && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium" style={{ background: stats.trialDaysLeft <= 2 ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)", color: stats.trialDaysLeft <= 2 ? "#fca5a5" : "#34d399", boxShadow: `inset 0 0 0 1px ${stats.trialDaysLeft <= 2 ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}` }}>
                  ⏱ {stats.trialDaysLeft} day{stats.trialDaysLeft !== 1 ? "s" : ""} left
                </span>
              )}
              {!stats.warmupComplete && (stats.warmupDay > 0 || stats.warmupPaused) && (
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium" style={{ background: stats.warmupPaused ? "rgba(148,163,184,0.15)" : "rgba(245,158,11,0.15)", color: stats.warmupPaused ? "#94a3b8" : "#fbbf24", boxShadow: `inset 0 0 0 1px ${stats.warmupPaused ? "rgba(148,163,184,0.3)" : "rgba(245,158,11,0.3)"}` }}>
                  {stats.warmupPaused ? "⏸" : "⏳"} Warmup · Day {stats.warmupDay}/21
                  <span className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: stats.warmupPaused ? "rgba(148,163,184,0.3)" : "rgba(245,158,11,0.3)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (stats.warmupDay / 21) * 100)}%`, background: stats.warmupPaused ? "#94a3b8" : "#fbbf24" }} />
                  </span>
                </span>
              )}
              {stats.warmupComplete && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", boxShadow: "inset 0 0 0 1px rgba(16,185,129,0.3)" }}>
                  ✓ Warmup Complete
                </span>
              )}
            </div>
          </div>
          {/* Mini summary */}
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-white">{v(stats.totalLeads)}</p>
              <p className="text-xs" style={{ color: "#94a3b8" }}>Total Leads</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-white">{v(stats.totalCampaigns)}</p>
              <p className="text-xs" style={{ color: "#94a3b8" }}>Campaigns</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: "#34d399" }}>{v(stats.replyRate)}</p>
              <p className="text-xs" style={{ color: "#94a3b8" }}>Reply Rate</p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-rose-50 border border-rose-200 rounded-xl p-4">
          <p className="text-sm text-rose-600">Failed to load dashboard stats. Please refresh.</p>
        </div>
      )}



      {/* Onboarding Checklist */}
      {onboarding && (
        <div className="mb-6 bg-gradient-to-br from-indigo-50 via-white to-violet-50 rounded-2xl border-2 border-indigo-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Get Started</h2>
              <p className="text-sm text-gray-500 mt-0.5">Complete these steps to start generating leads and sending emails</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-indigo-600">
                {[onboarding.hasProfile, onboarding.hasEmail, onboarding.hasServiceType, onboarding.hasLeads].filter(Boolean).length}/4
              </span>
              <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-700"
                  style={{ width: `${([onboarding.hasProfile, onboarding.hasEmail, onboarding.hasServiceType, onboarding.hasLeads].filter(Boolean).length / 4) * 100}%` }}
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Step 1: Profile */}
            <button
              onClick={() => router.push("/settings")}
              className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                onboarding.hasProfile
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              {onboarding.hasProfile && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
              )}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${onboarding.hasProfile ? "bg-emerald-100" : "bg-indigo-100"}`}>
                <svg className={`w-4 h-4 ${onboarding.hasProfile ? "text-emerald-600" : "text-indigo-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-900">Complete Profile</p>
              <p className="text-xs text-gray-500 mt-0.5">Add your name</p>
            </button>

            {/* Step 2: Email Account */}
            <button
              onClick={() => router.push("/settings")}
              className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                onboarding.hasEmail
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              {onboarding.hasEmail && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
              )}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${onboarding.hasEmail ? "bg-emerald-100" : "bg-indigo-100"}`}>
                <svg className={`w-4 h-4 ${onboarding.hasEmail ? "text-emerald-600" : "text-indigo-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-900">Connect Email</p>
              <p className="text-xs text-gray-500 mt-0.5">Gmail or SMTP</p>
            </button>

            {/* Step 3: Service Type */}
            <button
              onClick={() => router.push("/settings")}
              className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                onboarding.hasServiceType
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              {onboarding.hasServiceType && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
              )}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${onboarding.hasServiceType ? "bg-emerald-100" : "bg-indigo-100"}`}>
                <svg className={`w-4 h-4 ${onboarding.hasServiceType ? "text-emerald-600" : "text-indigo-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-900">Select Service</p>
              <p className="text-xs text-gray-500 mt-0.5">SEO, Web Dev, etc.</p>
            </button>

            {/* Step 4: Find Leads */}
            <button
              onClick={() => router.push("/auto-leads")}
              className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                onboarding.hasLeads
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              {onboarding.hasLeads && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
              )}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${onboarding.hasLeads ? "bg-emerald-100" : "bg-indigo-100"}`}>
                <svg className={`w-4 h-4 ${onboarding.hasLeads ? "text-emerald-600" : "text-indigo-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-900">Find Leads</p>
              <p className="text-xs text-gray-500 mt-0.5">Auto-find businesses</p>
            </button>
          </div>
        </div>
      )}

      {/* Dashboard content — hidden until onboarding is complete */}
      {onboarding ? (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-amber-900">Complete the setup to unlock your dashboard</h3>
          <p className="text-sm text-amber-700 mt-1">Finish the steps above to start finding leads, generating emails, and tracking your outreach.</p>
        </div>
      ) : (
      <>

      {/* ── Key Metrics ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">

        {/* Leads Found Today */}
        <div className="group relative rounded-2xl p-[1.5px] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-indigo-200/60" style={{ background: "linear-gradient(135deg, #818cf8, #c7d2fe, #818cf8)", boxShadow: "0 2px 12px rgba(99,102,241,0.10)" }}>
          <div className="relative rounded-[14.5px] p-5 h-full overflow-hidden" style={{ background: "linear-gradient(135deg, #ffffff 0%, #fafaff 100%)" }}>
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-80 transition-all duration-700" style={{ background: "radial-gradient(circle, rgba(99,102,241,0.18), transparent 70%)" }} />
            <div className="absolute top-0 left-0 w-1.5 h-full rounded-l-[14.5px]" style={{ background: "linear-gradient(180deg, #4f46e5, #818cf8)" }} />
            <div className="relative pl-3">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #4f46e5, #818cf8)", boxShadow: "0 4px 14px rgba(99,102,241,0.35)" }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <span className="text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full" style={{ background: leadPct >= 80 ? "linear-gradient(135deg, #fef2f2, #fee2e2)" : leadPct >= 50 ? "linear-gradient(135deg, #fffbeb, #fef3c7)" : "linear-gradient(135deg, #f0fdf4, #dcfce7)", color: leadPct >= 80 ? "#dc2626" : leadPct >= 50 ? "#d97706" : "#16a34a" }}>
                  {leadPct}%
                </span>
              </div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Leads Today</p>
              <p className="text-3xl font-black text-gray-900 tracking-tight leading-none">{v(stats.leadsFoundToday)}<span className="text-sm font-medium text-gray-300 ml-1">/ {v(stats.dailyLeadFindLimit)}</span></p>
              <div className="mt-4 w-full rounded-full h-2 overflow-hidden" style={{ background: "linear-gradient(90deg, #eef2ff, #f5f3ff)" }}>
                <div className="h-2 rounded-full transition-all duration-1000 ease-out" style={{ width: `${leadPct}%`, background: "linear-gradient(90deg, #4f46e5, #a5b4fc)" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Emails Sent */}
        <div className="group relative rounded-2xl p-[1.5px] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-emerald-200/60" style={{ background: "linear-gradient(135deg, #34d399, #a7f3d0, #34d399)", boxShadow: "0 2px 12px rgba(16,185,129,0.10)" }}>
          <div className="relative rounded-[14.5px] p-5 h-full overflow-hidden" style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fdfb 100%)" }}>
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-80 transition-all duration-700" style={{ background: "radial-gradient(circle, rgba(16,185,129,0.18), transparent 70%)" }} />
            <div className="absolute top-0 left-0 w-1.5 h-full rounded-l-[14.5px]" style={{ background: "linear-gradient(180deg, #059669, #34d399)" }} />
            <div className="relative pl-3">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #059669, #34d399)", boxShadow: "0 4px 14px rgba(16,185,129,0.35)" }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full" style={{ background: "linear-gradient(135deg, #ecfdf5, #d1fae5)", color: "#059669" }}>
                  {v(stats.sentToday)} today
                </span>
              </div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Emails Sent</p>
              <p className="text-3xl font-black text-gray-900 tracking-tight leading-none">{v(stats.emailsSent)}</p>
              {stats.dailySendLimit > 0 && (
                <div className="mt-4 w-full rounded-full h-2 overflow-hidden" style={{ background: "linear-gradient(90deg, #ecfdf5, #f0fdf4)" }}>
                  <div className="h-2 rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${Math.min(100, (stats.sentToday / stats.dailySendLimit) * 100)}%`, background: "linear-gradient(90deg, #059669, #6ee7b7)" }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Reply Rate */}
        <div className="group relative rounded-2xl p-[1.5px] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-violet-200/60" style={{ background: "linear-gradient(135deg, #a78bfa, #ddd6fe, #a78bfa)", boxShadow: "0 2px 12px rgba(139,92,246,0.10)" }}>
          <div className="relative rounded-[14.5px] p-5 h-full overflow-hidden" style={{ background: "linear-gradient(135deg, #ffffff 0%, #fbfaff 100%)" }}>
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-80 transition-all duration-700" style={{ background: "radial-gradient(circle, rgba(139,92,246,0.18), transparent 70%)" }} />
            <div className="absolute top-0 left-0 w-1.5 h-full rounded-l-[14.5px]" style={{ background: "linear-gradient(180deg, #7c3aed, #a78bfa)" }} />
            <div className="relative pl-3">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7c3aed, #a78bfa)", boxShadow: "0 4px 14px rgba(139,92,246,0.35)" }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                </div>
                <span className={`text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full`}
                  style={{ background: parseFloat(stats.replyRate) >= 5 ? "linear-gradient(135deg, #f0fdf4, #dcfce7)" : "linear-gradient(135deg, #fffbeb, #fef3c7)", color: parseFloat(stats.replyRate) >= 5 ? "#16a34a" : "#d97706" }}>
                  {parseFloat(stats.replyRate) >= 5 ? "↑ Good" : "→ Avg"}
                </span>
              </div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Reply Rate</p>
              <p className="text-3xl font-black text-gray-900 tracking-tight leading-none">{v(stats.replyRate)}</p>
              <p className="text-xs text-gray-400 mt-2">{v(stats.repliesReceived)} replies received</p>
            </div>
          </div>
        </div>

        {/* Lead Quality */}
        <div className="group relative rounded-2xl p-[1.5px] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-amber-200/60" style={{ background: "linear-gradient(135deg, #fbbf24, #fde68a, #fbbf24)", boxShadow: "0 2px 12px rgba(245,158,11,0.10)" }}>
          <div className="relative rounded-[14.5px] p-5 h-full overflow-hidden" style={{ background: "linear-gradient(135deg, #ffffff 0%, #fffef8 100%)" }}>
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-80 transition-all duration-700" style={{ background: "radial-gradient(circle, rgba(245,158,11,0.18), transparent 70%)" }} />
            <div className="absolute top-0 left-0 w-1.5 h-full rounded-l-[14.5px]" style={{ background: "linear-gradient(180deg, #d97706, #fbbf24)" }} />
            <div className="relative pl-3">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #d97706, #fbbf24)", boxShadow: "0 4px 14px rgba(245,158,11,0.35)" }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <span className="text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full"
                  style={{ background: stats.avgLeadScore >= 70 ? "linear-gradient(135deg, #f0fdf4, #dcfce7)" : stats.avgLeadScore >= 40 ? "linear-gradient(135deg, #fffbeb, #fef3c7)" : "linear-gradient(135deg, #fef2f2, #fee2e2)", color: stats.avgLeadScore >= 70 ? "#16a34a" : stats.avgLeadScore >= 40 ? "#d97706" : "#dc2626" }}>
                  {stats.avgLeadScore >= 70 ? "Excellent" : stats.avgLeadScore >= 40 ? "Good" : "Low"}
                </span>
              </div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Lead Score</p>
              <p className="text-3xl font-black text-gray-900 tracking-tight leading-none">{v(stats.avgLeadScore)}<span className="text-sm font-medium text-gray-300 ml-0.5">/100</span></p>
              <p className="text-xs text-gray-400 mt-2">avg quality score</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Activity + Account Overview ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-8">

        {/* 7-Day Activity Chart */}
        <div className="lg:col-span-3 relative rounded-2xl p-[1.5px] overflow-hidden" style={{ background: "linear-gradient(135deg, #818cf8, #c7d2fe, #a78bfa)", boxShadow: "0 2px 12px rgba(99,102,241,0.10)" }}>
          <div className="relative rounded-[14.5px] p-6 h-full" style={{ background: "linear-gradient(180deg, #ffffff 0%, #fafaff 100%)" }}>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-base font-extrabold text-gray-900 tracking-tight">Weekly Overview</h3>
                <p className="text-xs text-gray-400 mt-0.5">Your outreach activity this week</p>
              </div>
              <div className="flex items-center gap-5">
                <span className="flex items-center gap-2 text-[11px] font-medium text-gray-500">
                  <span className="w-3 h-3 rounded" style={{ background: "linear-gradient(135deg, #6366f1, #818cf8)" }}></span>Leads
                </span>
                <span className="flex items-center gap-2 text-[11px] font-medium text-gray-500">
                  <span className="w-3 h-3 rounded" style={{ background: "linear-gradient(135deg, #10b981, #34d399)" }}></span>Emails
                </span>
              </div>
            </div>
            {/* Grid lines */}
            <div className="relative">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ height: "10rem" }}>
                {[0, 1, 2, 3].map((l) => (
                  <div key={l} className="w-full border-b border-dashed" style={{ borderColor: "rgba(99,102,241,0.06)" }} />
                ))}
              </div>
              <div className="flex items-end gap-2.5 h-40 px-1 relative z-10">
                {leadSpark.map((lead, i) => {
                  const email = emailSpark[i] || 0;
                  const maxH = Math.max(...leadSpark, ...emailSpark, 1);
                  const isToday = i === leadSpark.length - 1;
                  return (
                    <div key={i} className="flex-1 flex items-end gap-1 h-full">
                      <div className={`flex-1 rounded-lg cursor-default relative group transition-all duration-500`}
                        style={{ height: `${Math.max(8, (lead / maxH) * 100)}%`, background: isToday ? "linear-gradient(180deg, #4338ca, #6366f1)" : "linear-gradient(180deg, #a5b4fc, #c7d2fe)", boxShadow: isToday ? "0 4px 14px rgba(99,102,241,0.35)" : "0 2px 6px rgba(99,102,241,0.08)", borderRadius: "8px 8px 4px 4px" }}>
                        <div className="absolute -top-9 left-1/2 -translate-x-1/2 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all whitespace-nowrap z-20" style={{ background: "linear-gradient(135deg, #1e1b4b, #312e81)", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>{lead}
                          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-[#312e81]"></div>
                        </div>
                      </div>
                      <div className={`flex-1 rounded-lg cursor-default relative group transition-all duration-500`}
                        style={{ height: `${Math.max(8, (email / maxH) * 100)}%`, background: isToday ? "linear-gradient(180deg, #047857, #10b981)" : "linear-gradient(180deg, #6ee7b7, #a7f3d0)", boxShadow: isToday ? "0 4px 14px rgba(16,185,129,0.35)" : "0 2px 6px rgba(16,185,129,0.08)", borderRadius: "8px 8px 4px 4px" }}>
                        <div className="absolute -top-9 left-1/2 -translate-x-1/2 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all whitespace-nowrap z-20" style={{ background: "linear-gradient(135deg, #064e3b, #065f46)", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>{email}
                          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-[#065f46]"></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-between mt-4 px-1">
              {stats.weeklyLabels.map((d, i) => (
                <span key={i} className={`text-[11px] flex-1 text-center font-medium ${i === 6 ? "font-bold text-indigo-600" : "text-gray-400"}`}>{d}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Account Overview */}
        <div className="lg:col-span-2 relative rounded-2xl p-[1.5px]" style={{ background: "linear-gradient(135deg, #818cf8, #c7d2fe, #a78bfa)", boxShadow: "0 2px 12px rgba(99,102,241,0.10)" }}>
          <div className="rounded-[14.5px] p-6 h-full" style={{ background: "linear-gradient(180deg, #ffffff 0%, #fafaff 100%)" }}>
            <h3 className="text-base font-extrabold text-gray-900 tracking-tight mb-6">Account Overview</h3>
            <div className="space-y-5">
              {/* Monthly usage */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold text-gray-500">Monthly leads</span>
                  <span className="text-xs font-extrabold text-gray-900">{v(stats.leadsFoundThisMonth)} <span className="font-normal text-gray-400">/ {v(stats.monthlyLeadFindLimit)}</span></span>
                </div>
                <div className="w-full rounded-full h-2.5 overflow-hidden" style={{ background: "linear-gradient(90deg, #eef2ff, #f5f3ff)" }}>
                  <div className="h-2.5 rounded-full transition-all duration-1000 ease-out" style={{ width: `${monthPct}%`, background: "linear-gradient(90deg, #4f46e5, #a5b4fc)" }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">{v(stats.monthlyLeadFindLimit - stats.leadsFoundThisMonth)} remaining this month</p>
              </div>
              {/* Daily send */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold text-gray-500">Daily email limit</span>
                  <span className="text-xs font-extrabold text-gray-900">{v(stats.sentToday)} <span className="font-normal text-gray-400">/ {v(stats.dailySendLimit)}</span></span>
                </div>
                <div className="w-full rounded-full h-2.5 overflow-hidden" style={{ background: "linear-gradient(90deg, #ecfdf5, #f0fdf4)" }}>
                  <div className="h-2.5 rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${stats.dailySendLimit > 0 ? Math.min(100, (stats.sentToday / stats.dailySendLimit) * 100) : 0}%`, background: "linear-gradient(90deg, #059669, #6ee7b7)" }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">{v(stats.dailySendLimit - stats.sentToday)} sends remaining today</p>
              </div>
              {/* Stats Grid */}
              <div className="pt-4" style={{ borderTop: "1px solid #eef2ff" }}>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="text-center p-3 rounded-xl" style={{ background: "linear-gradient(145deg, #eef2ff, #e0e7ff)", boxShadow: "inset 0 1px 2px rgba(99,102,241,0.06)" }}>
                    <p className="text-lg font-black text-gray-900">{v(stats.totalCampaigns)}</p>
                    <p className="text-[10px] font-semibold text-indigo-500 mt-0.5">Campaigns</p>
                  </div>
                  <div className="text-center p-3 rounded-xl" style={{ background: "linear-gradient(145deg, #ecfdf5, #d1fae5)", boxShadow: "inset 0 1px 2px rgba(16,185,129,0.06)" }}>
                    <p className="text-lg font-black text-gray-900">{v(stats.callLeads)}</p>
                    <p className="text-[10px] font-semibold text-emerald-500 mt-0.5">Call-ready</p>
                  </div>
                  <div className="text-center p-3 rounded-xl" style={{ background: stats.emailsFailed > 0 ? "linear-gradient(145deg, #fef2f2, #fee2e2)" : "linear-gradient(145deg, #f9fafb, #f3f4f6)", boxShadow: stats.emailsFailed > 0 ? "inset 0 1px 2px rgba(244,63,94,0.06)" : "inset 0 1px 2px rgba(0,0,0,0.02)" }}>
                    <p className={`text-lg font-black ${stats.emailsFailed > 0 ? "text-rose-600" : "text-gray-900"}`}>{v(stats.emailsFailed)}</p>
                    <p className={`text-[10px] font-semibold mt-0.5 ${stats.emailsFailed > 0 ? "text-rose-500" : "text-gray-400"}`}>Failed</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <button onClick={() => router.push("/auto-leads")} className="group relative rounded-2xl p-[1.5px] text-left transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-indigo-200/60 overflow-hidden" style={{ background: "linear-gradient(135deg, #818cf8, #c7d2fe, #818cf8)", boxShadow: "0 2px 12px rgba(99,102,241,0.10)" }}>
          <div className="relative rounded-[14.5px] p-6 h-full overflow-hidden" style={{ background: "linear-gradient(135deg, #ffffff 0%, #fafaff 100%)" }}>
            <div className="absolute -right-8 -bottom-8 w-36 h-36 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-700 blur-3xl" style={{ background: "radial-gradient(circle, rgba(99,102,241,0.22), transparent 70%)" }} />
            <div className="relative">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: "linear-gradient(135deg, #4f46e5, #818cf8)", boxShadow: "0 4px 14px rgba(99,102,241,0.35)" }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <p className="text-sm font-extrabold text-gray-900 tracking-tight">Find New Leads</p>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">Auto-discover businesses in any niche & location</p>
              <div className="mt-5 inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg text-white transition-all group-hover:gap-3 group-hover:shadow-lg group-hover:shadow-indigo-300/50" style={{ background: "linear-gradient(135deg, #4f46e5, #818cf8)", boxShadow: "0 2px 8px rgba(99,102,241,0.25)" }}>
                <span>Get started</span>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
              </div>
            </div>
          </div>
        </button>
        <button onClick={() => router.push("/campaigns")} className="group relative rounded-2xl p-[1.5px] text-left transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-emerald-200/60 overflow-hidden" style={{ background: "linear-gradient(135deg, #34d399, #a7f3d0, #34d399)", boxShadow: "0 2px 12px rgba(16,185,129,0.10)" }}>
          <div className="relative rounded-[14.5px] p-6 h-full overflow-hidden" style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fdfb 100%)" }}>
            <div className="absolute -right-8 -bottom-8 w-36 h-36 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-700 blur-3xl" style={{ background: "radial-gradient(circle, rgba(16,185,129,0.22), transparent 70%)" }} />
            <div className="relative">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: "linear-gradient(135deg, #059669, #34d399)", boxShadow: "0 4px 14px rgba(16,185,129,0.35)" }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-extrabold text-gray-900 tracking-tight">View Campaigns</p>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">Manage sequences, track opens & replies</p>
              <div className="mt-5 inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg text-white transition-all group-hover:gap-3 group-hover:shadow-lg group-hover:shadow-emerald-300/50" style={{ background: "linear-gradient(135deg, #059669, #34d399)", boxShadow: "0 2px 8px rgba(16,185,129,0.25)" }}>
                <span>View all</span>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
              </div>
            </div>
          </div>
        </button>
        <button onClick={() => router.push("/hot-leads")} className="group relative rounded-2xl p-[1.5px] text-left transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-amber-200/60 overflow-hidden" style={{ background: "linear-gradient(135deg, #fbbf24, #fde68a, #fbbf24)", boxShadow: "0 2px 12px rgba(245,158,11,0.10)" }}>
          <div className="relative rounded-[14.5px] p-6 h-full overflow-hidden" style={{ background: "linear-gradient(135deg, #ffffff 0%, #fffef8 100%)" }}>
            <div className="absolute -right-8 -bottom-8 w-36 h-36 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-700 blur-3xl" style={{ background: "radial-gradient(circle, rgba(245,158,11,0.22), transparent 70%)" }} />
            <div className="relative">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: "linear-gradient(135deg, #d97706, #fbbf24)", boxShadow: "0 4px 14px rgba(245,158,11,0.35)" }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                </svg>
              </div>
              <p className="text-sm font-extrabold text-gray-900 tracking-tight">Hot Leads</p>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">Leads that viewed your audit report page</p>
              <div className="mt-5 inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg text-white transition-all group-hover:gap-3 group-hover:shadow-lg group-hover:shadow-amber-300/50" style={{ background: "linear-gradient(135deg, #d97706, #fbbf24)", boxShadow: "0 2px 8px rgba(245,158,11,0.25)" }}>
                <span>Check now</span>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
              </div>
            </div>
          </div>
        </button>
      </div>
      </>
      )}
    </div>
  );
}
