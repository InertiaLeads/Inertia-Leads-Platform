"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { apiPost, apiGet } from "@/lib/api";
import SearchBar from "../SearchBar";
import { SourcesTableSkeleton } from "../Skeleton";
import Pagination from "../Pagination";
import FeatureAccessGuard from "../FeatureAccessGuard";

interface LeadSource {
  id: string;
  niche: string;
  location: string;
  status: string;
  created_at: string;
  leadsCount?: number;
  campaignId?: string;
  campaignName?: string;
}

// ===== Progress Tracker =====
interface ProgressStep {
  label: string;
  delayMs: number;
}

function useProgressTracker(steps: ProgressStep[]) {
  const [currentStep, setCurrentStep] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  const start = useCallback(() => {
    setActive(true);
    setCurrentStep(0);
    setProgress(0);
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    let elapsed = 0;
    steps.forEach((step, i) => {
      elapsed += step.delayMs;
      const t = setTimeout(() => {
        setCurrentStep(i);
        setProgress(Math.min(90, ((i + 1) / steps.length) * 90));
      }, elapsed);
      timersRef.current.push(t);
    });
  }, [steps]);

  const finish = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setProgress(100);
    setTimeout(() => {
      setActive(false);
      setCurrentStep(-1);
      setProgress(0);
    }, 600);
  }, []);

  const cancel = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setActive(false);
    setCurrentStep(-1);
    setProgress(0);
  }, []);

  return { currentStep, progress, active, start, finish, cancel, steps };
}

