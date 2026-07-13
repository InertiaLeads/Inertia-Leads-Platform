"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { apiPostFormData, apiGet } from "@/lib/api";
import { useRouter } from "next/navigation";
import FeatureGate from "../FeatureGate";
import { usePlan } from "../PlanContext";
import LockedFeatureModal from "../LockedFeatureModal";

// ===== Toast Notification System =====
type ToastType = "success" | "error" | "info";

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
  };

  const icons: Record<ToastType, string> = {
    success: "✓",
    error: "✕",
    info: "ℹ",
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

export default function UploadPage() {
  const plan = usePlan();
  const [file, setFile] = useState<File | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dailyUsed, setDailyUsed] = useState(0);
  const [freshLimit, setFreshLimit] = useState<number | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  const dailyLimit = freshLimit ?? plan.dailyLeadFindLimit;
  const planLabel = plan.planLabel || "Starter";
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);
  const isAtLimit = statsLoaded && dailyRemaining <= 0;

  useEffect(() => {
    let cancelled = false;
    apiGet<{ leadsFoundToday: number; dailyLeadFindLimit: number }>("/stats")
      .then((data) => {
        if (!cancelled) {
          setDailyUsed(data.leadsFoundToday);
          setFreshLimit(data.dailyLeadFindLimit);
          setStatsLoaded(true);
        }
      })
      .catch(() => { if (!cancelled) setStatsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  if (!plan.loaded) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 120px)" }}>
        <div className="relative flex items-center justify-center">
          {/* Background glow */}
          <div className="absolute w-40 h-40 rounded-full animate-pulse" style={{ background: "radial-gradient(circle, rgba(105,98,196,0.15) 0%, transparent 70%)", animationDuration: "2s" }} />
          
          {/* Outer dashed ring - slow rotate */}
          <div className="absolute w-32 h-32 rounded-full border border-dashed border-[#6962c4]/20 animate-spin" style={{ animationDuration: "8s" }} />
          
          {/* Outer gradient ring */}
          <div className="absolute w-28 h-28 rounded-full animate-spin" style={{ animationDuration: "3s", background: "conic-gradient(from 0deg, transparent 0%, #6962c4 30%, transparent 60%)", mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #fff calc(100% - 3px))", WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #fff calc(100% - 3px))" }} />
          
          {/* Second gradient ring - counter rotate */}
          <div className="absolute w-20 h-20 rounded-full animate-spin" style={{ animationDuration: "2s", animationDirection: "reverse", background: "conic-gradient(from 180deg, transparent 0%, #a78bfa 40%, transparent 70%)", mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #fff calc(100% - 3px))", WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #fff calc(100% - 3px))" }} />
          
          {/* Inner gradient ring - fast */}
          <div className="absolute w-12 h-12 rounded-full animate-spin" style={{ animationDuration: "1.2s", background: "conic-gradient(from 90deg, transparent 0%, #818cf8 50%, transparent 80%)", mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #fff calc(100% - 2px))", WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #fff calc(100% - 2px))" }} />
          
          {/* Center core with breathing effect */}
          <div className="relative w-6 h-6 rounded-full animate-pulse" style={{ animationDuration: "1.5s", background: "radial-gradient(circle, #a78bfa 0%, #6962c4 60%, #4338ca 100%)", boxShadow: "0 0 20px rgba(105,98,196,0.9), 0 0 40px rgba(105,98,196,0.5), 0 0 60px rgba(105,98,196,0.3), inset 0 0 10px rgba(255,255,255,0.3)" }} />
          
          {/* Orbiting particles */}
          <div className="absolute w-28 h-28 animate-spin" style={{ animationDuration: "3s" }}>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full" style={{ background: "linear-gradient(135deg, #a78bfa, #6962c4)", boxShadow: "0 0 10px rgba(167,139,250,0.9), 0 0 20px rgba(167,139,250,0.4)" }} />
          </div>
          <div className="absolute w-24 h-24 animate-spin" style={{ animationDuration: "2.2s", animationDirection: "reverse" }}>
            <div className="absolute bottom-0 right-0 w-2 h-2 rounded-full" style={{ background: "linear-gradient(135deg, #818cf8, #6366f1)", boxShadow: "0 0 8px rgba(129,140,248,0.9)" }} />
          </div>
          <div className="absolute w-16 h-16 animate-spin" style={{ animationDuration: "1.6s" }}>
            <div className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full" style={{ background: "#c4b5fd", boxShadow: "0 0 6px rgba(196,181,253,0.9)" }} />
          </div>
          <div className="absolute w-32 h-32 animate-spin" style={{ animationDuration: "4s", animationDirection: "reverse" }}>
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: "#e9d5ff", boxShadow: "0 0 6px rgba(233,213,255,0.8)" }} />
          </div>
        </div>
      </div>
    );
  }

  if (!plan.canAccessFeatures) {
    return <LockedFeatureModal />;
  }

  if (!plan.features.csvUpload) {
    return <FeatureGate featureName="CSV Lead Upload" description="Upload your own lead lists via CSV to enrich and campaign against. Import leads from any source." requiredPlan="Growth" />;
  }

  const handleFilePick = (selected: File | null) => {
    if (selected && selected.size > 2 * 1024 * 1024) {
      toast.addToast("CSV file must be under 2MB", "error");
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !campaignName) {
      toast.addToast("Please provide a campaign name and CSV file.", "error");
      return;
    }

    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("campaignName", campaignName);

    try {
      const data = await apiPostFormData<{ count: number; readyNow?: number; queued?: number; skipped?: number; dailyLimit?: number; remaining?: number }>("/leads/upload", formData);
      if (data.queued && data.queued > 0) {
        toast.addToast(`Uploaded ${data.count} leads! ${data.readyNow} ready now, ${data.queued} queued for upcoming days.`, "success");
      } else {
        toast.addToast(`Successfully uploaded ${data.readyNow || data.count} leads!`, "success");
      }
      if (data.skipped && data.skipped > 0) {
        toast.addToast(`${data.skipped} leads from your CSV exceeded the ${data.dailyLimit}/day plan cap and were skipped.`, "info");
      }
      // Update daily usage display
      setDailyUsed(prev => prev + (data.readyNow || 0));
      setFile(null);
      setCampaignName("");
      setTimeout(() => router.push("/campaigns"), 1500);
    } catch (err) {
      toast.addToast(err instanceof Error ? err.message : "Something went wrong. Please try again.", "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl p-8 md:p-10 mb-8" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #2a2158 100%)" }}>
        <div className="absolute inset-0">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl" style={{ background: "rgba(105,98,196,0.15)" }} />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full blur-3xl" style={{ background: "rgba(167,139,250,0.1)" }} />
        </div>
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border mb-4" style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.1)" }}>
            <svg className="w-4 h-4" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>Upload</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Upload Leads</h1>
          <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Upload a CSV file with your leads to create a new campaign instantly.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Form Card */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
            <div className="px-6 py-4 border-b" style={{ background: "#2f276c", borderColor: "#2f276c" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <h2 className="text-sm font-bold text-white">New Campaign</h2>
              </div>
            </div>

            <form onSubmit={handleUpload} className="p-6 space-y-6">
              {/* Daily limit status */}
              {!statsLoaded ? (
                <div className="flex items-start gap-3 p-4 rounded-xl animate-pulse" style={{ background: "rgba(105,98,196,0.06)", border: "1px solid rgba(105,98,196,0.15)" }}>
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg" style={{ background: "rgba(105,98,196,0.12)" }} />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3 rounded w-1/3" style={{ background: "rgba(105,98,196,0.12)" }} />
                    <div className="h-2.5 rounded w-2/3" style={{ background: "rgba(105,98,196,0.08)" }} />
                  </div>
                </div>
              ) : isAtLimit ? (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-red-800">Daily limit reached</p>
                    <p className="text-xs text-red-600 mt-0.5">You&apos;ve found {dailyUsed}/{dailyLimit} leads today ({planLabel} plan). Upload is disabled until tomorrow.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-4 rounded-xl" style={{ background: "rgba(105,98,196,0.06)", border: "1px solid rgba(105,98,196,0.15)" }}>
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(105,98,196,0.12)" }}>
                    <svg className="w-4 h-4" style={{ color: "#6962c4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: "#1a1540" }}>Daily usage: {dailyUsed}/{dailyLimit}</p>
                    <p className="text-xs mt-0.5" style={{ color: "#6962c4" }}>{dailyRemaining} leads remaining today ({planLabel} plan). Max {dailyLimit} leads per upload.</p>
                  </div>
                </div>
              )}
              {/* Campaign Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Campaign Name</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    required
                    className="block w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6962c4]/20 focus:border-[#6962c4] transition-all placeholder:text-gray-400"
                    placeholder="e.g., Q1 SEO Outreach"
                  />
                </div>
              </div>

              {/* File Drop Zone */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">CSV File</label>
                <div
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                    dragActive
                      ? "border-[#6962c4] bg-[#6962c4]/5"
                      : file
                      ? "border-emerald-300 bg-emerald-50/50"
                      : "border-gray-200 hover:border-[#6962c4]/40 hover:bg-[#6962c4]/[0.02]"
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped && dropped.name.endsWith(".csv")) handleFilePick(dropped);
                    else toast.addToast("Please upload a .csv file", "error");
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={(e) => handleFilePick(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  {file ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                        <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setFile(null); }}
                        className="text-xs text-red-500 hover:text-red-700 font-medium mt-1"
                      >
                        Remove file
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-700">Drop your CSV here or <span style={{ color: "#6962c4" }}>browse</span></p>
                        <p className="text-xs text-gray-400 mt-1">Max file size: 2MB</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={uploading || !file || !campaignName || isAtLimit}
                className="group relative w-full px-6 py-3.5 text-white text-sm font-bold rounded-xl overflow-hidden transition-all duration-500 ease-out shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)", boxShadow: "0 8px 24px rgba(47,39,108,0.4)" }}
              >
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000 ease-in-out" />
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: "linear-gradient(135deg, #6962c4 0%, #a78bfa 100%)" }} />
                <span className="relative z-10">
                {uploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Uploading...
                  </span>
                ) : isAtLimit ? (
                  "Daily Limit Reached — Try Tomorrow"
                ) : (
                  "Upload & Create Campaign"
                )}
                </span>
              </button>
            </form>
          </div>
        </div>

        {/* Right Side Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Required Format */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
            <div className="px-5 py-3.5 border-b" style={{ background: "#2f276c", borderColor: "#2f276c" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-white">CSV Format</h3>
              </div>
            </div>
            <div className="p-5">
              <p className="text-xs text-gray-500 mb-3">Required columns in your CSV file:</p>
              <div className="space-y-2">
                {[
                  { col: "email", desc: "Email address" },
                  { col: "company", desc: "Company name" },
                  { col: "website", desc: "Website URL" },
                ].map((item) => (
                  <div key={item.col} className="flex items-center gap-3">
                    <span className="px-2 py-0.5 text-xs font-mono font-bold rounded-md ring-1 ring-[#6962c4]/20" style={{ color: "#3d3580", background: "rgba(105,98,196,0.08)" }}>{item.col}</span>
                    <span className="text-xs text-gray-500">{item.desc}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-lg" style={{ background: "rgba(105,98,196,0.04)" }}>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Optional columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {["name", "phone", "title", "location", "industry"].map((col) => (
                    <span key={col} className="px-2 py-0.5 text-xs font-mono text-gray-600 bg-white rounded-md ring-1 ring-gray-200">{col}</span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const csv = "email,company,website,name,phone,title,location,industry";
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "leads-template.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all hover:opacity-80"
                style={{ color: "#3d3580", background: "rgba(105,98,196,0.08)", border: "1px solid rgba(105,98,196,0.2)" }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download Sample Template
              </button>
            </div>
          </div>

          {/* Tips */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
            <div className="px-5 py-3.5 border-b" style={{ background: "#2f276c", borderColor: "#2f276c" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-white">Tips</h3>
              </div>
            </div>
            <div className="p-5">
              <ul className="space-y-3">
                {[
                  "Include website URLs for AI-powered email personalization",
                  "Leads are automatically enriched with contact info and scoring",
                  "Use Auto Lead Finder to skip CSV upload entirely",
                ].map((tip, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-gray-600">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 text-white" style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}>{i + 1}</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
