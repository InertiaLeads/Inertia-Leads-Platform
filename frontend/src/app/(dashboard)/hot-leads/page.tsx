"use client";

import { useState, useEffect, useMemo } from "react";
import { apiGet } from "@/lib/api";
import { DashboardSkeleton } from "../Skeleton";
import Pagination from "../Pagination";
import Link from "next/link";
import FeatureGate from "../FeatureGate";
import { usePlan } from "../PlanContext";
import LockedFeatureModal from "../LockedFeatureModal";

const PER_PAGE = 20;

interface HotLead {
  id: string;
  name: string;
  email: string;
  company: string;
  website: string;
  phone: string;
  industry: string;
  score: number;
  contactMethod: string;
  contacted: boolean;
  campaignId: string;
  campaignName: string;
  replied: boolean;
  totalViews: number;
  firstViewed: string;
  lastViewed: string;
  devices: string[];
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function getHeatLevel(totalViews: number): { label: string; color: string; bg: string; ring: string; icon: string } {
  if (totalViews >= 5) return { label: "Very Hot", color: "text-red-700", bg: "bg-red-50", ring: "ring-red-200", icon: "🔥🔥🔥" };
  if (totalViews >= 3) return { label: "Hot", color: "text-orange-700", bg: "bg-orange-50", ring: "ring-orange-200", icon: "🔥🔥" };
  return { label: "Warm", color: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200", icon: "🔥" };
}

export default function HotLeadsPage() {
  const plan = usePlan();
  const [hotLeads, setHotLeads] = useState<HotLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "replied" | "not-contacted">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"latest" | "most-viewed">("latest");
  const [page, setPage] = useState(1);

  useEffect(() => {
    // Only fetch hot leads data if plan is loaded and user has access
    if (!plan.loaded) return;
    if (!plan.features.hotLeadTracking) {
      setLoading(false);
      return;
    }
    apiGet<{ hotLeads: HotLead[] }>("/audit/hot-leads")
      .then((data) => setHotLeads(data.hotLeads))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [plan.loaded, plan.features.hotLeadTracking]);

  const filtered = useMemo(() => {
    let result = hotLeads;
    if (filter === "replied") result = result.filter(l => l.replied);
    else if (filter === "not-contacted") result = result.filter(l => !l.contacted && !l.replied);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        l.company.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.industry.toLowerCase().includes(q) ||
        l.campaignName.toLowerCase().includes(q)
      );
    }
    // Sort — copy first so we never mutate the source array. "latest" (default) puts the
    // most recently active leads on top (what a hot-leads action list should show first);
    // "most-viewed" ranks by all-time view count. Each falls back to the other as a tiebreaker.
    const byLatest = (a: HotLead, b: HotLead) => new Date(b.lastViewed).getTime() - new Date(a.lastViewed).getTime();
    const byViews = (a: HotLead, b: HotLead) => b.totalViews - a.totalViews;
    return [...result].sort((a, b) =>
      sort === "most-viewed" ? (byViews(a, b) || byLatest(a, b)) : (byLatest(a, b) || byViews(a, b))
    );
  }, [hotLeads, filter, search, sort]);

  const paginatedLeads = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Reset page when filter/search/sort changes
  useEffect(() => { setPage(1); }, [filter, search, sort]);

  // Show locked modal if user hasn't set up subscription
  if (plan.loaded && !plan.canAccessFeatures) {
    return <LockedFeatureModal />;
  }

  // Show FeatureGate immediately once plan is loaded and no access
  if (plan.loaded && !plan.features.hotLeadTracking) {
    return <FeatureGate featureName="Hot Lead Tracking" description="See which leads opened your audit reports and track their engagement. Identify your warmest prospects." requiredPlan="Growth" />;
  }

  if (!plan.loaded || loading) return <DashboardSkeleton />;

  const totalViews = hotLeads.reduce((sum, l) => sum + l.totalViews, 0);
  const repliedCount = hotLeads.filter((l) => l.replied).length;
  const multiViewCount = hotLeads.filter((l) => l.totalViews >= 2).length;

  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl p-8 md:p-10 mb-8" style={{ background: 'linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #2a2158 100%)' }}>
        <div className="absolute inset-0">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl" style={{ background: 'rgba(105, 98, 196, 0.12)' }} />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full blur-3xl" style={{ background: 'rgba(167, 139, 250, 0.10)' }} />
        </div>
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 mb-4">
            <svg className="w-4 h-4" style={{ color: '#c4b5fd' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
            </svg>
            <span className="text-xs font-medium text-gray-300">Engagement Tracker</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Hot Leads</h1>
          <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Leads who opened their audit report — newest activity first</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(47, 39, 108, 0.4)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
              <svg className="w-4 h-4" style={{ color: '#6962c4' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" /></svg>
            </div>
            <p className="text-xs font-semibold" style={{ color: '#3d3580' }}>Total Hot Leads</p>
          </div>
          <p className="text-3xl font-extrabold text-gray-900">{hotLeads.length}</p>
        </div>
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(47, 39, 108, 0.4)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
              <svg className="w-4 h-4" style={{ color: '#6962c4' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </div>
            <p className="text-xs font-semibold" style={{ color: '#3d3580' }}>Total Report Views</p>
          </div>
          <p className="text-3xl font-extrabold text-gray-900">{totalViews}</p>
        </div>
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(47, 39, 108, 0.4)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
              <svg className="w-4 h-4" style={{ color: '#6962c4' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </div>
            <p className="text-xs font-semibold" style={{ color: '#3d3580' }}>Viewed 2+ Times</p>
          </div>
          <p className="text-3xl font-extrabold text-gray-900">{multiViewCount}</p>
        </div>
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(47, 39, 108, 0.4)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
              <svg className="w-4 h-4" style={{ color: '#6962c4' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
            </div>
            <p className="text-xs font-semibold" style={{ color: '#3d3580' }}>Replied</p>
          </div>
          <p className="text-3xl font-extrabold text-gray-900">{repliedCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-6">
        {([
          { key: "all" as const, label: "All" },
          { key: "replied" as const, label: "Replied" },
          { key: "not-contacted" as const, label: "Not Contacted" },
        ]).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
              filter === f.key
                ? "text-white shadow-md"
                : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-700"
            }`}
            style={filter === f.key ? { background: 'linear-gradient(135deg, #3d3580, #6962c4)' } : undefined}
          >
            {f.label}
          </button>
        ))}
        <span className="text-sm text-gray-400 ml-3">{filtered.length} leads</span>
        <div className="ml-auto flex items-center gap-2">
          {/* Sort toggle — segmented control; "Latest" (most recent activity) is the default */}
          <div className="inline-flex items-center gap-1 rounded-full p-1 ring-1 ring-[#2f276c]/10" style={{ background: 'rgba(47, 39, 108, 0.06)' }}>
            {([
              { key: "latest" as const, label: "Latest", icon: (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              ) },
              { key: "most-viewed" as const, label: "Most viewed", icon: (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              ) },
            ]).map((s) => {
              const active = sort === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all duration-200 ${
                    active ? "text-white shadow-md" : "text-[#6b6790] hover:text-[#3d3580]"
                  }`}
                  style={active ? { background: 'linear-gradient(135deg, #3d3580, #6962c4)', boxShadow: '0 4px 12px rgba(105, 98, 196, 0.35)' } : undefined}
                >
                  {s.icon}
                  {s.label}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className="pl-9 pr-4 py-2 text-sm bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-[#6962c4]/20 focus:border-[#6962c4] w-64"
              style={{ border: '1px solid rgba(47, 39, 108, 0.3)' }}
            />
          </div>
        </div>
      </div>

      {/* Leads List */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
            <svg className="w-8 h-8" style={{ color: '#6962c4' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-gray-700">
            {hotLeads.length === 0 ? "No hot leads yet" : "No leads match this filter"}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {hotLeads.length === 0 ? "Leads will appear here when they open their audit report" : "Try a different filter"}
          </p>
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {paginatedLeads.map((lead) => {
            const heat = getHeatLevel(lead.totalViews);
            return (
              <div
                key={lead.id}
                className="bg-white rounded-2xl hover:shadow-md transition-all p-5"
                style={{ border: '1px solid rgba(47, 39, 108, 0.2)' }}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Lead info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-base font-bold text-gray-900 capitalize truncate">{lead.company}</h3>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-lg ring-1 ${heat.bg} ${heat.color} ${heat.ring}`}>
                        {heat.icon} {heat.label}
                      </span>
                      {lead.replied && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                          ✓ Replied
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                      {lead.industry && (
                        <span className="inline-flex items-center gap-1">
                          {lead.industry}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-gray-300" />
                        <Link href={`/campaigns/${lead.campaignId}`} className="hover:underline" style={{ color: '#6962c4' }}>
                          {lead.campaignName}
                        </Link>
                      </span>
                    </div>

                    {/* Contact info */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {lead.email && (
                        <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white rounded-lg transition-colors" style={{ background: '#2f276c' }}>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                          {lead.email}
                        </a>
                      )}
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white rounded-lg transition-colors" style={{ background: '#2f276c' }}>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                          {lead.phone}
                        </a>
                      )}
                      {lead.website && (
                        <a href={lead.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white rounded-lg transition-colors" style={{ background: '#2f276c' }}>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                          Website
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Right: View stats */}
                  <div className="flex-shrink-0 text-right">
                    <div className="flex items-center gap-2 justify-end mb-1.5">
                      <svg className="w-4 h-4" style={{ color: '#6962c4' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      <div className="w-10 h-10 rounded-lg grid place-items-center" style={{ background: '#2f276c' }}>
                        <span className="text-lg font-extrabold text-white" style={{ lineHeight: 1 }}>{lead.totalViews}</span>
                      </div>
                      <span className="text-xs text-gray-400">{lead.totalViews === 1 ? "view" : "views"}</span>
                    </div>
                    <p className="text-[11px] text-gray-400">Last viewed: {formatTimeAgo(lead.lastViewed)}</p>
                    <p className="text-[11px] text-gray-400">First viewed: {formatTimeAgo(lead.firstViewed)}</p>
                    {lead.score > 0 && (
                      <div className="mt-1.5">
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-bold rounded-lg ring-1 ${
                          lead.score >= 70 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" :
                          lead.score >= 40 ? "bg-amber-50 text-amber-700 ring-amber-200" :
                          "bg-gray-50 text-gray-600 ring-gray-200"
                        }`}>
                          Score: {lead.score}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {filtered.length > PER_PAGE && (
          <div className="mt-6">
            <Pagination
              currentPage={page}
              totalItems={filtered.length}
              perPage={PER_PAGE}
              onPageChange={setPage}
            />
          </div>
        )}
        </>
      )}
    </div>
  );
}