function ProgressBar({ tracker }: { tracker: ReturnType<typeof useProgressTracker> }) {
  if (!tracker.active) return null;
  const step = tracker.currentStep >= 0 ? tracker.steps[tracker.currentStep] : null;

  return (
    <div className="rounded-xl px-4 py-2.5 flex items-center gap-3" style={{ background: "rgba(15,12,40,0.7)", border: "1px solid rgba(167,139,250,0.35)", boxShadow: "0 0 20px rgba(105,98,196,0.15), inset 0 1px 0 rgba(255,255,255,0.03)" }}>
      {/* Spinner */}
      <div className="w-10 h-10 relative flex-shrink-0">
        <svg className="w-10 h-10 animate-spin" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="16" stroke="rgba(167,139,250,0.2)" strokeWidth="3" />
          <path d="M20 4a16 16 0 0116 16" stroke="url(#spinGrad)" strokeWidth="3" strokeLinecap="round" />
          <defs><linearGradient id="spinGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#6962c4" /><stop offset="100%" stopColor="#c4b5fd" /></linearGradient></defs>
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold" style={{ color: "#c4b5fd" }}>
          {Math.round(tracker.progress)}%
        </span>
      </div>
      {/* Label + bar */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate mb-1" style={{ color: "#e2e0ff" }}>{step?.label || "Starting..."}</p>
        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(167,139,250,0.12)" }}>
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${tracker.progress}%`, background: "linear-gradient(90deg, #6962c4, #a78bfa, #c4b5fd)", boxShadow: "0 0 8px rgba(167,139,250,0.5)" }}
          />
        </div>
      </div>
    </div>
  );
}

const findLeadsSteps: ProgressStep[] = [
  { label: "Searching Google for businesses...", delayMs: 0 },
  { label: "Extracting business details...", delayMs: 3000 },
  { label: "Creating campaign and saving leads...", delayMs: 7000 },
  { label: "Almost done...", delayMs: 12000 },
];

// ===== Toast Notification System =====
type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

let toastIdCounter = 0;

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: number) => void }) {
  if (toasts.length === 0) return null;

  const styles: Record<ToastType, string> = {
    success: "bg-green-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-gray-800 text-white",
    warning: "bg-amber-500 text-white",
  };

  const icons: Record<ToastType, string> = {
    success: "✓",
    error: "✕",
    info: "ℹ",
    warning: "⚠",
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${styles[toast.type]} px-4 py-3 rounded-lg shadow-lg flex items-start gap-3 animate-slide-in text-sm`}
          role="alert"
        >
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
            {icons[toast.type]}
          </span>
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 text-white/70 hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>
      ))}
      <style jsx>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in {
          animation: slideIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

export default function AutoLeadsPage() {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [activeTab, setActiveTab] = useState("find");
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [findingLeads, setFindingLeads] = useState(false);
  const [loadingSources, setLoadingSources] = useState(true);
  const [findLimitReached, setFindLimitReached] = useState(false);
  const [findLimitMsg, setFindLimitMsg] = useState("");
  const [limitChecked, setLimitChecked] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourcePage, setSourcePage] = useState(1);
  const SOURCES_PER_PAGE = 10;
  const router = useRouter();
  const findProgress = useProgressTracker(findLeadsSteps);
  const toast = useToast();
  const heroRef = useRef<HTMLDivElement>(null);

  const filteredSources = useMemo(() => {
    if (!sourceSearch.trim()) return sources;
    const q = sourceSearch.toLowerCase();
    return sources.filter(s =>
      s.niche.toLowerCase().includes(q) ||
      s.location.toLowerCase().includes(q)
    );
  }, [sources, sourceSearch]);

  const paginatedSources = useMemo(() => {
    const start = (sourcePage - 1) * SOURCES_PER_PAGE;
    return filteredSources.slice(start, start + SOURCES_PER_PAGE);
  }, [filteredSources, sourcePage]);

  // Reset page on search
  useEffect(() => { setSourcePage(1); }, [sourceSearch]);

  // Check daily limit on page load
  useEffect(() => {
    const checkLimit = async () => {
      try {
        const stats = await apiGet<{ leadsFoundToday: number; dailyLeadFindLimit: number }>("/stats");
        if (stats.leadsFoundToday >= stats.dailyLeadFindLimit) {
          setFindLimitReached(true);
          setFindLimitMsg(`Daily lead find limit reached (${stats.leadsFoundToday}/${stats.dailyLeadFindLimit}). Try again tomorrow.`);
        }
      } catch { /* ignore */ } finally {
        setLimitChecked(true);
      }
    };
    checkLimit();
  }, []);

  // Fetch existing lead sources on page load
  useEffect(() => {
    const fetchSources = async () => {
      try {
        const data = await apiGet<{ sources: LeadSource[] }>("/leads/sources");
        setSources(data.sources || []);
      } catch {
        // silently fail — sources will just be empty
      } finally {
        setLoadingSources(false);
      }
    };
    fetchSources();
  }, []);

  const handleFindLeads = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!niche.trim() || !location.trim()) {
      toast.addToast("Please enter both niche and location", "error");
      return;
    }

    setFindingLeads(true);
    findProgress.start();
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 100);
    try {
      const response = await apiPost<{
        message: string;
        source_id: string;
        campaign_id?: string;
        campaign_name?: string;
        count: number;
        duplicatesSkipped?: number;
      }>("/leads/auto-find", {
        niche,
        location,
      });

      // Clear form
      setNiche("");
      setLocation("");

      // Show success message
      const newSource: LeadSource = {
        id: response.source_id,
        niche,
        location,
        status: "completed",
        created_at: new Date().toISOString(),
        leadsCount: response.count,
        campaignId: response.campaign_id,
        campaignName: response.campaign_name,
      };

      setSources((prev) => [newSource, ...prev]);

      findProgress.finish();
      if (response.count > 0) {
        const dupMsg = response.duplicatesSkipped ? ` (${response.duplicatesSkipped} duplicates skipped)` : "";
        toast.addToast(`Found ${response.count} new leads!${dupMsg}`, "success");
      } else {
        // Genuine "no results" — show the guiding message from the backend (city/niche tip).
        toast.addToast(response.message || `No businesses found for "${niche}" in "${location}". Try a specific city or a different niche.`, "info");
      }

      // If leads found and campaign created, navigate to campaign
      if (response.campaign_id && response.count > 0) {
        router.push(`/campaigns/${response.campaign_id}`);
        return;
      }

      // Otherwise switch to manage tab
      setTimeout(() => setActiveTab("manage"), 500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to find leads";
      // Detect rate limit or plan limit warnings
      const isLimitWarning = message.includes("limit reached") || message.includes("Daily lead find limit") || message.includes("Monthly lead find limit") || message.includes("rate limit") || message.includes("Maximum");
      if (isLimitWarning) {
        setFindLimitReached(true);
        setFindLimitMsg(message);
        toast.addToast(message, "warning");
        console.warn("Find leads limit:", message);
      } else {
        toast.addToast(message, "error");
        console.error("Find leads error:", err);
      }
      findProgress.cancel();
    } finally {
      setFindingLeads(false);
    }
  };

  const handleEnrichLeads = (source: LeadSource) => {
    if (source.campaignId) {
      router.push(`/campaigns/${source.campaignId}`);
    } else {
      toast.addToast("No campaign found for this source. Try finding leads again.", "error");
    }
  };

  const exampleNiches = [
    "dentists",
    "chiropractors",
    "lawyers",
    "plumbers",
    "electricians",
  ];

  const exampleLocations = ["California", "Texas", "New York", "Florida"];

  const quickSetup = async (selectedNiche: string, selectedLocation: string) => {
    setNiche(selectedNiche);
    setLocation(selectedLocation);
  };

  return (
    <FeatureAccessGuard>
    <div>
      {/* Toast Notifications */}
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />

      {/* Hero */}
      <div ref={heroRef} className="relative overflow-hidden rounded-2xl p-8 md:p-10 mb-8" style={{ background: 'linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #2a2158 100%)' }}>
        <div className="absolute inset-0">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl" style={{ background: 'rgba(105, 98, 196, 0.12)' }} />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full blur-3xl" style={{ background: 'rgba(167, 139, 250, 0.10)' }} />
        </div>
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 mb-4">
              <svg className="w-4 h-4" style={{ color: '#c4b5fd' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-xs font-medium text-gray-300">Auto Lead Finder</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Find Your Next Customers</h1>
            <p className="mt-2 text-gray-400 text-sm max-w-lg">
              Enter a niche and location — our AI finds, enriches, and scores leads automatically.
            </p>
          </div>
          <div className="hidden lg:flex flex-col items-end gap-6 mt-1">
            <div className="flex items-center gap-3">
              {["Search", "Enrich", "Score", "Email"].map((s, i) => (
                <div key={s} className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(167, 139, 250, 0.12)', border: '1px solid rgba(196, 181, 253, 0.25)' }}>
                    <div className="w-6 h-6 rounded-full grid place-items-center" style={{ background: 'linear-gradient(135deg, #6962c4, #a78bfa)', boxShadow: '0 2px 8px rgba(105, 98, 196, 0.4)' }}>
                      <span className="text-[10px] font-bold text-white" style={{ lineHeight: 1 }}>{i + 1}</span>
                    </div>
                    <span className="text-xs font-semibold text-white">{s}</span>
                  </div>
                  {i < 3 && (
                    <span className="text-sm" style={{ color: 'rgba(196, 181, 253, 0.7)' }}>→</span>
                  )}
                </div>
              ))}
            </div>
            {/* Progress Bar — right side in hero */}
            {findProgress.active && (
              <div className="w-[560px]">
                <ProgressBar tracker={findProgress} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab("find")}
          className={`flex items-center gap-2 px-6 py-2.5 font-semibold text-sm rounded-xl transition-all ${
            activeTab === "find"
              ? "text-white shadow-md"
              : "bg-white text-gray-500 border border-gray-200 hover:border-gray-300 hover:text-gray-700 hover:shadow-sm"
          }`}
          style={activeTab === "find" ? { background: 'linear-gradient(135deg, #3d3580, #6962c4)' } : undefined}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Find Leads
        </button>
        <button
          onClick={() => setActiveTab("manage")}
          className={`flex items-center gap-2 px-6 py-2.5 font-semibold text-sm rounded-xl transition-all ${
            activeTab === "manage"
              ? "text-white shadow-md"
              : "bg-white text-gray-500 border border-gray-200 hover:border-gray-300 hover:text-gray-700 hover:shadow-sm"
          }`}
          style={activeTab === "manage" ? { background: 'linear-gradient(135deg, #3d3580, #6962c4)' } : undefined}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
          Manage Sources
          {sources.length > 0 && (
            <span className={`ml-0.5 min-w-5 h-5 px-1 text-[10px] font-bold rounded-full inline-flex items-center justify-center leading-none ${
              activeTab === "manage" ? "bg-white/20 text-white" : "text-white"
            }`} style={activeTab !== "manage" ? { background: 'rgba(105, 98, 196, 0.15)', color: '#6962c4', border: '1px solid rgba(105, 98, 196, 0.4)' } : undefined}>
              {sources.length}
            </span>
          )}
        </button>
      </div>

      {/* Find Leads Tab */}
      {activeTab === "find" && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Form — 3 cols */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl shadow-md overflow-hidden" style={{ border: '1px solid rgba(47, 39, 108, 0.4)' }}>
              <div className="px-6 py-5" style={{ background: '#2f276c' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255, 255, 255, 0.2)' }}>
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Find Leads by Niche & Location</h2>
                    <p className="text-xs" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Our AI searches Google and extracts verified business data</p>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {!limitChecked ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="h-10 rounded-xl" style={{ background: "rgba(105,98,196,0.08)" }} />
                    <div className="h-10 rounded-xl" style={{ background: "rgba(105,98,196,0.06)" }} />
                    <div className="h-10 rounded-xl" style={{ background: "rgba(105,98,196,0.04)" }} />
                  </div>
                ) : (<>
                {findLimitReached && (
                  <div className="mb-5 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-amber-800">Daily limit reached</p>
                      <p className="text-xs text-amber-700 mt-0.5">{findLimitMsg}</p>
                    </div>
                  </div>
                )}

                <form onSubmit={handleFindLeads} className="space-y-5">
                  <div>
                    <label htmlFor="niche" className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Niche / Industry
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        id="niche"
                        value={niche}
                        onChange={(e) => setNiche(e.target.value)}
                        placeholder="e.g., dentists, plumbers, lawyers"
                        className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#6962c4]/20 focus:border-[#6962c4] focus:bg-white transition-all placeholder-gray-400"
                        disabled={findingLeads}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="location" className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Location
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        id="location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g., San Francisco, California, USA"
                        className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#6962c4]/20 focus:border-[#6962c4] focus:bg-white transition-all placeholder-gray-400"
                        disabled={findingLeads}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={findingLeads || findLimitReached}
                    className="group relative w-full px-5 py-3.5 text-white font-semibold rounded-xl overflow-hidden transition-all duration-500 ease-out shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none text-sm active:scale-[0.99]"
                    style={{ background: 'linear-gradient(135deg, #3d3580 0%, #6962c4 100%)', boxShadow: '0 8px 24px rgba(47,39,108,0.4)' }}
                    title={findLimitReached ? findLimitMsg : ""}
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000 ease-in-out" />
                    <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'linear-gradient(135deg, #6962c4 0%, #a78bfa 100%)' }} />
                    <span className="relative z-10">
                    {findingLeads ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Finding Leads...
                      </span>
                    ) : findLimitReached ? (
                      "Daily Limit Reached — Try Tomorrow"
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Find Leads Now
                      </span>
                    )}
                    </span>
                  </button>
                </form>

              </>)}
              </div>

              {/* Quick Fill Footer */}
              <div className="px-6 py-5 bg-gray-50 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Fill</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {exampleNiches.map((example) => (
                    <button
                      key={example}
                      onClick={() => quickSetup(example, "California")}
                      className="group px-3.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-full hover:text-[#3d3580] hover:bg-[#f5f3ff] transition-all shadow-sm"
                    >
                      {example}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {exampleLocations.map((loc) => (
                    <button
                      key={loc}
                      onClick={() => setLocation(loc)}
                      className="group px-3.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-full hover:text-[#3d3580] hover:bg-[#f5f3ff] transition-all shadow-sm"
                    >
                      📍 {loc}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel — 2 cols */}
          <div className="lg:col-span-2 space-y-6">
            {/* How It Works */}
            <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(47, 39, 108, 0.4)' }}>
              <div className="px-5 py-3.5" style={{ background: '#2f276c' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255, 255, 255, 0.2)' }}>
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-semibold text-white">How It Works</h3>
                </div>
              </div>
              <div className="p-5 space-y-0">
                <div className="flex items-start gap-4 pb-4">
                  <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
                    <span className="text-sm font-bold" style={{ color: '#3d3580' }}>1</span>
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-semibold text-gray-900">Search</p>
                    <p className="text-xs text-gray-500 mt-0.5">Find businesses in your niche and location</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 py-4 border-t border-gray-100">
                  <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
                    <span className="text-sm font-bold" style={{ color: '#3d3580' }}>2</span>
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-semibold text-gray-900">Enrich</p>
                    <p className="text-xs text-gray-500 mt-0.5">Extract emails, phones & business data</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 py-4 border-t border-gray-100">
                  <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
                    <span className="text-sm font-bold" style={{ color: '#3d3580' }}>3</span>
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-semibold text-gray-900">Score</p>
                    <p className="text-xs text-gray-500 mt-0.5">AI scores leads based on fit & opportunity</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 pt-4 border-t border-gray-100">
                  <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
                    <span className="text-sm font-bold" style={{ color: '#3d3580' }}>4</span>
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-semibold text-gray-900">Outreach</p>
                    <p className="text-xs text-gray-500 mt-0.5">Generate personalized emails & follow-ups</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pro Tips */}
            <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(47, 39, 108, 0.4)' }}>
              <div className="px-5 py-3.5" style={{ background: '#2f276c' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255, 255, 255, 0.2)' }}>
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-semibold text-white">Pro Tips</h3>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
                    <span className="text-xs font-bold" style={{ color: '#3d3580' }}>1</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed pt-1">
                    Be specific — <strong className="text-gray-900">&quot;pediatric dentists&quot;</strong> works better than <strong className="text-gray-900">&quot;doctors&quot;</strong>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
                    <span className="text-xs font-bold" style={{ color: '#3d3580' }}>2</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed pt-1">
                    Include <strong className="text-gray-900">city + state</strong> for more targeted and accurate results
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
                    <span className="text-xs font-bold" style={{ color: '#3d3580' }}>3</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed pt-1">
                    Leads scoring <strong className="text-gray-900">70+</strong> are high-quality, ready-to-contact prospects
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Sources Tab */}
      {activeTab === "manage" && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid rgba(47, 39, 108, 0.4)' }}>
          <div className="px-6 py-4" style={{ background: '#2f276c' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255, 255, 255, 0.2)' }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Lead Sources</h2>
                  <p className="text-xs" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>{sources.length} total searches</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {!loadingSources && sources.length > 0 && (
                  <SearchBar
                    placeholder="Search sources..."
                    value={sourceSearch}
                    onChange={setSourceSearch}
                    className="w-64"
                  />
                )}
                <button
                  onClick={() => setActiveTab("find")}
                  className="px-4 py-2 text-xs font-semibold text-white rounded-lg transition-all"
                  style={{ background: 'rgba(255, 255, 255, 0.2)' }}
                >
                  + New Search
                </button>
              </div>
            </div>
          </div>

          {/* Table Header */}
          {!loadingSources && sources.length > 0 && (
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-12 gap-4 items-center">
              <span className="col-span-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Niche & Location</span>
              <span className="col-span-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Leads</span>
              <span className="col-span-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Status</span>
              <span className="col-span-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Date</span>
              <span className="col-span-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Action</span>
            </div>
          )}

          <div className="divide-y divide-gray-50">
            {loadingSources ? (
              <SourcesTableSkeleton />
            ) : sources.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-700">No lead sources yet</p>
                <p className="text-xs text-gray-400 mt-1.5">Find your first leads to populate this list</p>
                <button
                  onClick={() => setActiveTab("find")}
                  className="mt-5 px-6 py-2.5 text-sm font-semibold text-white rounded-xl shadow-lg transition-all"
                  style={{ background: 'linear-gradient(135deg, #3d3580, #6962c4)', boxShadow: '0 10px 25px -5px rgba(61, 53, 128, 0.3)' }}
                >
                  Find Your First Leads
                </button>
              </div>
            ) : (
              filteredSources.length === 0 && sourceSearch ? (
                <div className="text-center py-12">
                  <p className="text-sm text-gray-500">No sources matching &ldquo;{sourceSearch}&rdquo;</p>
                </div>
              ) : paginatedSources.map((source, index) => {
                const globalIndex = (sourcePage - 1) * SOURCES_PER_PAGE + index;
                return (
                <div
                  key={source.id}
                  className={`group grid grid-cols-12 gap-4 items-center px-6 py-4 hover:bg-gray-50/80 transition-all ${
                    index % 2 === 0 ? "bg-white" : "bg-gray-50/40"
                  }`}
                >
                  {/* Niche & Location */}
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(105, 98, 196, 0.12)' }}>
                      <span className="text-sm font-bold" style={{ color: '#3d3580' }}>{globalIndex + 1}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 capitalize truncate">{source.niche}</p>
                      <p className="text-xs text-gray-500 capitalize truncate">{source.location}</p>
                    </div>
                  </div>

                  {/* Leads Count */}
                  <div className="col-span-2">
                    <span className="inline-flex items-center px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-50 text-blue-700">
                      {source.leadsCount || 0} leads
                    </span>
                  </div>

                  {/* Status */}
                  <div className="col-span-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg ${
                        source.status === "completed"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        source.status === "completed" ? "bg-emerald-500" : "bg-amber-500"
                      }`} />
                      {source.status === "completed" ? "Completed" : "Pending"}
                    </span>
                  </div>

                  {/* Date */}
                  <div className="col-span-2">
                    <p className="text-xs text-gray-500">
                      {new Date(source.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </div>

                  {/* Action */}
                  <div className="col-span-2 text-right">
                    <button
                      onClick={() => handleEnrichLeads(source)}
                      disabled={!source.leadsCount}
                      className={`px-4 py-1.5 text-xs font-semibold rounded-lg ring-1 transition-all ${
                        !source.leadsCount
                          ? "text-gray-400 bg-gray-50 ring-gray-200 cursor-not-allowed opacity-50"
                          : "text-[#3d3580] bg-[#f5f3ff] hover:bg-[#ede9fe] ring-[rgba(105,98,196,0.3)] hover:ring-[rgba(105,98,196,0.5)] opacity-70 group-hover:opacity-100"
                      }`}
                    >
                      {source.campaignId ? "View →" : "Enrich →"}
                    </button>
                  </div>
                </div>
              )})
            )}
          </div>
          {!loadingSources && filteredSources.length > SOURCES_PER_PAGE && (
            <div className="px-6 pb-4">
              <Pagination
                currentPage={sourcePage}
                totalItems={filteredSources.length}
                perPage={SOURCES_PER_PAGE}
                onPageChange={setSourcePage}
              />
            </div>
          )}
        </div>
      )}
    </div>
    </FeatureAccessGuard>
  );
}
