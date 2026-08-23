"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { apiGet, apiPost, apiPostLong, apiPut } from "@/lib/api";
import SearchBar from "../../SearchBar";
import Loader from "../../Loader";
import Pagination from "../../Pagination";
import { usePlan } from "../../PlanContext";
import LockedFeatureModal from "../../LockedFeatureModal";
import SetupRequiredModal, { SetupRequiredType } from "../../SetupRequiredModal";
import { createClient } from "@/lib/supabase/client";

// ===== Custom Styled Dropdown =====
function CustomSelect<T extends string>({
  value,
  onChange,
  options,
  searchEntries,
  disabled,
  className,
  placeholder,
}: {
  value: T;
  onChange: (val: T) => void;
  options: { value: T; label: string }[];
  searchEntries?: { value: T; label: string }[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Display: use stored label if set, otherwise fall back to first match in entries or options
  const entries = searchEntries || options;
  const displayLabel = selectedLabel || entries.find(o => o.value === value)?.label || options.find(o => o.value === value)?.label || placeholder || "Select...";

  const filtered = search.trim()
    ? entries.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : entries;

  const deduped = filtered;

  return (
    <div ref={ref} className={`relative inline-block ${className || ""}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="group inline-flex items-center gap-1.5 text-[11px] font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap text-white/80 hover:text-white"
      >
        <span>{displayLabel}</span>
        <svg className={`w-3 h-3 opacity-40 group-hover:opacity-70 transition-all duration-200 flex-shrink-0 ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 z-50 mt-2 rounded-xl shadow-[0_20px_60px_-10px_rgba(0,0,0,0.3)] bg-white ring-1 ring-black/[0.06] overflow-hidden" style={{ minWidth: "260px" }}>
          <div className="px-2.5 pt-2.5 pb-1.5">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search country or city..."
              className="w-full px-3 py-1.5 text-[12px] text-gray-700 placeholder-gray-400 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-violet-300 focus:ring-1 focus:ring-violet-200 transition-all"
            />
          </div>
          <div className="overflow-y-auto overscroll-contain py-1" style={{ maxHeight: "240px", scrollbarWidth: "thin", scrollbarColor: "#d4d4d8 transparent" }}>
          {deduped.length === 0 ? (
            <div className="px-3.5 py-3 text-[12px] text-gray-400 text-center">No timezone found</div>
          ) : (
          deduped.map((opt, idx) => (
            <button
              key={`${opt.value}-${idx}`}
              type="button"
              onClick={() => { onChange(opt.value); setSelectedLabel(opt.label); setOpen(false); setSearch(""); }}
              className={`w-full text-left px-3.5 py-2 text-[12px] transition-all duration-150 ${
                opt.label === displayLabel
                  ? "text-violet-700 font-semibold bg-violet-50"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50 font-medium"
              }`}
            >
              {opt.label}
            </button>
          )))}
          </div>
        </div>
      )}
    </div>
  );
}

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
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
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

interface Lead {
  id: string;
  name: string;
  email: string;
  company: string;
  website: string;
  phone?: string;
  contact_method?: string;
  source_type?: string;
  score?: number;
  contacted?: boolean;
  contacted_at?: string;
  enriched_data?: {
    summary?: string;
    issues?: string[];
    opportunity?: string;
    hasOnlineBooking?: boolean;
    hasContactForm?: boolean;
    technologies?: string[];
    socialLinks?: string[];
    industry?: string;
    title?: string;
    description?: string;
    emails?: string[];
    phones?: string[];
    headings?: string[];
    // New signals
    isMobileFriendly?: boolean;
    hasSSL?: boolean;
    hasMetaDescription?: boolean;
    pageLoadTimeMs?: number;
    pageSizeKB?: number;
    copyrightYear?: number | null;
    isSPA?: boolean;
    isParkedDomain?: boolean;
    _siteDown?: boolean;
    audit_token?: string;
  };
}

interface Email {
  id: string;
  lead_id: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  sequence_step?: number;
  sent_at: string | null;
  scheduled_at?: string | null;
  replied?: boolean;
  replied_at?: string | null;
  retry_count?: number;
  error_log?: string | null;
  tone_variant?: string;
  gmail_email?: string | null;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  total_leads: number;
  enable_followups?: boolean;
  send_timezone?: string;
  settings_confirmed?: boolean;
  created_at: string;
}

// Timezone options for email sending (concise labels shown in button & default list)
const TIMEZONE_OPTIONS = [
  { value: "US_EAST", label: "US East (New York)" },
  { value: "US_CENTRAL", label: "US Central (Chicago)" },
  { value: "US_MOUNTAIN", label: "US Mountain (Denver)" },
  { value: "US_WEST", label: "US West (Los Angeles)" },
  { value: "US_ALASKA", label: "US Alaska (Anchorage)" },
  { value: "US_HAWAII", label: "US Hawaii (Honolulu)" },
  { value: "CA_ATLANTIC", label: "Canada Atlantic (Halifax)" },
  { value: "CA_NEWFOUNDLAND", label: "Canada Newfoundland (St. John's)" },
  { value: "UK", label: "UK (London)" },
  { value: "EU_CENTRAL", label: "Europe Central (Berlin/Paris)" },
  { value: "EU_EAST", label: "Europe East (Athens/Helsinki)" },
  { value: "ARABIA", label: "Saudi Arabia (AST)" },
  { value: "UAE", label: "UAE (GST)" },
  { value: "INDIA", label: "India (IST)" },
  { value: "SINGAPORE", label: "Singapore (SGT)" },
  { value: "PHILIPPINES", label: "Philippines (PHT)" },
  { value: "JAPAN", label: "Japan (JST)" },
  { value: "AU_WEST", label: "Australia West (Perth)" },
  { value: "AU_CENTRAL", label: "Australia Central (Adelaide)" },
  { value: "AU_EAST", label: "Australia East (Sydney)" },
  { value: "NZ", label: "New Zealand (Auckland)" },
  { value: "BRAZIL", label: "Brazil (São Paulo)" },
  { value: "SOUTH_AFRICA", label: "South Africa (Johannesburg)" },
];

// Searchable entries — one entry per country (mapped to correct timezone)
const TIMEZONE_SEARCH_ENTRIES: { value: string; label: string }[] = [
  // United States (multiple timezones)
  { value: "US_EAST", label: "USA - Eastern (New York)" },
  { value: "US_CENTRAL", label: "USA - Central (Chicago)" },
  { value: "US_MOUNTAIN", label: "USA - Mountain (Denver)" },
  { value: "US_WEST", label: "USA - Pacific (Los Angeles)" },
  { value: "US_ALASKA", label: "USA - Alaska" },
  { value: "US_HAWAII", label: "USA - Hawaii" },
  // Canada (multiple timezones)
  { value: "US_EAST", label: "Canada - Eastern (Toronto)" },
  { value: "US_CENTRAL", label: "Canada - Central (Winnipeg)" },
  { value: "US_MOUNTAIN", label: "Canada - Mountain (Calgary)" },
  { value: "US_WEST", label: "Canada - Pacific (Vancouver)" },
  { value: "CA_ATLANTIC", label: "Canada - Atlantic (Halifax)" },
  { value: "CA_NEWFOUNDLAND", label: "Canada - Newfoundland (St. John's)" },
  // UK & Western Europe (UTC+0)
  { value: "UK", label: "United Kingdom (GMT)" },
  { value: "UK", label: "Ireland (GMT)" },
  { value: "UK", label: "Portugal (WET)" },
  // Europe Central (UTC+1)
  { value: "EU_CENTRAL", label: "France (CET)" },
  { value: "EU_CENTRAL", label: "Germany (CET)" },
  { value: "EU_CENTRAL", label: "Spain (CET)" },
  { value: "EU_CENTRAL", label: "Italy (CET)" },
  { value: "EU_CENTRAL", label: "Netherlands (CET)" },
  { value: "EU_CENTRAL", label: "Belgium (CET)" },
  { value: "EU_CENTRAL", label: "Austria (CET)" },
  { value: "EU_CENTRAL", label: "Switzerland (CET)" },
  { value: "EU_CENTRAL", label: "Sweden (CET)" },
  { value: "EU_CENTRAL", label: "Norway (CET)" },
  { value: "EU_CENTRAL", label: "Denmark (CET)" },
  { value: "EU_CENTRAL", label: "Poland (CET)" },
  { value: "EU_CENTRAL", label: "Czech Republic (CET)" },
  { value: "EU_CENTRAL", label: "Hungary (CET)" },
  { value: "EU_CENTRAL", label: "Croatia (CET)" },
  { value: "EU_CENTRAL", label: "Nigeria (WAT)" },
  // Europe East (UTC+2)
  { value: "EU_EAST", label: "Greece (EET)" },
  { value: "EU_EAST", label: "Finland (EET)" },
  { value: "EU_EAST", label: "Romania (EET)" },
  { value: "EU_EAST", label: "Bulgaria (EET)" },
  { value: "EU_EAST", label: "Ukraine (EET)" },
  { value: "EU_EAST", label: "Israel (IST)" },
  { value: "EU_EAST", label: "Lithuania (EET)" },
  { value: "EU_EAST", label: "Latvia (EET)" },
  // Arabia / East Africa (UTC+3)
  { value: "ARABIA", label: "Turkey (TRT)" },
  { value: "ARABIA", label: "Saudi Arabia (AST)" },
  { value: "ARABIA", label: "Qatar (AST)" },
  { value: "ARABIA", label: "Kuwait (AST)" },
  { value: "ARABIA", label: "Bahrain (AST)" },
  { value: "ARABIA", label: "Iraq (AST)" },
  { value: "ARABIA", label: "Kenya (EAT)" },
  { value: "ARABIA", label: "Ethiopia (EAT)" },
  { value: "ARABIA", label: "Tanzania (EAT)" },
  // UAE / Gulf (UTC+4)
  { value: "UAE", label: "UAE (GST)" },
  { value: "UAE", label: "Oman (GST)" },
  // India & South Asia (UTC+5:30)
  { value: "INDIA", label: "India (IST)" },
  { value: "INDIA", label: "Sri Lanka (IST)" },
  // Southeast Asia (UTC+8)
  { value: "SINGAPORE", label: "Singapore (SGT)" },
  { value: "SINGAPORE", label: "Malaysia (MYT)" },
  { value: "SINGAPORE", label: "Hong Kong (HKT)" },
  { value: "SINGAPORE", label: "China (CST)" },
  { value: "SINGAPORE", label: "Taiwan (CST)" },
  { value: "PHILIPPINES", label: "Philippines (PHT)" },
  // East Asia (UTC+9)
  { value: "JAPAN", label: "Japan (JST)" },
  { value: "JAPAN", label: "South Korea (KST)" },
  // Australia (multiple timezones)
  { value: "AU_WEST", label: "Australia - Western (Perth)" },
  { value: "AU_CENTRAL", label: "Australia - Central (Adelaide)" },
  { value: "AU_EAST", label: "Australia - Eastern (Sydney)" },
  // New Zealand
  { value: "NZ", label: "New Zealand (NZST)" },
  // South America (UTC-3)
  { value: "BRAZIL", label: "Brazil (BRT)" },
  { value: "BRAZIL", label: "Argentina (ART)" },
  { value: "BRAZIL", label: "Uruguay (UYT)" },
  // Africa (UTC+2)
  { value: "SOUTH_AFRICA", label: "South Africa (SAST)" },
  { value: "SOUTH_AFRICA", label: "Egypt (EET)" },
  { value: "SOUTH_AFRICA", label: "Botswana (CAT)" },
  { value: "SOUTH_AFRICA", label: "Zimbabwe (CAT)" },
  { value: "SOUTH_AFRICA", label: "Mozambique (CAT)" },
];

// ===== Progress Tracker =====
interface ProgressStep {
  label: string;
  delayMs: number; // time before showing this step
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
    // Clear any existing timers
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    // Schedule each step
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

// Step configs for each operation
const enrichSteps: ProgressStep[] = [
  { label: "Preparing leads for enrichment...", delayMs: 0 },
  { label: "Scraping websites in parallel...", delayMs: 2000 },
  { label: "Extracting emails and contact info...", delayMs: 6000 },
  { label: "Scoring leads based on enriched data...", delayMs: 12000 },
  { label: "Saving enrichment results...", delayMs: 20000 },
  { label: "Almost done — finalizing scores...", delayMs: 30000 },
];

const generateSteps: ProgressStep[] = [
  { label: "Analyzing lead data...", delayMs: 0 },
  { label: "Crafting personalized emails (batch 1)...", delayMs: 3000 },
  { label: "Generating more emails in parallel...", delayMs: 8000 },
  { label: "Fine-tuning subject lines...", delayMs: 15000 },
  { label: "Wrapping up — saving emails...", delayMs: 25000 },
  { label: "Almost there...", delayMs: 40000 },
];

const generateAdvancedSteps: ProgressStep[] = [
  { label: "Analyzing enriched lead profiles...", delayMs: 0 },
  { label: "Generating personalized initial emails...", delayMs: 3000 },
  { label: "Crafting follow-up sequences...", delayMs: 10000 },
  { label: "Writing follow-up nudges in parallel...", delayMs: 18000 },
  { label: "Scheduling follow-up delivery times...", delayMs: 30000 },
  { label: "Saving email sequences...", delayMs: 45000 },
  { label: "Almost done — finalizing...", delayMs: 60000 },
];

const sendSteps: ProgressStep[] = [
  { label: "Connecting to Gmail...", delayMs: 0 },
  { label: "Sending emails with natural spacing...", delayMs: 3000 },
  { label: "Emails going out (45-90s between each)...", delayMs: 15000 },
  { label: "Still sending — keeping delivery natural...", delayMs: 45000 },
  { label: "Sending more emails...", delayMs: 90000 },
  { label: "Wrapping up remaining emails...", delayMs: 150000 },
];

const callScriptSteps: ProgressStep[] = [
  { label: "Finding call-only leads...", delayMs: 0 },
  { label: "Generating call scripts in parallel...", delayMs: 2000 },
  { label: "Tailoring scripts to each business...", delayMs: 8000 },
  { label: "Finishing up...", delayMs: 15000 },
];

// ===== Time Ago Helper =====
function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ===== Lead Detail Modal =====
function LeadDetailModal({ lead, onClose, canGenerateAudit }: { lead: Lead; onClose: () => void; canGenerateAudit: boolean }) {
  const ed = lead.enriched_data;
  const [auditUrl, setAuditUrl] = useState<string | null>(ed?.audit_token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/audit/${ed.audit_token}` : null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditProgress, setAuditProgress] = useState(0);
  const [auditStep, setAuditStep] = useState("");

  // Build scoring reasons
  const positiveReasons: string[] = [];
  const negativeReasons: string[] = [];

  if (!lead.website || !lead.website.startsWith("http")) {
    positiveReasons.push("No website — zero digital presence (+30)");
  } else {
    positiveReasons.push("Has a basic website (+15)");
  }

  if (ed) {
    if (ed.technologies?.includes("WordPress")) positiveReasons.push("Uses WordPress (legacy platform) (+20)");
    if (ed.technologies?.some(t => ["Joomla", "Drupal"].includes(t))) positiveReasons.push("Uses outdated CMS (Joomla/Drupal) (+20)");
    if (!ed.hasOnlineBooking) positiveReasons.push("No online booking system (+25)");
    if (!ed.hasContactForm) positiveReasons.push("No contact form on website (+15)");
    if (!ed.socialLinks || ed.socialLinks.length <= 1) positiveReasons.push("Weak or no social media presence (+10)");
    if (!ed.technologies || ed.technologies.length === 0) positiveReasons.push("No detectable tech platform (+10)");
    if (ed.hasSSL === false) positiveReasons.push("No SSL — browser shows 'Not Secure' (+10)");
    if (ed.isMobileFriendly === false) positiveReasons.push("Not mobile-friendly — broken on phones (+10)");
    if (ed.pageLoadTimeMs && ed.pageLoadTimeMs > 3000) positiveReasons.push(`Slow page load (${(ed.pageLoadTimeMs / 1000).toFixed(1)}s) (+5)`);
    if (ed.hasMetaDescription === false) positiveReasons.push("Missing meta description — poor SEO (+5)");
    if (ed.copyrightYear && ed.copyrightYear < new Date().getFullYear() - 1) positiveReasons.push(`Outdated copyright © ${ed.copyrightYear} (+5)`);
    if (ed.isParkedDomain) positiveReasons.push("Domain is parked/under construction (+70)");
    if (ed._siteDown) positiveReasons.push("Website is completely down/unreachable (+70)");
    if (ed.hasOnlineBooking && ed.hasContactForm) negativeReasons.push("Has both booking & contact form (-20)");
    if (ed.technologies?.some(t => ["Shopify", "Webflow", "Wix", "Squarespace", "Duda"].includes(t))) negativeReasons.push("Uses modern platform (-15)");
    if (ed.socialLinks && ed.socialLinks.length >= 3) negativeReasons.push("Strong social media (3+ platforms) (-10)");

    // Competitor detection (same logic as backend scoreLead)
    const companyLower = (lead.company || "").toLowerCase();
    const titleLower = (ed.title || "").toLowerCase();
    const descLower = (ed.description || "").toLowerCase();
    const combinedText = `${companyLower} ${titleLower} ${descLower}`;
    const competitorSignals = [
      /\bseo\s+(agency|company|firm|service|expert)/i,
      /\bweb\s+(design|development|developer)\s+(agency|company|firm|studio)/i,
      /\bdigital\s+(marketing|agency)/i,
      /\bmarketing\s+(agency|company|firm)/i,
      /\bbranding\s+agency/i,
      /\bsoftware\s+(development|company)/i,
      /\b(we\s+help|we\s+build|we\s+design|we\s+develop)\b/i,
    ];
    if (competitorSignals.some(regex => regex.test(combinedText))) {
      negativeReasons.push("Detected as a digital/marketing competitor (-30)");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-white/20 backdrop-blur-sm" />
      <div
        className="relative rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        style={{ background: "#0d0a25", border: "1px solid rgba(105,98,196,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(105,98,196,0.15)" }}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold" style={{
              background: lead.score && lead.score >= 70 ? "rgba(16,185,129,0.1)" : lead.score && lead.score >= 40 ? "rgba(245,158,11,0.1)" : "rgba(239,68,68,0.1)",
              color: lead.score && lead.score >= 70 ? "#10b981" : lead.score && lead.score >= 40 ? "#f59e0b" : "#ef4444",
              border: `2px solid ${lead.score && lead.score >= 70 ? "rgba(16,185,129,0.4)" : lead.score && lead.score >= 40 ? "rgba(245,158,11,0.4)" : "rgba(239,68,68,0.4)"}`,
            }}>
              {lead.score ?? "—"}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white capitalize truncate">{lead.company || lead.name}</h3>
              {lead.name && lead.name.toLowerCase() !== (lead.company || "").toLowerCase() && (
                <p className="text-xs capitalize truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{lead.name}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors flex-shrink-0"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(105,98,196,0.3) transparent" }}>
          {/* Top Row: Contact + Audit side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Contact Info */}
            <div className="rounded-xl p-4 space-y-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(105,98,196,0.15)" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#a78bfa" }}>Contact</p>
              {lead.email && (
                <div className="flex items-center gap-2 text-sm">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#6962c4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  <span className="break-all text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{lead.email}</span>
                </div>
              )}
              {lead.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#f97316" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{lead.phone}</span>
                </div>
              )}
              {lead.website && (
                <div className="flex items-center gap-2 text-sm">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#a78bfa" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                  <a href={lead.website} target="_blank" rel="noopener noreferrer" className="hover:underline break-all text-xs" style={{ color: "#a78bfa" }}>{lead.website.replace(/^https?:\/\//, "")}</a>
                </div>
              )}
              {ed?.industry && (
                <div className="pt-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold capitalize" style={{ background: "rgba(105,98,196,0.15)", color: "#a78bfa" }}>{ed.industry}</span>
                </div>
              )}
            </div>

            {/* Audit Report */}
            {ed && (
              <div className="rounded-xl p-4 flex flex-col justify-center" style={{ background: "rgba(105,98,196,0.06)", border: "1px solid rgba(105,98,196,0.2)" }}>
                {!canGenerateAudit ? (
                  <div className="text-center py-2">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center mx-auto mb-2" style={{ background: "rgba(105,98,196,0.2)" }}>
                      <svg className="w-4.5 h-4.5" style={{ color: "#a78bfa" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <p className="text-sm font-semibold text-white mb-1">Website Audit Report</p>
                    <p className="text-[11px] mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
                      Available on Growth &amp; Agency plans
                    </p>
                    <button
                      onClick={() => window.location.href = "/settings"}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
                      style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)", boxShadow: "0 2px 10px rgba(105,98,196,0.4)" }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                      Upgrade to Unlock
                    </button>
                  </div>
                ) : auditLoading ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold" style={{ color: "#a78bfa" }}>{auditStep}</p>
                      <p className="text-xs font-semibold" style={{ color: "#6962c4" }}>{Math.round(auditProgress)}%</p>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(105,98,196,0.15)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${auditProgress}%`, background: "linear-gradient(90deg, #6962c4, #a78bfa)" }}
                      />
                    </div>
                    <p className="text-[10px] mt-2" style={{ color: "rgba(255,255,255,0.3)" }}>Powered by Google PageSpeed Insights</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-sm font-semibold text-white mb-1">Website Audit Report</p>
                    <p className="text-[11px] mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {auditUrl ? "Report ready — share with lead" : "Generate a visual report"}
                    </p>
                    {auditUrl ? (
                      <button
                        onClick={() => window.open(auditUrl, "_blank")}
                        className="px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
                        style={{ background: "#6962c4" }}
                      >
                        Preview Report
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          setAuditLoading(true);
                          setAuditProgress(0);
                          setAuditStep("Generating token...");
                          const steps = [
                            { at: 5, text: "Connecting to website..." },
                            { at: 15, text: "Running desktop analysis..." },
                            { at: 40, text: "Running mobile analysis..." },
                            { at: 65, text: "Checking scores..." },
                            { at: 80, text: "Finalizing report..." },
                          ];
                          let progress = 0;
                          const timer = setInterval(() => {
                            progress += progress < 70 ? 1.5 : progress < 90 ? 0.6 : 0.2;
                            if (progress > 95) progress = 95;
                            setAuditProgress(progress);
                            const currentStep = [...steps].reverse().find(s => progress >= s.at);
                            if (currentStep) setAuditStep(currentStep.text);
                          }, 500);
                          try {
                            const data = await apiPostLong<{ url: string }>("/audit/generate", { leadId: lead.id });
                            clearInterval(timer);
                            setAuditProgress(100);
                            setAuditStep("Report ready!");
                            setAuditUrl(data.url);
                          } catch {
                            clearInterval(timer);
                            setAuditStep("Failed — try again");
                          }
                          setTimeout(() => setAuditLoading(false), 500);
                        }}
                        className="px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
                        style={{ background: "#6962c4" }}
                      >
                        Generate Report
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Summary */}
          {ed?.summary && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>Summary</p>
              <p className="text-sm leading-relaxed line-clamp-3" style={{ color: "rgba(255,255,255,0.65)" }}>{ed.summary}</p>
            </div>
          )}

          {/* Issues Found */}
          {ed?.issues && ed.issues.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>Issues Found</p>
              <div className="space-y-1.5">
                {ed.issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(239,68,68,0.15)" }}>
                      <svg className="w-3 h-3" style={{ color: "#f87171" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </span>
                    <span className="text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Opportunity */}
          {ed?.opportunity && (
            <div className="rounded-xl p-4" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#34d399" }}>Opportunity</p>
              <p className="text-sm font-medium" style={{ color: "#6ee7b7" }}>{ed.opportunity}</p>
            </div>
          )}

          {/* Digital Presence */}
          {ed && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.35)" }}>Digital Presence</p>

              {/* Alert badges for critical issues */}
              {(ed._siteDown || ed.isParkedDomain) && (
                <div className="mb-3 rounded-xl p-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <p className="text-sm font-bold" style={{ color: "#fca5a5" }}>
                    {ed._siteDown ? "⚠ Website is completely down/unreachable" : "⚠ Domain is parked or under construction"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "#f87171" }}>This business has no functional website for customers.</p>
                </div>
              )}

              {ed.isSPA && (
                <div className="mb-3 rounded-xl p-3" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                  <p className="text-xs font-semibold" style={{ color: "#fbbf24" }}>⚡ JavaScript-rendered site detected — some signals may be partial</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Online Booking", value: ed.hasOnlineBooking ? "✓ Yes" : "✗ No", positive: ed.hasOnlineBooking },
                  { label: "Contact Form", value: ed.hasContactForm ? "✓ Yes" : "✗ No", positive: ed.hasContactForm },
                  { label: "SSL (HTTPS)", value: ed.hasSSL !== false ? "✓ Secure" : "✗ Not Secure", positive: ed.hasSSL !== false },
                  { label: "Mobile-Friendly", value: ed.isMobileFriendly !== false ? "✓ Yes" : "✗ No", positive: ed.isMobileFriendly !== false },
                  { label: "SEO Meta", value: ed.hasMetaDescription !== false ? "✓ Present" : "⚠ Missing", positive: ed.hasMetaDescription !== false },
                  ...(ed.pageLoadTimeMs !== undefined ? [{ label: "Page Speed", value: `${(ed.pageLoadTimeMs / 1000).toFixed(1)}s ${ed.pageSizeKB ? `(${ed.pageSizeKB}KB)` : ""}`, positive: ed.pageLoadTimeMs <= 3000 }] : []),
                  ...(ed.copyrightYear ? [{ label: "Copyright Year", value: `© ${ed.copyrightYear}`, positive: ed.copyrightYear >= new Date().getFullYear() - 1 }] : []),
                ].map((item, i) => (
                  <div key={i} className="rounded-xl p-3" style={{
                    background: item.positive ? "rgba(16,185,129,0.05)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${item.positive ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)"}`,
                  }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: item.positive ? "#34d399" : "rgba(255,255,255,0.45)" }}>
                      {item.label}
                    </p>
                    <p className="text-sm font-bold" style={{ color: item.positive ? "#6ee7b7" : "rgba(255,255,255,0.7)" }}>
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Technologies */}
          {ed?.technologies && ed.technologies.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>Technologies</p>
              <div className="flex flex-wrap gap-1.5">
                {ed.technologies.map((tech, i) => (
                  <span key={i} className="px-2 py-0.5 rounded text-[11px] font-semibold" style={{ background: "rgba(105,98,196,0.12)", color: "#a78bfa", border: "1px solid rgba(105,98,196,0.25)" }}>{tech}</span>
                ))}
              </div>
            </div>
          )}

          {/* Social Links */}
          {ed?.socialLinks && ed.socialLinks.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>Social Media</p>
              <div className="flex flex-wrap gap-2">
                {ed.socialLinks.map((link, i) => (
                  <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="px-2 py-0.5 rounded text-[11px] font-medium hover:brightness-125 transition-all break-all" style={{ background: "rgba(167,139,250,0.08)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
                    {link.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Score Breakdown */}
          {(positiveReasons.length > 0 || negativeReasons.length > 0) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.35)" }}>Score Breakdown</p>
              <div className="space-y-1.5">
                {positiveReasons.map((r, i) => (
                  <div key={`p-${i}`} className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(16,185,129,0.15)" }}>
                      <svg className="w-3 h-3" style={{ color: "#34d399" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                    </span>
                    <span className="text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{r}</span>
                  </div>
                ))}
                {negativeReasons.map((r, i) => (
                  <div key={`n-${i}`} className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(239,68,68,0.15)" }}>
                      <svg className="w-3 h-3" style={{ color: "#f87171" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" /></svg>
                    </span>
                    <span className="text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Not Enriched */}
          {!ed && (
            <div className="rounded-xl p-4 text-center" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <p className="text-sm font-medium" style={{ color: "#f59e0b" }}>This lead has not been enriched yet.</p>
              <p className="text-xs mt-1" style={{ color: "rgba(245,158,11,0.6)" }}>Click &quot;Enrich Leads&quot; to analyze this lead&apos;s digital presence.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Call Script Preview Modal =====
function CallScriptModal({ script, onClose }: { script: { lead_id: string; company: string; phone?: string; opening: string; script: string }; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-white/20 backdrop-blur-sm" />
      <div
        className="relative rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        style={{ background: "#0d0a25", border: "1px solid rgba(105,98,196,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(105,98,196,0.15)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(251,146,60,0.15)" }}>
              <svg className="w-4 h-4" style={{ color: "#fb923c" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            </div>
            <h3 className="text-sm font-bold text-white">Call Script</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(105,98,196,0.3) transparent" }}>
          <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(251,146,60,0.25)" }}>
            {/* Top accent bar */}
            <div className="h-0.5" style={{ background: "linear-gradient(90deg, #fb923c, #f59e0b)" }} />
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="font-semibold text-white capitalize">{script.company}</span>
                {script.phone && (
                  <a href={`tel:${script.phone}`} className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-colors hover:brightness-125" style={{ color: "#fb923c", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.25)" }}>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    {script.phone}
                  </a>
                )}
              </div>
              {script.opening && (
                <div className="mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#fb923c" }}>Opening</p>
                  <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>{script.opening}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#fb923c" }}>Full Script</p>
                <p className="text-sm whitespace-pre-line leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>{script.script}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Email Preview Modal =====
function EmailPreviewModal({ emails, onClose, onMarkReply }: { emails: Email[]; onClose: () => void; onMarkReply: (id: string) => void }) {
  const stepStyles = [
    { border: "rgba(105,98,196,0.3)", label: "rgba(105,98,196,0.9)" },
    { border: "rgba(167,139,250,0.3)", label: "rgba(167,139,250,0.9)" },
    { border: "rgba(251,146,60,0.3)", label: "rgba(251,146,60,0.9)" },
  ];

  // Convert URLs in text to clickable links. The unsubscribe URL is shown as a
  // clickable "Unsubscribe" word (matching how the sent HTML email renders it).
  function renderBody(text: string) {
    const parts = text.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) => {
      if (/^https?:\/\//.test(part)) {
        const isUnsub = part.includes("/api/unsubscribe/") || part.includes("/u/");
        return (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="hover:underline break-all" style={{ color: "#a78bfa" }}>
            {isUnsub ? "Unsubscribe" : part}
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-white/20 backdrop-blur-sm" />
      <div
        className="relative rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        style={{ background: "#0d0a25", border: "1px solid rgba(105,98,196,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(105,98,196,0.15)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(105,98,196,0.15)" }}>
              <svg className="w-4 h-4" style={{ color: "#a78bfa" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </div>
            <h3 className="text-sm font-bold text-white">Email Sequence</h3>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(105,98,196,0.2)", color: "#a78bfa" }}>{emails.length}</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(105,98,196,0.3) transparent" }}>
          {emails.map((email) => {
            const stepIdx = Math.min((email.sequence_step || 1) - 1, 2);
            const style = stepStyles[stepIdx];
            return (
              <div key={email.id} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${style.border}` }}>
                {/* Top accent bar */}
                <div className="h-0.5" style={{ background: style.label }} />
                <div className="p-5">
                  {/* Meta row */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-md text-[10px] font-bold text-white" style={{ background: style.label }}>
                        {(email.sequence_step || 1) === 1 ? "Initial" : `Follow-up ${(email.sequence_step || 1) - 1}`}
                      </span>
                      {email.tone_variant && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-medium uppercase" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>{email.tone_variant}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {email.replied ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Replied
                        </span>
                      ) : email.status === "sent" ? (
                        <button
                          onClick={() => onMarkReply(email.id)}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors hover:brightness-125"
                          style={{ color: "#a78bfa", background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}
                        >
                          Mark Replied
                        </button>
                      ) : null}
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold" style={{
                        background: email.status === "sent" ? "rgba(16,185,129,0.1)" : email.status === "failed" ? "rgba(239,68,68,0.1)" : email.status === "cancelled" ? "rgba(203,213,225,0.1)" : "rgba(245,158,11,0.1)",
                        color: email.status === "sent" ? "#10b981" : email.status === "failed" ? "#ef4444" : email.status === "cancelled" ? "#cbd5e1" : "#f59e0b",
                        border: `1px solid ${email.status === "sent" ? "rgba(16,185,129,0.2)" : email.status === "failed" ? "rgba(239,68,68,0.2)" : email.status === "cancelled" ? "rgba(203,213,225,0.25)" : "rgba(245,158,11,0.2)"}`,
                      }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{
                          background: email.status === "sent" ? "#10b981" : email.status === "failed" ? "#ef4444" : email.status === "cancelled" ? "#cbd5e1" : "#f59e0b",
                        }} />
                        {email.status === "sent" ? "Sent" : email.status === "failed" ? "Failed" : email.status === "cancelled" ? "Cancelled" : "Pending"}
                      </span>
                    </div>
                  </div>

                  {/* Email header */}
                  <div className="mb-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <p className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>To: <span style={{ color: "rgba(255,255,255,0.6)" }}>{email.to_email}</span></p>
                    <h4 className="text-sm font-semibold text-white">{email.subject}</h4>
                  </div>

                  {/* Email body */}
                  <div className="text-sm whitespace-pre-line leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
                    {renderBody(email.body)}
                  </div>

                  {/* Footer meta */}
                  {(email.sent_at || email.scheduled_at || email.error_log || (!email.sent_at && email.status === "pending")) && (
                    <div className="mt-4 pt-3 flex items-center gap-3 flex-wrap text-[11px]" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                      {email.gmail_email && <span>From: {email.gmail_email}</span>}
                      {email.sent_at && <span>Sent {new Date(email.sent_at).toLocaleString()}</span>}
                      {!email.sent_at && !email.scheduled_at && email.status === "pending" && <span style={{ color: "#f59e0b" }}>Sends during next business hours</span>}
                      {!email.sent_at && email.scheduled_at && <span style={{ color: "#f59e0b" }}>Scheduled: {new Date(email.scheduled_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} (during business hours)</span>}
                      {email.replied_at && <span style={{ color: "#10b981" }}>Replied {new Date(email.replied_at).toLocaleString()}</span>}
                      {email.error_log && email.status === "failed" && <span style={{ color: "#ef4444" }}>Error: {email.error_log}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function CampaignDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const plan = usePlan();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [setupModal, setSetupModal] = useState<SetupRequiredType | null>(null);
  const [enableFollowups, setEnableFollowups] = useState(true);
  const [sendTimezone, setSendTimezone] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [showTzWarning, setShowTzWarning] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [generatingScripts, setGeneratingScripts] = useState(false);
  const [callScripts, setCallScripts] = useState<{ lead_id: string; company: string; phone?: string; opening: string; script: string }[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  // Seeded from ?q= so arriving from the campaigns-list lead search lands with the lead
  // already filtered. Without this the user typed the same email twice — once to find which
  // campaign held the lead, then again inside it.
  const [leadSearch, setLeadSearch] = useState(() => searchParams.get("q") || "");
  const [leadPage, setLeadPage] = useState(1);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [emailPreviewLeadId, setEmailPreviewLeadId] = useState<string | null>(null);
  const [callScriptPreviewLeadId, setCallScriptPreviewLeadId] = useState<string | null>(null);
  const [auditViews, setAuditViews] = useState<Record<string, { count: number; lastViewed: string; device: string }>>({});
  const [canGenerateAudit, setCanGenerateAudit] = useState(true);
  const LEADS_PER_PAGE = 10;

  // Reset lead page when search changes
  useEffect(() => { setLeadPage(1); }, [leadSearch]);

  // Limit-reached states (disable buttons when daily cap hit)
  const [generateLimitReached, setGenerateLimitReached] = useState(false);
  const [generateLimitMsg, setGenerateLimitMsg] = useState("");
  const [enrichLimitReached, setEnrichLimitReached] = useState(false);
  const [enrichLimitMsg, setEnrichLimitMsg] = useState("");

  const toast = useToast();

  // Progress trackers for each long operation
  const enrichProgress = useProgressTracker(enrichSteps);
  const generateProgress = useProgressTracker(
    enableFollowups ? generateAdvancedSteps : generateSteps
  );
  const sendProgress = useProgressTracker(sendSteps);
  const scriptProgress = useProgressTracker(callScriptSteps);

  const fetchCampaign = useCallback(async () => {
    try {
      const data = await apiGet<{ campaign: Campaign; leads: Lead[]; emails: Email[] }>(
        `/campaigns/${campaignId}`
      );
      setCampaign(data.campaign);
      setLeads(data.leads);
      setEmails(data.emails);
      setEnableFollowups(data.campaign.enable_followups !== false);
      setSendTimezone(data.campaign.settings_confirmed ? (data.campaign.send_timezone || "US_EAST") : "");
      setSettingsSaved(!!data.campaign.settings_confirmed);

      // Load call scripts from enriched_data
      const existingScripts = data.leads
        .filter((l: Lead) => l.contact_method === "call" && l.enriched_data && (l.enriched_data as any).call_script)
        .map((l: Lead) => {
          const cs = (l.enriched_data as any).call_script;
          return { lead_id: l.id, company: l.company, phone: l.phone, opening: cs.opening || "", script: cs.script || "" };
        });
      if (existingScripts.length > 0) setCallScripts(existingScripts);

      // Fetch audit view data for this campaign
      apiGet<{ viewData: Record<string, { count: number; lastViewed: string; device: string }> }>(`/audit/views/campaign/${campaignId}`)
        .then(vd => setAuditViews(vd.viewData))
        .catch(() => {});
    } catch {
      toast.addToast("Failed to load campaign", "error");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchCampaign();
    // Check audit feature access
    apiGet<{ features?: { auditReports?: boolean }; isOnTrial?: boolean }>("/stats")
      .then((data) => {
        setCanGenerateAudit(data.isOnTrial || data.features?.auditReports !== false);
      })
      .catch(() => {});
  }, [fetchCampaign]);

  // Step 3: Generate Emails
  const handleGenerate = async () => {
    // Email tone is personalized to the user's service. If they haven't picked one yet,
    // prompt them to choose (in the popup) before generating.
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.user_metadata?.service_type_set !== true) {
      setSetupModal("service");
      return;
    }
    // Name + business address are baked into every email as the legally-required
    // (CAN-SPAM) sender footer. Block generation until the profile is complete.
    const meta = user?.user_metadata || {};
    if (!(meta.full_name || "").trim() || !(meta.business_address || "").trim()) {
      setSetupModal("profile");
      return;
    }
    await runGenerate();
  };

  // Actual email generation — assumes a service has already been selected.
  const runGenerate = async () => {
    setGenerating(true);
    generateProgress.start();
    try {
      const endpoint = enableFollowups ? "/generate/advanced" : "/generate";
      // Only send enriched leads that don't already have emails
      const enrichedReadyIds = leads
        .filter(l => selectedLeadIds.has(l.id) && l.enriched_data?.summary && l.contact_method !== "call" && !emails.some(e => e.lead_id === l.id))
        .map(l => l.id);
      const leadIdsToUse = enrichedReadyIds.length > 0 ? enrichedReadyIds : undefined;
      const body = enableFollowups
        ? { campaignId, enableFollowups: true, leadIds: leadIdsToUse }
        : { campaignId, leadIds: leadIdsToUse };
      const data = await apiPostLong<{ count: number }>(endpoint, body);
      generateProgress.finish();
      const selectionNote = leadIdsToUse ? ` (${leadIdsToUse.length} selected)` : "";
      toast.addToast(`Generated ${data.count} personalized emails${selectionNote}!`, "success");
      setSelectedLeadIds(new Set());
      await fetchCampaign();
    } catch (err) {
      generateProgress.cancel();
      const message = err instanceof Error ? err.message : "Failed to generate emails";
      // Detect daily limit reached (403 from backend)
      if (message.includes("Daily AI generation limit reached") || message.includes("daily generation")) {
        setGenerateLimitReached(true);
        setGenerateLimitMsg(message);
      }
      toast.addToast(message, "error");
    } finally {
      setGenerating(false);
    }
  };

  // Step 5: Start Campaign (send emails)
  const handleSend = async () => {
    // Put the button into its loading state immediately so the click feels responsive
    // during the inbox pre-check. We deliberately DON'T start the progress bar yet — that
    // only belongs to real sending — but the spinning button avoids a "silent" 1-2s gap.
    setSending(true);
    try {
      const [gmail, smtp] = await Promise.all([
        apiGet<{ accounts: unknown[] }>("/gmail/accounts"),
        apiGet<{ accounts: unknown[] }>("/smtp/accounts"),
      ]);
      if ((gmail.accounts?.length || 0) + (smtp.accounts?.length || 0) === 0) {
        setSending(false);
        setSetupModal("inbox");
        return;
      }
    } catch {
      // If the check itself fails, fall through — the send attempt below surfaces the real error.
    }

    sendProgress.start();
    try {
      const leadIdsToUse = selectedLeadIds.size > 0 ? Array.from(selectedLeadIds) : undefined;
      const data = await apiPost<{ sent: number; failed: number; total: number; queued?: boolean; message?: string }>("/send", { campaignId, leadIds: leadIdsToUse });
      sendProgress.finish();
      if (data.queued) {
        toast.addToast(data.message || "Campaign queued — will send during business hours!", "info");
      } else {
        toast.addToast(`Sent ${data.sent}/${data.total} emails.${data.failed > 0 ? ` ${data.failed} failed.` : ""}`, data.failed > 0 ? "info" : "success");
      }
      setSelectedLeadIds(new Set());
      await fetchCampaign();
    } catch (err) {
      sendProgress.cancel();
      const message = err instanceof Error ? err.message : "Failed to send emails";
      // Backend rejects sending when no Gmail/SMTP inbox is connected — surface a
      // themed "connect an inbox" prompt instead of a raw error toast.
      if (/no email account connected|connect (an account|gmail or smtp)/i.test(message)) {
        setSetupModal("inbox");
      } else {
        toast.addToast(message, "error");
      }
    } finally {
      setSending(false);
    }
  };

  // Save campaign settings (follow-ups + timezone)
  const handleSaveSettings = async () => {
    if (!campaign) return;
    setSavingSettings(true);
    try {
      const data = await apiPut<{ campaign: Campaign }>(`/campaigns/${campaign.id}`, {
        enable_followups: enableFollowups,
        send_timezone: sendTimezone,
      });
      setCampaign(data.campaign);
      setSettingsSaved(true);
      const tzLabel = TIMEZONE_OPTIONS.find(t => t.value === sendTimezone)?.label || sendTimezone;
      toast.addToast(`Settings saved! Timezone: ${tzLabel}`, "success");
    } catch (err) {
      toast.addToast(err instanceof Error ? err.message : "Failed to update settings", "error");
    } finally {
      setSavingSettings(false);
    }
  };

  // Reactivate campaign
  const handleReactivate = async () => {
    if (!campaign) return;
    try {
      const data = await apiPut<{ campaign: Campaign }>(`/campaigns/${campaign.id}`, { status: "draft" });
      setCampaign(data.campaign);
      toast.addToast("Campaign reactivated!", "success");
    } catch (err) {
      toast.addToast(err instanceof Error ? err.message : "Failed to reactivate", "error");
    }
  };

  // Enrich leads
  const handleEnrich = async () => {
    if (leads.length === 0) return;
    setEnriching(true);
    enrichProgress.start();
    try {
      const leadIds = selectedLeadIds.size > 0 ? Array.from(selectedLeadIds) : leads.map(l => l.id);
      const data = await apiPostLong<{ count: number }>("/leads/enrich", { leadIds });
      enrichProgress.finish();
      const selectionNote = selectedLeadIds.size > 0 ? ` (${selectedLeadIds.size} selected)` : "";
      toast.addToast(`Enriched ${data.count} leads${selectionNote}!`, "success");
      setSelectedLeadIds(new Set());
      await fetchCampaign();
    } catch (err) {
      enrichProgress.cancel();
      const message = err instanceof Error ? err.message : "Failed to enrich leads";
      // Detect batch size limit
      if (message.includes("batch size exceeds") || message.includes("Enrichment rate limit")) {
        setEnrichLimitReached(true);
        setEnrichLimitMsg(message);
      }
      toast.addToast(message, "error");
    } finally {
      setEnriching(false);
    }
  };

  // Mark email as replied
  const handleMarkReply = async (emailId: string) => {
    try {
      await apiPost("/send/mark-reply", { emailId });
      // Mark replied and cancel pending follow-ups for the same lead in UI
      const repliedEmail = emails.find(e => e.id === emailId);
      setEmails(prev => prev.map(e => {
        if (e.id === emailId) return { ...e, replied: true, replied_at: new Date().toISOString() };
        if (repliedEmail && e.lead_id === repliedEmail.lead_id && e.status === "pending") return { ...e, status: "cancelled" };
        return e;
      }));
      toast.addToast("Email marked as replied — follow-ups cancelled", "success");
      await fetchCampaign();
    } catch {
      toast.addToast("Failed to mark reply", "error");
    }
  };

  // Generate call scripts for call-only leads
  const handleGenerateCallScripts = async () => {
    setGeneratingScripts(true);
    scriptProgress.start();
    try {
      const leadIdsToUse = selectedLeadIds.size > 0 ? Array.from(selectedLeadIds) : undefined;
      const data = await apiPostLong<{ count: number; scripts: { lead_id: string; company: string; phone?: string; opening: string; script: string }[] }>("/generate/call-scripts", { campaignId, leadIds: leadIdsToUse });
      scriptProgress.finish();
      setCallScripts(data.scripts);
      toast.addToast(`Generated ${data.count} call scripts!`, "success");
      setSelectedLeadIds(new Set());
      await fetchCampaign();
    } catch (err) {
      scriptProgress.cancel();
      const message = err instanceof Error ? err.message : "Failed to generate call scripts";
      if (message.includes("Daily AI generation limit reached") || message.includes("daily generation")) {
        setGenerateLimitReached(true);
        setGenerateLimitMsg(message);
      }
      toast.addToast(message, "error");
    } finally {
      setGeneratingScripts(false);
    }
  };

  const statusConfig: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    draft: { bg: "bg-gray-100", text: "text-gray-700", dot: "bg-gray-400", label: "Draft" },
    running: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Running" },
    completed: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Completed" },
    pending: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", label: "Pending" },
    sent: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Sent" },
    failed: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", label: "Failed" },
  };

  const statusBadge = (status: string) => {
    const cfg = statusConfig[status] || statusConfig.draft;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-lg ${cfg.bg} ${cfg.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
    );
  };

  if (plan.loaded && !plan.canAccessFeatures) {
    return <LockedFeatureModal />;
  }

  if (loading) {
    return <Loader text="Loading campaign..." fullPage />;
  }

  if (!campaign) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-gray-700">Campaign not found</p>
          <button onClick={() => router.push("/campaigns")} className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium">
            ← Back to campaigns
          </button>
        </div>
      </div>
    );
  }

  const hasEmails = emails.length > 0;
  const hasPendingEmails = emails.some((e) => e.status === "pending");
  const allLeadsHaveEmails = leads.filter(l => l.contact_method !== "call").every(l => emails.some(e => e.lead_id === l.id));
  const contactedLeadCount = leads.filter(l => l.contacted || emails.some(e => e.lead_id === l.id && e.status === "sent")).length;
  const queuedLeadCount = leads.filter(l => l.source_type === "csv_queued").length;
  const activeLeadCount = leads.length - queuedLeadCount;
  const sentEmailCount = emails.filter(e => e.status === "sent").length;
  const repliedEmailCount = emails.filter(e => e.replied).length;
  const auditViewedCount = Object.keys(auditViews).length;
  const heroStatus = statusConfig[campaign.status] || statusConfig.draft;

  return (
    <div>
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />
      {setupModal && (
        <SetupRequiredModal
          type={setupModal}
          onClose={() => setSetupModal(null)}
          onServiceSaved={() => { void runGenerate(); }}
        />
      )}
      {detailLead && <LeadDetailModal lead={detailLead} onClose={() => setDetailLead(null)} canGenerateAudit={canGenerateAudit} />}
      {callScriptPreviewLeadId && (() => {
        const script = callScripts.find(s => s.lead_id === callScriptPreviewLeadId);
        return script ? (
          <CallScriptModal script={script} onClose={() => setCallScriptPreviewLeadId(null)} />
        ) : null;
      })()}
      {emailPreviewLeadId && (() => {
        const leadEmails = emails.filter(e => e.lead_id === emailPreviewLeadId).sort((a, b) => (a.sequence_step || 1) - (b.sequence_step || 1));
        return leadEmails.length > 0 ? (
          <EmailPreviewModal emails={leadEmails} onClose={() => setEmailPreviewLeadId(null)} onMarkReply={handleMarkReply} />
        ) : null;
      })()}

      {/* Hero */}
      <div className="relative rounded-2xl p-8 md:p-10 mb-8" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #2a2158 100%)" }}>
        <div className="absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl" style={{ background: "rgba(105,98,196,0.15)" }} />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full blur-3xl" style={{ background: "rgba(167,139,250,0.1)" }} />
        </div>
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-5">
            <button onClick={() => router.push("/campaigns")} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back to campaigns
            </button>
            {/* Settings */}
            <div className="flex items-center gap-5">
              <div className="relative flex items-center gap-2 rounded-lg px-3 py-[6px]" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }} onClickCapture={() => setShowTzWarning(false)}>
                <svg className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <CustomSelect
                  value={sendTimezone}
                  onChange={(val) => { setSendTimezone(val); setShowTzWarning(false); }}
                  options={TIMEZONE_OPTIONS}
                  searchEntries={TIMEZONE_SEARCH_ENTRIES}
                  disabled={savingSettings}
                  placeholder="Select Timezone"
                />
                {/* Timezone warning card */}
                {showTzWarning && (
                  <div className="absolute top-full right-0 mt-3 z-50 w-80 animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Arrow pointing up */}
                    <div className="absolute -top-2 right-8 w-4 h-4 bg-white rotate-45 rounded-sm shadow-lg" />
                    <div className="relative bg-white rounded-xl shadow-2xl border border-gray-100 p-4">
                      <button onClick={() => setShowTzWarning(false)} className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <div className="flex-1 pr-4">
                          <h4 className="text-sm font-bold text-gray-900 mb-1">Select Timezone First</h4>
                          <p className="text-xs text-gray-600 leading-relaxed">
                            Select the correct timezone for your leads and click <span className="font-semibold text-[#6962c4]">Save</span> before selecting leads. Emails will be sent during business hours in the selected timezone.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-400 font-medium">
                        <svg className="w-3.5 h-3.5 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                        Select timezone above, then click Save
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="w-px h-4 bg-white/10" />

              <button
                type="button"
                role="switch"
                aria-checked={enableFollowups}
                onClick={() => !savingSettings && setEnableFollowups(!enableFollowups)}
                disabled={savingSettings}
                className="flex items-center gap-2.5 transition-all duration-200 cursor-pointer"
              >
                <span className={`text-[12px] font-semibold transition-colors duration-200 ${enableFollowups ? "text-white" : "text-white/70"}`}>Follow-ups</span>
                <div
                  className="relative w-9 h-5 rounded-full transition-all duration-300 ease-in-out"
                  style={{ background: enableFollowups ? "#a78bfa" : "rgba(255,255,255,0.2)" }}
                >
                  <span
                    className="absolute top-[3px] left-[3px] w-3.5 h-3.5 rounded-full shadow-sm transition-all duration-300 ease-in-out"
                    style={{
                      transform: enableFollowups ? "translateX(16px)" : "translateX(0)",
                      background: enableFollowups ? "#fff" : "rgba(255,255,255,0.7)",
                    }}
                  />
                </div>
              </button>

              <div className="w-px h-4 bg-white/10" />

              <button
                onClick={handleSaveSettings}
                disabled={savingSettings || !sendTimezone || (enableFollowups === (campaign?.enable_followups !== false) && sendTimezone === (campaign?.send_timezone || "US_EAST") && settingsSaved)}
                className="px-3 py-[5px] text-[11px] font-semibold text-white/90 rounded-md transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #7c3aed, #a78bfa)" }}
              >
                {savingSettings ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl md:text-3xl font-bold text-white capitalize truncate">{campaign.name}</h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <span className={`w-1.5 h-1.5 rounded-full ${heroStatus.dot}`} />
                  <span className="text-gray-300">{heroStatus.label}</span>
                </span>
                {campaign.status === "completed" && leads.some(l => !emails.some(e => e.lead_id === l.id && e.replied)) && (
                  <button
                    onClick={handleReactivate}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg text-white/80 hover:text-white transition-colors"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    Reactivate
                  </button>
                )}
              </div>
              <p className="text-sm text-gray-400">
                {leads.length} leads · Created {new Date(campaign.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 flex-wrap">
              {(() => {
                const isActive = campaign.status === "draft" || campaign.status === "running" || campaign.status === "failed";
                const selectedLeads = leads.filter(l => selectedLeadIds.has(l.id));
                const selectedUnenriched = selectedLeads.filter(l => !l.enriched_data?.summary);
                const selectedEnriched = selectedLeads.filter(l => l.enriched_data?.summary);
                const selectedEnrichedWithoutEmails = selectedLeads.filter(l => l.enriched_data?.summary && l.contact_method !== "call" && !emails.some(e => e.lead_id === l.id));
                const selectedCallLeads = selectedLeads.filter(l => l.contact_method === "call" && l.enriched_data?.summary);
                const selectedPendingEmails = emails.filter(e => e.status === "pending" && selectedLeadIds.has(e.lead_id));

                return (
                  <>
                    {/* Enrich */}
                    {isActive && selectedLeadIds.size > 0 && selectedUnenriched.length > 0 && (
                      <button
                        onClick={handleEnrich}
                        disabled={enriching || enrichLimitReached}
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:scale-[1.04] hover:brightness-125 hover:-translate-y-0.5"
                        style={{ background: "linear-gradient(135deg, rgba(105,98,196,0.5), rgba(167,139,250,0.35))", border: "1px solid rgba(167,139,250,0.5)", boxShadow: "0 2px 12px rgba(105,98,196,0.2)" }}
                        title={enrichLimitReached ? enrichLimitMsg : ""}
                      >
                        <svg className="w-4 h-4" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                        {enriching ? "Enriching..." : enrichLimitReached ? "Limit Reached" : `Enrich (${selectedUnenriched.length})`}
                      </button>
                    )}
                    {/* Generate Emails */}
                    {isActive && selectedEnrichedWithoutEmails.length > 0 && (
                      <button
                        onClick={handleGenerate}
                        disabled={generating || generateLimitReached}
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:scale-[1.04] hover:brightness-125 hover:-translate-y-0.5"
                        style={{ background: "linear-gradient(135deg, rgba(105,98,196,0.5), rgba(167,139,250,0.35))", border: "1px solid rgba(167,139,250,0.5)", boxShadow: "0 2px 12px rgba(105,98,196,0.2)" }}
                        title={generateLimitReached ? generateLimitMsg : ""}
                      >
                        <svg className="w-4 h-4 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        {generating ? "Generating..." : generateLimitReached ? "Daily Limit Reached" : `Generate Emails (${selectedEnrichedWithoutEmails.length})`}
                      </button>
                    )}
                    {/* Generate Call Scripts */}
                    {isActive && selectedEnriched.length > 0 && selectedCallLeads.length > 0 && (
                      <button
                        onClick={handleGenerateCallScripts}
                        disabled={generatingScripts || generateLimitReached}
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:scale-[1.04] hover:brightness-125 hover:-translate-y-0.5"
                        style={{ background: "linear-gradient(135deg, rgba(105,98,196,0.5), rgba(167,139,250,0.35))", border: "1px solid rgba(167,139,250,0.5)", boxShadow: "0 2px 12px rgba(105,98,196,0.2)" }}
                        title={generateLimitReached ? generateLimitMsg : ""}
                      >
                        <svg className="w-4 h-4 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                        {generatingScripts ? "Generating..." : generateLimitReached ? "Daily Limit Reached" : `Call Scripts (${selectedCallLeads.length})`}
                      </button>
                    )}
                    {/* Send — primary */}
                    {isActive && selectedPendingEmails.length > 0 && (
                      <button
                        onClick={handleSend}
                        disabled={sending}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:scale-[1.05] hover:brightness-110 hover:-translate-y-0.5"
                        style={{ background: "linear-gradient(135deg, #6962c4, #a78bfa)", boxShadow: "0 4px 20px rgba(105,98,196,0.35)" }}
                      >
                        {sending ? (
                          <svg className="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                        )}
                        <span className="text-white">{sending ? "Sending..." : `Send to ${new Set(selectedPendingEmails.map(e => e.lead_id)).size} Selected`}</span>
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Stats Row */}
          <div className="mt-6 flex items-center gap-5 flex-wrap relative">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.12)" }}>
                  <svg className="w-4 h-4" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </div>
                <div>
                  <p className="text-lg font-bold text-white">{activeLeadCount}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Active</p>
                </div>
              </div>
              {queuedLeadCount > 0 && (
                <>
                  <div className="w-px h-8 bg-white/10" />
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.12)" }}>
                      <svg className="w-4 h-4" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">{queuedLeadCount}</p>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">Queued</p>
                    </div>
                  </div>
                </>
              )}
              <div className="w-px h-8 bg-white/10" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.12)" }}>
                  <svg className="w-4 h-4" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                </div>
                <div>
                  <p className="text-lg font-bold text-white">{contactedLeadCount}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Contacted</p>
                </div>
              </div>
              {hasEmails && (
                <>
                  <div className="w-px h-8 bg-white/10" />
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.12)" }}>
                      <svg className="w-4 h-4" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">{sentEmailCount}</p>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">Sent</p>
                    </div>
                  </div>
                </>
              )}
              {repliedEmailCount > 0 && (
                <>
                  <div className="w-px h-8 bg-white/10" />
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.12)" }}>
                      <svg className="w-4 h-4" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">{repliedEmailCount}</p>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">Replies</p>
                    </div>
                  </div>
                </>
              )}
              {auditViewedCount > 0 && (
                <>
                  <div className="w-px h-8 bg-white/10" />
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.12)" }}>
                      <svg className="w-4 h-4" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">{auditViewedCount}</p>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">Viewed Audit</p>
                    </div>
                  </div>
                </>
              )}

              {/* Progress Indicator — right side, absolutely positioned */}
              {(enrichProgress.active || generateProgress.active || sendProgress.active || scriptProgress.active) && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[560px]">
                  <ProgressBar tracker={enrichProgress} />
                  <ProgressBar tracker={generateProgress} />
                  <ProgressBar tracker={sendProgress} />
                  <ProgressBar tracker={scriptProgress} />
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Leads Section */}
      <div className="mt-8">
        {(() => {
          const filteredLeads = leadSearch.trim()
            ? leads.filter(l => {
                const q = leadSearch.toLowerCase();
                return (
                  (l.name?.toLowerCase().includes(q)) ||
                  (l.email?.toLowerCase().includes(q)) ||
                  (l.company?.toLowerCase().includes(q)) ||
                  (l.phone?.toLowerCase().includes(q))
                );
              })
            : leads;

          const contactedCount = filteredLeads.filter(l => l.contacted || emails.some(e => e.lead_id === l.id && e.status === "sent")).length;
          const uncontactedCount = filteredLeads.filter(l => !l.contacted && !emails.some(e => e.lead_id === l.id && e.status === "sent") && l.source_type !== "csv_queued").length;
          const queuedCount = filteredLeads.filter(l => l.source_type === "csv_queued").length;

          const leadStart = (leadPage - 1) * LEADS_PER_PAGE;
          const paginatedLeads = filteredLeads.slice(leadStart, leadStart + LEADS_PER_PAGE);

          return filteredLeads.length === 0 && leads.length === 0 ? (
            <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
              <div className="flex items-center justify-between px-6 py-4" style={{ background: "#2f276c" }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </div>
                  <h2 className="text-sm font-bold text-white">Leads <span style={{ color: "rgba(255,255,255,0.7)" }}>({leads.length})</span></h2>
                </div>
              </div>
              <div className="py-12 text-center">
                <p className="text-sm text-gray-500">No leads in this campaign yet.</p>
              </div>
            </div>
          ) : filteredLeads.length === 0 && leads.length > 0 ? (
            <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
              <div className="flex items-center justify-between px-6 py-4" style={{ background: "#2f276c" }}>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </div>
                    <h2 className="text-sm font-bold text-white">Leads <span style={{ color: "rgba(255,255,255,0.7)" }}>({leads.length})</span></h2>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <SearchBar
                    placeholder="Search leads..."
                    value={leadSearch}
                    onChange={setLeadSearch}
                    className="w-64"
                  />
                </div>
              </div>
              <div className="py-12 text-center">
                <p className="text-sm text-gray-500">No leads matching &ldquo;{leadSearch}&rdquo;</p>
                <button
                  onClick={() => setLeadSearch("")}
                  className="mt-3 text-sm font-medium transition-colors"
                  style={{ color: "#6962c4" }}
                >
                  Clear search
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
              {/* Table Header */}
              <div className="flex items-center justify-between px-6 py-4" style={{ background: "#2f276c" }}>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </div>
                    <h2 className="text-sm font-bold text-white">Leads <span style={{ color: "rgba(255,255,255,0.7)" }}>({leads.length})</span></h2>
                  </div>
                  <div className="h-5 w-px" style={{ background: "rgba(255,255,255,0.2)" }} />
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{filteredLeads.length} showing</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <SearchBar
                    placeholder="Search leads..."
                    value={leadSearch}
                    onChange={setLeadSearch}
                    className="w-64"
                  />
                  {selectedLeadIds.size > 0 && (
                    <span className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)" }}>
                      {selectedLeadIds.size} selected
                    </span>
                  )}
                </div>
              </div>



              {/* Table */}
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3.5 text-left">
                        <input
                          type="checkbox"
                          checked={filteredLeads.length > 0 && filteredLeads.every(l => selectedLeadIds.has(l.id))}
                          onChange={(e) => {
                            if (!settingsSaved) {
                              setShowTzWarning(true);
                              return;
                            }
                            if (e.target.checked) {
                              setSelectedLeadIds(new Set(filteredLeads.map(l => l.id)));
                            } else {
                              setSelectedLeadIds(new Set());
                            }
                          }}
                          className="w-4 h-4 rounded border border-gray-300 bg-white checked:bg-[#6962c4] checked:border-[#6962c4] cursor-pointer appearance-none relative after:content-[''] after:absolute after:top-[2px] after:left-[4.5px] after:w-[5px] after:h-[8px] after:border-white after:border-r-2 after:border-b-2 after:rotate-45 after:opacity-0 checked:after:opacity-100"
                        />
                      </th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Company</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Source</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Score</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Outreach</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedLeads.map((lead) => {
                      const scoreColor =
                        lead.score && lead.score >= 70
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : lead.score && lead.score >= 40
                          ? "bg-amber-50 text-amber-700 ring-amber-200"
                          : "bg-gray-50 text-gray-600 ring-gray-200";
                      const isCallLead = lead.contact_method === "call";
                      const isSelected = selectedLeadIds.has(lead.id);
                      return (
                        <tr key={lead.id} className={`transition-colors ${isSelected ? "bg-indigo-50/50" : "hover:bg-gray-50/70"}`}>
                          <td className="px-4 py-3.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (!settingsSaved) {
                                  setShowTzWarning(true);
                                  return;
                                }
                                const next = new Set(selectedLeadIds);
                                if (e.target.checked) {
                                  next.add(lead.id);
                                } else {
                                  next.delete(lead.id);
                                }
                                setSelectedLeadIds(next);
                              }}
                              className="w-4 h-4 rounded border border-gray-300 bg-white checked:bg-[#6962c4] checked:border-[#6962c4] cursor-pointer appearance-none relative after:content-[''] after:absolute after:top-[2px] after:left-[4.5px] after:w-[5px] after:h-[8px] after:border-white after:border-r-2 after:border-b-2 after:rotate-45 after:opacity-0 checked:after:opacity-100"
                            />
                          </td>
                          <td className="px-4 py-3.5 text-sm font-medium text-gray-900 capitalize">{lead.company}</td>
                          <td className="px-4 py-3.5 text-sm">
                            {isCallLead ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-orange-50 text-orange-700 ring-1 ring-orange-200">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                {lead.phone && lead.phone.trim() ? lead.phone : "No number"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ring-1" style={{ background: "rgba(105,98,196,0.08)", color: "#3d3580", borderColor: "rgba(105,98,196,0.2)" }}>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                {lead.email}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-xs">
                            <span className={`px-2.5 py-1 rounded-lg font-semibold ring-1 ${
                              lead.source_type === "csv"
                                ? "bg-purple-50 text-purple-700 ring-purple-200"
                                : lead.source_type === "csv_queued"
                                ? "bg-amber-50 text-amber-700 ring-amber-200"
                                : "bg-cyan-50 text-cyan-700 ring-cyan-200"
                            }`}>
                              {lead.source_type === "csv" ? "CSV" : lead.source_type === "csv_queued" ? "Queued" : lead.source_type === "auto_find" ? "Auto" : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-sm">
                            {lead.score !== undefined && lead.score !== null ? (
                              <span className={`inline-block px-2.5 py-0.5 rounded-lg text-xs font-bold ring-1 ${scoreColor}`}>
                                {lead.score}
                              </span>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>
                          <td className="pl-2 pr-4 py-3.5 text-sm">
                            <div className="flex flex-col items-start">
                              {emails.some(e => e.lead_id === lead.id && e.replied) ? (
                                <span className="inline-flex items-center whitespace-nowrap rounded-md text-xs font-bold overflow-hidden" style={{ border: "1px solid rgba(16,185,129,0.3)" }}>
                                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700">Replied</span>
                                  {(() => { const r = emails.find(e => e.lead_id === lead.id && e.replied_at); return r?.replied_at ? <span className="px-2 py-1 text-emerald-600 border-l" style={{ borderColor: "rgba(16,185,129,0.3)" }}>{new Date(r.replied_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null; })()}
                                  {auditViews[lead.id] && <span className="px-2 py-1 text-emerald-600/80 border-l" style={{ borderColor: "rgba(16,185,129,0.3)" }}>{auditViews[lead.id].count} {auditViews[lead.id].count === 1 ? "view" : "views"}</span>}
                                </span>
                              ) : (lead.contacted || emails.some(e => e.lead_id === lead.id && e.status === "sent")) ? (
                                <span className="inline-flex items-center whitespace-nowrap rounded-md text-xs font-bold overflow-hidden" style={{ border: "1px solid rgba(59,130,246,0.3)" }}>
                                  <span className="px-2.5 py-1 bg-blue-50 text-blue-700">Contacted</span>
                                  {lead.contacted_at && <span className="px-2 py-1 text-blue-600 border-l" style={{ borderColor: "rgba(59,130,246,0.3)" }}>{new Date(lead.contacted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                                  {auditViews[lead.id] && <span className="px-2 py-1 text-blue-600/80 border-l" style={{ borderColor: "rgba(59,130,246,0.3)" }}>{auditViews[lead.id].count} {auditViews[lead.id].count === 1 ? "view" : "views"}</span>}
                                </span>
                              ) : (
                                <span className="inline-flex items-center whitespace-nowrap rounded-md text-xs font-bold overflow-hidden" style={{ border: "1px solid rgba(107,114,128,0.2)" }}>
                                  <span className="px-2.5 py-1 bg-gray-50 text-gray-600">Uncontacted</span>
                                  {auditViews[lead.id] && <span className="px-2 py-1 text-gray-500 border-l" style={{ borderColor: "rgba(107,114,128,0.2)" }}>{auditViews[lead.id].count} {auditViews[lead.id].count === 1 ? "view" : "views"}</span>}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            {(() => {
                              const isCallLead2 = lead.contact_method === "call";
                              if (isCallLead2) {
                                const script = callScripts.find(s => s.lead_id === lead.id);
                                if (!script) return <span className="text-gray-300 text-xs">—</span>;
                                return (
                                  <button
                                    onClick={() => setCallScriptPreviewLeadId(lead.id)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg ring-1 transition-colors bg-orange-50 text-orange-700 ring-orange-200 hover:bg-orange-100"
                                  >
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                    Script
                                  </button>
                                );
                              }
                              const leadEmails = emails.filter(e => e.lead_id === lead.id);
                              if (leadEmails.length === 0) return <span className="text-gray-300 text-xs">—</span>;
                              const hasReply = leadEmails.some(e => e.replied);
                              const latest = leadEmails.sort((a, b) => (b.sequence_step || 1) - (a.sequence_step || 1))[0];
                              return (
                                <button
                                  onClick={() => setEmailPreviewLeadId(lead.id)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg ring-1 transition-colors ${
                                    latest.status === "sent" || hasReply ? "bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100" :
                                    latest.status === "failed" ? "bg-red-50 text-red-600 ring-red-200 hover:bg-red-100" :
                                    "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100"
                                  }`}
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                  {hasReply ? "Sent" : latest.status === "sent" ? "Sent" : latest.status === "failed" ? "Failed" : "Pending"}
                                  {leadEmails.length > 1 && <span className="text-[9px] opacity-70">+{leadEmails.length - 1}</span>}
                                </button>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3.5">
                            <button
                              onClick={() => setDetailLead(lead)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ring-1 transition-colors"
                              style={{ color: "#3d3580", background: "rgba(105,98,196,0.08)", borderColor: "rgba(105,98,196,0.2)" }}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-4">
                  <Pagination
                    currentPage={leadPage}
                    totalItems={filteredLeads.length}
                    perPage={LEADS_PER_PAGE}
                    onPageChange={setLeadPage}
                  />
                </div>
              </div>
            );
          })()}
        </div>

    </div>
  );
}
