"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  type AuditData,
  type AuditSignals,
  type Check,
  type CheckStatus,
  SEO_CATEGORIES,
  MARKETING_CATEGORIES,
  WEB_DEV_CATEGORIES,
} from "./types";
import { buildSeoChecks } from "./checks/seo";
import { buildMarketingChecks } from "./checks/marketing";
import { buildWebDevChecks } from "./checks/webDev";

// Bands deliberately match Google Lighthouse's own convention — red below 50, amber 50–89,
// green 90+ — so a reader who checks their site at pagespeed.web.dev sees the same colour
// language we do. Inventing our own thresholds would be one more thing to argue about.
export function scoreBand(score: number): { color: string; label: string; grade: string } {
  if (score >= 90) return { color: "#10b981", label: "Strong Position", grade: "A" };
  if (score >= 75) return { color: "#f59e0b", label: "Room for Improvement", grade: "B" };
  if (score >= 60) return { color: "#f59e0b", label: "Falling Behind", grade: "C" };
  return { color: "#ef4444", label: "Needs Immediate Attention", grade: "F" };
}

function ScoreRing({ healthScore }: { healthScore: number }) {
  const { color, label, grade } = scoreBand(healthScore);

  const r = 58;
  const circ = 2 * Math.PI * r;
  const offset = circ - (healthScore / 100) * circ;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[148px] h-[148px]">
        <svg className="w-[148px] h-[148px] -rotate-90" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
          <circle
            cx="64" cy="64" r={r} fill="none"
            stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-extrabold tracking-tight" style={{ color }}>{healthScore}</span>
          <span className="text-[11px] text-gray-400 font-semibold">/100</span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white shadow-sm" style={{ backgroundColor: color }}>
          {grade}
        </span>
        <span className="text-sm font-semibold text-gray-700">{label}</span>
      </div>
    </div>
  );
}

// ===== Lighthouse-style Performance Gauge (like Chrome DevTools) =====
function LighthouseGauge({ score, size = 96 }: { score: number; size?: number }) {
  const color = score >= 90 ? "#0cce6b" : score >= 50 ? "#ffa400" : "#ff4e42";
  const bgColor = score >= 90 ? "#0cce6b22" : score >= 50 ? "#ffa40022" : "#ff4e4222";
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill={bgColor} stroke="#e2e8f0" strokeWidth="4" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold" style={{ color }}>{score}</span>
      </div>
    </div>
  );
}

function LighthouseMetricRow({ label, value, unit, threshold }: { label: string; value: number; unit: string; threshold: { good: number; poor: number } }) {
  const displayValue = unit === "s" ? (value / 1000).toFixed(1) : value.toFixed(3);
  const color = value <= threshold.good ? "#0cce6b" : value <= threshold.poor ? "#ffa400" : "#ff4e42";
  const status = value <= threshold.good ? "Good" : value <= threshold.poor ? "Needs Work" : "Poor";

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-2.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-sm text-gray-700 font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold" style={{ color }}>{displayValue}{unit}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: `${color}15`, color }}>{status}</span>
      </div>
    </div>
  );
}

function truncateUrl(url: string, maxLen = 40): string {
  const clean = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen) + "…";
}

// ===== Finding status styling =====
// `warning` is visually distinct from `opportunity` on purpose: a deliberate
// configuration (an intentional noindex, a restricted robots path) shouldn't be
// presented in the same red as a genuine gap.
const STATUS_STYLES: Record<CheckStatus, { label: string; text: string; bg: string; border: string; dot: string }> = {
  good: { label: "Good", text: "#047857", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.25)", dot: "#10b981" },
  warning: { label: "Warning", text: "#b45309", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", dot: "#f59e0b" },
  opportunity: { label: "Opportunity", text: "#b91c1c", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.25)", dot: "#ef4444" },
};

function StatusPill({ status }: { status: CheckStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0"
      style={{ backgroundColor: s.bg, color: s.text, boxShadow: `inset 0 0 0 1px ${s.border}` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.dot }} />
      {s.label}
    </span>
  );
}

/**
 * A single finding rendered in the doc's four-part format:
 * name → Detected → Why it matters → Opportunity.
 */
function FindingRow({ check, index, showRank }: { check: Check; index: number; showRank: boolean }) {
  const s = STATUS_STYLES[check.status];
  return (
    <div className={`py-4 ${index > 0 ? "border-t" : ""}`} style={index > 0 ? { borderColor: "rgba(0,0,0,0.06)" } : undefined}>
      <div className="flex items-start gap-3">
        <span className="text-base mt-0.5 flex-shrink-0">{check.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold" style={{ color: s.text }}>{check.label}</p>
            <StatusPill status={check.status} />
            {showRank && index === 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-800 text-white uppercase tracking-wider">
                Start Here
              </span>
            )}
          </div>
          <p className="text-[13px] text-gray-700 mt-1.5 leading-relaxed">
            <span className="font-semibold text-gray-500">Detected: </span>{check.detail}
          </p>
          {check.impact && (
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              <span className="font-semibold">Why it matters: </span>{check.impact}
            </p>
          )}
          {check.fix && (
            <div className="mt-2.5 flex items-start gap-1.5">
              <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: s.dot }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
              <p className="text-xs font-medium text-gray-600">
                <span className="font-semibold">Opportunity: </span>{check.fix}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Group findings under their section headings, in the order the service type defines. */
function CategorySection({
  title,
  checks,
  categoryOrder,
  showCategories,
  showRank,
}: {
  title: string;
  checks: Check[];
  categoryOrder: readonly string[];
  showCategories: boolean;
  showRank: boolean;
}) {
  if (checks.length === 0) return null;

  const grouped = categoryOrder
    .map((cat) => ({ cat, items: checks.filter((c) => c.category === cat) }))
    .filter((g) => g.items.length > 0);

  // Anything with an unrecognised category still gets rendered rather than dropped.
  const known = new Set(categoryOrder);
  const orphans = checks.filter((c) => !known.has(c.category));
  if (orphans.length > 0) grouped.push({ cat: "Other", items: orphans });

  let runningIndex = 0;

  return (
    <div className="space-y-0">
      {grouped.map(({ cat, items }) => (
        <div key={cat}>
          {showCategories && (
            <div className="flex items-center gap-2 pt-4 pb-1 first:pt-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{cat}</p>
              <div className="flex-1 h-px bg-gray-200" />
              <p className="text-[10px] font-semibold text-gray-300">{items.length}</p>
            </div>
          )}
          {items.map((check) => {
            const idx = runningIndex++;
            return <FindingRow key={`${cat}-${check.label}`} check={check} index={idx} showRank={showRank} />;
          })}
        </div>
      ))}
      {/* title is used for a11y grouping only; the visual heading lives in the parent card */}
      <span className="sr-only">{title}</span>
    </div>
  );
}

// ===== Tracking Stack Breakdown (digital marketing) =====
function TrackingRow({ label, present }: { label: string; present: boolean | null }) {
  if (present === null) return null;
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-gray-600">{label}</span>
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold"
        style={present
          ? { backgroundColor: "rgba(16,185,129,0.12)", color: "#059669" }
          : { backgroundColor: "rgba(148,163,184,0.15)", color: "#94a3b8" }}
        aria-label={present ? "Detected" : "Not detected"}
      >
        {present ? "✓" : "–"}
      </span>
    </div>
  );
}

function TrackingStackPanel({ s }: { s: AuditSignals }) {
  // Only render once the deeper marketing signals exist — a lead enriched before this
  // analysis shipped would otherwise show an all-blank grid.
  if (s.hasTagManager === null && s.hasClarity === null && s.hasMicrosoftUET === null) return null;

  const retargetingPlatforms = s.techByCategory?.retargeting || [];
  const anyRetargeting = !!(s.hasRetargeting || s.hasFacebookPixel);

  const groups: { title: string; rows: { label: string; present: boolean | null }[] }[] = [
    {
      title: "Analytics",
      rows: [
        { label: "Google Analytics", present: s.hasAnalytics },
        { label: "Tag Manager", present: s.hasTagManager },
        { label: "Microsoft Clarity", present: s.hasClarity },
        { label: "Hotjar", present: s.hasHotjar },
      ],
    },
    {
      title: "Advertising",
      rows: [
        { label: "Google Ads tracking", present: s.hasGoogleAds },
        { label: "Meta Pixel", present: s.hasFacebookPixel },
        { label: "Microsoft Ads UET", present: s.hasMicrosoftUET },
      ],
    },
    {
      title: "Retargeting",
      rows: [
        { label: retargetingPlatforms.length > 0 ? retargetingPlatforms.slice(0, 2).join(", ") : "Retargeting pixels", present: anyRetargeting },
      ],
    },
    {
      title: "Automation",
      rows: [
        { label: "Marketing automation", present: s.hasHubSpot },
        { label: "Email platform", present: s.hasEmailMarketing },
        { label: "Live chat", present: s.hasLiveChat },
      ],
    },
  ];

  return (
    <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
          <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        </div>
        <p className="text-sm font-bold text-gray-900">Tracking Stack</p>
      </div>
      <p className="text-xs text-gray-400 mb-4 ml-9">What we could and could not detect in the page source</p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 pb-1 border-b border-gray-100">{g.title}</p>
            {g.rows.map((r) => <TrackingRow key={r.label} label={r.label} present={r.present} />)}
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-gray-400 leading-relaxed">
        A dash means the tool was not detected in the HTML we analyzed — it does not confirm the business isn&apos;t using it elsewhere.
      </p>
    </div>
  );
}

// ===== Funnel Readiness (digital marketing) =====
function FunnelReadinessPanel({ checks }: { checks: Check[] }) {
  const stages = MARKETING_CATEGORIES.map((cat) => {
    const items = checks.filter((c) => c.category === cat);
    const passed = items.filter((c) => c.status === "good").length;
    return { cat, passed, total: items.length };
  }).filter((s) => s.total > 0);

  if (stages.length === 0) return null;

  return (
    <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <p className="text-sm font-bold text-gray-900 mb-1">Funnel Readiness</p>
      <p className="text-xs text-gray-400 mb-5">How complete each stage of the customer journey looks from the outside</p>
      <div className="space-y-4">
        {stages.map(({ cat, passed, total }) => {
          const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
          const color = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
          return (
            <div key={cat}>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-semibold text-gray-700">{cat}</span>
                <span className="text-xs font-bold" style={{ color }}>{passed}/{total}</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== Technical SEO snapshot =====
function StatTile({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "neutral" }) {
  const color = tone === "good" ? "#059669" : tone === "bad" ? "#dc2626" : "#334155";
  const bg = tone === "good" ? "rgba(16,185,129,0.06)" : tone === "bad" ? "rgba(239,68,68,0.06)" : "rgba(148,163,184,0.08)";
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: bg }}>
      <p className="text-base font-extrabold leading-tight" style={{ color }}>{value}</p>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

function SeoSnapshotPanel({ s }: { s: AuditSignals }) {
  if (s.hasRobotsTxt === null && s.hasSitemap === null && s.pagesAnalyzed === null) return null;

  const tiles: { label: string; value: string; tone: "good" | "bad" | "neutral" }[] = [];

  if (s.pagesAnalyzed !== null) tiles.push({ label: "Pages Analyzed", value: String(s.pagesAnalyzed), tone: "neutral" });
  if (s.hasRobotsTxt !== null) tiles.push({ label: "robots.txt", value: s.hasRobotsTxt ? "Found" : "None", tone: s.hasRobotsTxt ? "good" : "bad" });
  if (s.hasSitemap !== null) {
    tiles.push({
      label: "Sitemap",
      value: s.hasSitemap ? (s.sitemapUrlCount ? `${s.sitemapUrlCount} URLs` : "Found") : "None",
      tone: s.hasSitemap ? "good" : "bad",
    });
  }
  if (s.redirectsToHttps !== null) tiles.push({ label: "HTTP → HTTPS", value: s.redirectsToHttps ? "Redirects" : "No redirect", tone: s.redirectsToHttps ? "good" : "bad" });
  if (s.hasCanonical !== null) tiles.push({ label: "Canonical", value: s.hasCanonical ? "Present" : "Missing", tone: s.hasCanonical ? "good" : "bad" });
  if (s.isIndexable !== null) tiles.push({ label: "Indexable", value: s.isIndexable ? "Yes" : "Noindex", tone: s.isIndexable ? "good" : "bad" });
  if (s.altTextCoverage !== null && (s.imageCount ?? 0) > 0) {
    tiles.push({ label: "Alt Coverage", value: `${s.altTextCoverage}%`, tone: s.altTextCoverage >= 80 ? "good" : "bad" });
  }
  if (s.wordCount !== null) tiles.push({ label: "Words on Page", value: String(s.wordCount), tone: s.isThinContent ? "bad" : "good" });
  if (s.checkedLinkCount !== null && s.checkedLinkCount > 0) {
    tiles.push({
      label: "Broken Links",
      value: `${s.brokenInternalLinks.length}/${s.checkedLinkCount}`,
      tone: s.brokenInternalLinks.length === 0 ? "good" : "bad",
    });
  }
  if (s.h1Count !== null) tiles.push({ label: "H1 Headings", value: String(s.h1Count), tone: s.h1Count === 1 ? "good" : "bad" });
  if (s.schemaTypes.length > 0) tiles.push({ label: "Schema Types", value: String(s.schemaTypes.length), tone: "good" });
  if (s.titleLength !== null && s.titleLength > 0) {
    tiles.push({ label: "Title Length", value: `${s.titleLength}`, tone: s.titleLength >= 30 && s.titleLength <= 60 ? "good" : "bad" });
  }

  if (tiles.length === 0) return null;

  return (
    <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <p className="text-sm font-bold text-gray-900 mb-1">Technical Snapshot</p>
      <p className="text-xs text-gray-400 mb-4">Measured directly from the site during this analysis</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
        {tiles.map((t) => <StatTile key={t.label} {...t} />)}
      </div>
      {s.schemaTypes.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Structured Data Types Found</p>
          <div className="flex flex-wrap gap-1.5">
            {s.schemaTypes.slice(0, 12).map((t) => (
              <span key={t} className="px-2 py-1 rounded-md text-[11px] font-semibold bg-violet-50 text-violet-700 ring-1 ring-violet-200">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Website snapshot — the web-dev counterpart to SEO's Technical Snapshot.
 *
 * The web-dev report was the only one of the three with no at-a-glance panel, which made it
 * read as the thinnest even once it had 13 findings. Every tile here is a raw measurement
 * taken during the crawl, chosen for what a developer would actually be asked to fix.
 */
function WebsiteSnapshotPanel({ s }: { s: AuditSignals }) {
  const tiles: { label: string; value: string; tone: "good" | "bad" | "neutral" }[] = [];

  if (s.pagesAnalyzed !== null) tiles.push({ label: "Pages Analyzed", value: String(s.pagesAnalyzed), tone: "neutral" });
  if (s.hasSSL !== null) tiles.push({ label: "SSL", value: s.hasSSL ? "Active" : "Missing", tone: s.hasSSL ? "good" : "bad" });
  if (s.redirectsToHttps !== null) tiles.push({ label: "HTTP → HTTPS", value: s.redirectsToHttps ? "Redirects" : "No redirect", tone: s.redirectsToHttps ? "good" : "bad" });
  if (s.isMobileFriendly !== null) tiles.push({ label: "Mobile Viewport", value: s.isMobileFriendly ? "Set" : "Missing", tone: s.isMobileFriendly ? "good" : "bad" });
  if (s.pageSizeKB !== null && s.pageSizeKB > 0) {
    tiles.push({
      label: "Homepage Weight",
      value: s.pageSizeKB > 1024 ? `${(s.pageSizeKB / 1024).toFixed(1)} MB` : `${s.pageSizeKB} KB`,
      tone: s.pageSizeKB > 2048 ? "bad" : "good",
    });
  }
  if (s.pageSpeed?.mobile) {
    tiles.push({
      label: "Content Appears",
      value: `${(s.pageSpeed.mobile.largestContentfulPaint / 1000).toFixed(1)}s`,
      tone: s.pageSpeed.mobile.largestContentfulPaint > 2500 ? "bad" : "good",
    });
  } else if (s.pageLoadTimeMs !== null) {
    tiles.push({ label: "Server Response", value: `${(s.pageLoadTimeMs / 1000).toFixed(1)}s`, tone: s.pageLoadTimeMs > 3000 ? "bad" : "good" });
  }
  if (s.checkedLinkCount !== null && s.checkedLinkCount > 0) {
    tiles.push({
      label: "Broken Links",
      value: `${s.brokenInternalLinks.length}/${s.checkedLinkCount}`,
      tone: s.brokenInternalLinks.length === 0 ? "good" : "bad",
    });
  }
  if (s.altTextCoverage !== null && (s.imageCount ?? 0) > 0) {
    tiles.push({ label: "Image Alt Text", value: `${s.altTextCoverage}%`, tone: s.altTextCoverage >= 80 ? "good" : "bad" });
  }
  if (s.pageSpeed?.mobile) {
    tiles.push({ label: "Accessibility", value: `${s.pageSpeed.mobile.accessibilityScore}/100`, tone: s.pageSpeed.mobile.accessibilityScore >= 90 ? "good" : "bad" });
    tiles.push({ label: "Layout Shift", value: s.pageSpeed.mobile.cumulativeLayoutShift.toFixed(2), tone: s.pageSpeed.mobile.cumulativeLayoutShift > 0.1 ? "bad" : "good" });
  }
  if (s.hasContactForm !== null && !s.isSPA) tiles.push({ label: "Contact Form", value: s.hasContactForm ? "Found" : "None", tone: s.hasContactForm ? "good" : "bad" });
  if (s.hasOnlineBooking !== null && !s.isSPA) tiles.push({ label: "Online Booking", value: s.hasOnlineBooking ? "Found" : "None", tone: s.hasOnlineBooking ? "good" : "bad" });

  if (tiles.length < 4) return null;

  return (
    <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <p className="text-sm font-bold text-gray-900 mb-1">Website Snapshot</p>
      <p className="text-xs text-gray-400 mb-4">Measured directly from the site during this analysis</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
        {tiles.map((t) => <StatTile key={t.label} {...t} />)}
      </div>
      {s.technologies.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Platform &amp; Technologies Detected</p>
          <div className="flex flex-wrap gap-1.5">
            {s.technologies.slice(0, 12).map((t) => (
              <span key={t} className="px-2 py-1 rounded-md text-[11px] font-semibold bg-violet-50 text-violet-700 ring-1 ring-violet-200">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Marketing technology inventory =====
function MarketingStackPanel({ s }: { s: AuditSignals }) {
  const tech = s.marketingTechnologies;
  if (!tech || tech.length === 0) return null;
  return (
    <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <p className="text-sm font-bold text-gray-900 mb-1">Marketing Tools Detected</p>
      <p className="text-xs text-gray-400 mb-3">{tech.length} tool{tech.length === 1 ? "" : "s"} identified from the page source</p>
      <div className="flex flex-wrap gap-2">
        {tech.map((t) => (
          <span key={t} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">{t}</span>
        ))}
      </div>
    </div>
  );
}

export default function AuditReportPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /*
    Load the report, then keep asking until Google's numbers arrive.

    A Lighthouse pair takes 30–90s and is deliberately never awaited inside a request, so the
    first response for a fresh report legitimately has no `pageSpeed`. A single fetch therefore
    rendered a report with no gauges, no Core Web Vitals and a composite score missing its
    performance components — indistinguishable, to the reader, from the feature being broken.

    So: poll while the server says a run is in flight. The interval is long because the work is
    long; the cap exists so a stuck run can't leave the tab requesting forever. Each poll
    replaces the whole payload, which is safe — every field is server-derived.
  */
  useEffect(() => {
    if (!token) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const POLL_MS = 8000;
    // ~5 minutes. Measured against the live Google API a four-category run takes 30–95s, and
    // a strategy that times out is retried once — so the realistic worst case is well past
    // three minutes. The cap only exists so a wedged run can't leave the tab polling forever.
    const MAX_POLLS = 38;

    const load = (attempt: number) => {
      fetch(`${apiUrl}/audit/${token}`)
        .then((res) => {
          if (!res.ok) throw new Error("Report not found");
          return res.json();
        })
        .then((d: AuditData) => {
          if (cancelled) return;
          setData(d);
          setLoading(false);

          if (attempt === 0) {
            // Track view (fire-and-forget — don't block page render)
            fetch(`${apiUrl}/audit/${token}/view`, { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => {});
          }

          const stillWaiting = d.pageSpeedPending && !d.signals?.pageSpeed;
          if (stillWaiting && attempt < MAX_POLLS) {
            timer = setTimeout(() => load(attempt + 1), POLL_MS);
          }
        })
        .catch(() => {
          if (cancelled) return;
          // A failed POLL must not blow away a report that already rendered.
          if (attempt === 0) setError("This audit report was not found or has expired.");
          setLoading(false);
        });
    };

    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  const [loadingSlow, setLoadingSlow] = useState(false);

  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => setLoadingSlow(true), 5000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400 font-medium">Loading report&hellip;</p>
          {loadingSlow && (
            <p className="text-xs text-gray-300 mt-1">Analyzing website data — this may take a moment</p>
          )}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/50 p-10 max-w-sm text-center border border-gray-100">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <h1 className="text-lg font-bold text-gray-900 mb-2">Report Not Found</h1>
          <p className="text-sm text-gray-500 leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  const s = data.signals;
  const currentYear = new Date().getFullYear();
  const industry = data.industry || "Local Business";
  const serviceType = data.serviceType || "web_dev";
  const isMarketing = serviceType === "digital_marketing" || serviceType === "social_media";
  const isSeo = serviceType === "seo";

  // Build findings for the service type this report was generated for.
  const checks: Check[] = isMarketing
    ? buildMarketingChecks(s, industry)
    : isSeo
    ? buildSeoChecks(s, industry)
    : buildWebDevChecks(s, industry, currentYear);

  const categoryOrder: readonly string[] = isMarketing
    ? MARKETING_CATEGORIES
    : isSeo
    ? SEO_CATEGORIES
    : WEB_DEV_CATEGORIES;

  // Web dev uses a single category, so its section headers are suppressed and the
  // report renders as the flat list it always has.
  const showCategories = categoryOrder.length > 1;

  const passChecks = checks.filter((c) => c.status === "good");
  // Most severe first so the reader hits the consequential findings before the polish.
  const failChecks = checks
    .filter((c) => c.status !== "good")
    .sort((a, b) => b.severity - a.severity);

  // ===== Health score =====
  // Derived from the checks THIS report actually renders, weighted by each check's severity.
  //
  // It used to be `100 - lead.score`, where lead.score is the internal sales-opportunity
  // score. That number rewards a business looking easy to sell to (+20 for running
  // WordPress, +25 for no booking widget, +5 for having under 10 Google reviews), it
  // saturates at 100 so healthy sites rendered as 0/100 "F", and it is identical for all
  // three service types — an SEO report was scored on web-dev signals. The result was a
  // report that argued with itself: "20 of 21 checks passed" above a red F.
  //
  // Now: every rendered check contributes its severity to the denominator and, if it failed,
  // to the deduction. The score can only disagree with the list if the list is wrong.
  // Our own checks, severity-weighted, with continuous measures counted proportionally.
  const checksScore = (() => {
    const weighted = checks.filter((c) => c.severity > 0 && !c.excludeFromScore);
    if (weighted.length === 0) return null;
    const total = weighted.reduce((sum, c) => sum + c.severity, 0);
    const earned = weighted.reduce((sum, c) => {
      const ratio = c.ratio !== undefined ? Math.max(0, Math.min(1, c.ratio)) : c.status === "good" ? 1 : 0;
      return sum + c.severity * ratio;
    }, 0);
    return Math.round(100 * (earned / total));
  })();

  // ===== Composite score =====
  // Lighthouse carries real weight here for one reason: those are Google's numbers, published
  // at pagespeed.web.dev, and a reader can reproduce them in ten seconds. Our own checks are
  // mostly technical hygiene that any competently built site passes, which is why a
  // checks-only score clustered in the 90s and told the reader nothing worth acting on.
  //
  // The weights are NOT tuned to force a low result. They are set by how much each component
  // reflects whether the site earns the business enquiries, and the arithmetic is printed
  // under the ring so the reader can audit it. Typical small-business sites land in the 45–70
  // band because mobile performance across that market genuinely is poor; a genuinely good
  // site still scores 90+.
  const lhMobile = s.pageSpeed?.mobile;
  const lhDesktop = s.pageSpeed?.desktop;
  const lhQuality = lhMobile
    ? Math.round((lhMobile.seoScore + lhMobile.accessibilityScore + lhMobile.bestPracticesScore) / 3)
    : null;

  const scoreComponents: { key: string; label: string; value: number; weight: number; note: string }[] = [];
  if (checksScore !== null) {
    scoreComponents.push({
      key: "checks",
      label: isMarketing ? "Marketing setup checks" : isSeo ? "SEO checks" : "Website checks",
      value: checksScore,
      weight: isMarketing ? 0.7 : 0.45,
      note: `${checks.filter((c) => !c.excludeFromScore).length} checks on this site`,
    });
  }
  if (lhMobile) {
    scoreComponents.push({
      key: "lh-mobile",
      label: "Google mobile performance",
      value: lhMobile.performanceScore,
      weight: isMarketing ? 0.2 : 0.3,
      note: "Lighthouse, mobile",
    });
  }
  if (lhDesktop) {
    scoreComponents.push({
      key: "lh-desktop",
      label: "Google desktop performance",
      value: lhDesktop.performanceScore,
      weight: 0.1,
      note: "Lighthouse, desktop",
    });
  }
  if (lhQuality !== null && !isMarketing) {
    scoreComponents.push({
      key: "lh-quality",
      label: "Google SEO, accessibility & best practices",
      value: lhQuality,
      weight: 0.15,
      note: "Lighthouse average",
    });
  }

  // How many checks actually contributed. A score built on one or two measurements is not a
  // score — a lead with almost no stored signals would otherwise render "0/100 · F · Needs
  // Immediate Attention" off the back of a single failed check, which is precisely the kind of
  // unsupported verdict this report is not allowed to make.
  const scoredCheckCount = checks.filter((c) => c.severity > 0 && !c.excludeFromScore).length;
  const MIN_CHECKS_TO_SCORE = 6;
  const hasEnoughToScore = scoredCheckCount >= MIN_CHECKS_TO_SCORE;

  const healthScore = (() => {
    // A site we could not reach, or one that is genuinely parked, has no meaningful checks to
    // score; the banner above the ring carries that message and the score stays low.
    if (s._siteDown || s.isParkedDomain) return 10;
    if (scoreComponents.length === 0) return Math.max(0, Math.min(100, 100 - data.score));
    // Renormalise across whatever components exist, so a lead without Lighthouse data isn't
    // silently penalised for our missing measurement.
    const weightSum = scoreComponents.reduce((sum, c) => sum + c.weight, 0);
    const composite = scoreComponents.reduce((sum, c) => sum + c.value * (c.weight / weightSum), 0);
    return Math.max(0, Math.min(100, Math.round(composite)));
  })();

  const localMarket = data.localMarket ?? null;
  const myReviews = s.googleReviewCount ?? 0;

  const issuesHeading = showCategories ? "What Needs Attention" : "What Needs Fixing";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero — matches app dashboard dark gradient */}
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #2a2158 100%)" }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl" style={{ background: "rgba(105,98,196,0.15)" }} />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full blur-3xl" style={{ background: "rgba(167,139,250,0.1)" }} />
        </div>

        <div className="relative max-w-xl mx-auto px-5 pt-10 pb-8 text-center">
          {/* Brand */}
          <div className="flex justify-center mb-2">
            <img src="/images/logo-3.png" alt="Inertia Leads" className="h-14" />
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <svg className="w-4 h-4" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "rgba(196,181,253,0.85)" }}>
            {isMarketing
              ? "Digital Marketing Audit"
              : isSeo
              ? "SEO & Visibility Audit"
              : "Website Audit Report"}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white capitalize tracking-tight leading-tight">
            {data.company}
          </h1>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 mt-3">
            {data.website && (
              <a href={data.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-violet-300 hover:bg-white/15 transition-colors" style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(196,181,253,0.25)" }} title={data.website}>
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                {truncateUrl(data.website)}
              </a>
            )}
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-violet-300 capitalize" style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(196,181,253,0.25)" }}>
              {data.industry}
            </span>
          </div>

          <p className="text-[11px] text-white/30 mt-4">Report generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-5 -mt-1">
        {/* Executive Summary */}
        <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </div>
            <p className="text-sm font-bold text-gray-900">Executive Summary</p>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            We analyzed <span className="font-semibold text-gray-900">{data.company}</span>&apos;s online presence across {checks.length} checks
            {s.pagesAnalyzed && s.pagesAnalyzed > 1 ? ` on ${s.pagesAnalyzed} pages` : ""}
            {showCategories ? `, grouped into ${categoryOrder.length} areas` : ""}.
          </p>
          {failChecks.length > 0 && (
            <p className="text-sm text-gray-600 leading-relaxed mt-3">
              <span className="font-semibold text-red-700">{failChecks.length} {failChecks.length === 1 ? "finding" : "findings"} may be worth addressing</span>
              {passChecks.length > 0 ? `, and ${passChecks.length} ${passChecks.length === 1 ? "check" : "checks"} passed.` : "."}
              {" "}Each one below states what we detected, why it matters, and what could be improved.
            </p>
          )}
          {data.opportunity && (
            <div className="mt-4 px-4 py-3 bg-amber-50 rounded-xl border border-amber-200">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-1">Opportunity</p>
              <p className="text-sm text-amber-700 leading-relaxed">{data.opportunity}</p>
            </div>
          )}
        </div>

        {/* Critical alert */}
        {(s._siteDown || s.isParkedDomain) && (
          <div className="mt-6 rounded-2xl p-5 bg-rose-50 border-2 border-rose-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <div>
                <p className="text-sm font-bold text-rose-800">
                  {s._siteDown ? "Website is Down or Unreachable" : "Domain is Parked / Under Construction"}
                </p>
                <p className="text-xs text-rose-600 mt-1 leading-relaxed">
                  Customers searching for your business cannot find a working website. Every potential customer goes to a competitor.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Score card */}
        <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 pt-8 pb-6 flex flex-col items-center">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-5">
              {isMarketing
                ? "Marketing Readiness Score"
                : isSeo
                ? "SEO Health Score"
                : "Digital Health Score"}
            </p>
            {hasEnoughToScore ? (
              <ScoreRing healthScore={healthScore} />
            ) : (
              <div className="text-center max-w-sm">
                <p className="text-2xl font-extrabold text-gray-400">Not enough data</p>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  Only {scoredCheckCount} {scoredCheckCount === 1 ? "measurement" : "measurements"} could be taken from this site, which is too few to give it a fair score. The individual findings below are still accurate.
                </p>
              </div>
            )}
          </div>

          {/*
            How the score is built. This is not decoration — a composite of 63 sitting above
            "18 of 21 checks passed" reads as a contradiction unless the reader can see that
            Google rates mobile performance at 38 and that it carries 30% of the weight. Every
            row here is a number the reader can reproduce themselves.
          */}
          {hasEnoughToScore && scoreComponents.length > 1 && (
            <div className="border-t border-gray-100 px-6 py-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">How this score is calculated</p>
              <div className="space-y-2.5">
                {scoreComponents.map((c) => {
                  const band = scoreBand(c.value);
                  return (
                    <div key={c.key} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-700 truncate">{c.label}</span>
                          <span className="text-xs font-bold tabular-nums" style={{ color: band.color }}>{c.value}<span className="text-gray-400 font-medium">/100</span></span>
                        </div>
                        <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${c.value}%`, backgroundColor: band.color }} />
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-gray-400 tabular-nums w-9 text-right">{Math.round(c.weight * 100)}%</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
                Percentages show how much each component contributes. Performance figures come from Google Lighthouse and can be reproduced at pagespeed.web.dev.
              </p>
            </div>
          )}

          <div className="border-t border-gray-100 bg-gray-50/80 px-6 py-4">
            <div className="grid grid-cols-3 divide-x divide-gray-200 text-center">
              <div className="px-2">
                <p className="text-xl font-extrabold text-red-600">{failChecks.length}</p>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">Findings</p>
              </div>
              <div className="px-2">
                <p className="text-xl font-extrabold text-emerald-600">{passChecks.length}</p>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">Passed</p>
              </div>
              <div className="px-2">
                <p className="text-xl font-extrabold text-gray-800">{checks.length}</p>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">Checked</p>
              </div>
            </div>
          </div>
        </div>

        {/* Funnel readiness — digital marketing only */}
        {isMarketing && <FunnelReadinessPanel checks={checks} />}

        {/* Technical snapshot — SEO only */}
        {isSeo && <SeoSnapshotPanel s={s} />}

        {/* Web dev had no at-a-glance panel at all — this is its equivalent. */}
        {!isSeo && !isMarketing && <WebsiteSnapshotPanel s={s} />}

        {/*
          Lighthouse is still running. Shown INSTEAD of silently omitting the section, because
          an absent Performance panel reads as "they didn't check" rather than "the numbers are
          thirty seconds away". The page polls and swaps this for the real gauges.
        */}
        {data.pageSpeedPending && !(s.pageSpeed?.mobile || s.pageSpeed?.desktop) && (
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex items-center gap-4">
            <div className="w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <div>
              <p className="text-sm font-bold text-gray-900">Measuring performance with Google Lighthouse&hellip;</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                Google is loading {data.company}&rsquo;s site on a simulated mobile connection. This takes up to a minute and will appear here automatically.
              </p>
            </div>
          </div>
        )}

        {/* Google Lighthouse Score — shown for all three report types */}
        {s.pageSpeed && (s.pageSpeed.mobile || s.pageSpeed.desktop) && (
          <div className="mt-6">
            {/* Section Header */}
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                <svg className="w-4.5 h-4.5 text-indigo-600" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
              </div>
              <div>
                <p className="text-base font-bold text-gray-900">Google Lighthouse Score</p>
                <p className="text-xs text-gray-400">Powered by PageSpeed Insights — same as Chrome DevTools</p>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0cce6b]" />
                <span className="text-[11px] text-gray-500 font-medium">90–100 Good</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ffa400]" />
                <span className="text-[11px] text-gray-500 font-medium">50–89 Needs Work</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff4e42]" />
                <span className="text-[11px] text-gray-500 font-medium">0–49 Poor</span>
              </div>
            </div>

            {/* Desktop Card */}
            {s.pageSpeed.desktop && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-4">
                <div className="px-6 pt-5 pb-1">
                  <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <span className="text-base">💻</span> Desktop
                  </p>
                </div>

                {/* 4 Category Gauges */}
                <div className="px-6 py-4">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="flex flex-col items-center">
                      <LighthouseGauge score={s.pageSpeed.desktop.performanceScore} size={72} />
                      <p className="mt-2 text-[11px] font-semibold text-gray-700 text-center">Performance</p>
                    </div>
                    <div className="flex flex-col items-center">
                      <LighthouseGauge score={s.pageSpeed.desktop.accessibilityScore} size={72} />
                      <p className="mt-2 text-[11px] font-semibold text-gray-700 text-center">Accessibility</p>
                    </div>
                    <div className="flex flex-col items-center">
                      <LighthouseGauge score={s.pageSpeed.desktop.bestPracticesScore} size={72} />
                      <p className="mt-2 text-[11px] font-semibold text-gray-700 text-center">Best Practices</p>
                    </div>
                    <div className="flex flex-col items-center">
                      <LighthouseGauge score={s.pageSpeed.desktop.seoScore} size={72} />
                      <p className="mt-2 text-[11px] font-semibold text-gray-700 text-center">SEO</p>
                    </div>
                  </div>
                </div>

                {/* Performance Diagnostics */}
                <div className="border-t border-gray-100 px-6 py-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Core Web Vitals</p>
                  <div>
                    <LighthouseMetricRow
                      label="First Contentful Paint"
                      value={s.pageSpeed.desktop.firstContentfulPaint}
                      unit="s"
                      threshold={{ good: 1800, poor: 3000 }}
                    />
                    <LighthouseMetricRow
                      label="Largest Contentful Paint"
                      value={s.pageSpeed.desktop.largestContentfulPaint}
                      unit="s"
                      threshold={{ good: 2500, poor: 4000 }}
                    />
                    <LighthouseMetricRow
                      label="Total Blocking Time"
                      value={s.pageSpeed.desktop.totalBlockingTime}
                      unit="s"
                      threshold={{ good: 200, poor: 600 }}
                    />
                    <LighthouseMetricRow
                      label="Cumulative Layout Shift"
                      value={s.pageSpeed.desktop.cumulativeLayoutShift}
                      unit=""
                      threshold={{ good: 0.1, poor: 0.25 }}
                    />
                    <LighthouseMetricRow
                      label="Speed Index"
                      value={s.pageSpeed.desktop.speedIndex}
                      unit="s"
                      threshold={{ good: 3400, poor: 5800 }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Mobile Card */}
            {s.pageSpeed.mobile && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 pt-5 pb-1">
                  <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <span className="text-base">📱</span> Mobile
                  </p>
                </div>

                {/* 4 Category Gauges */}
                <div className="px-6 py-4">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="flex flex-col items-center">
                      <LighthouseGauge score={s.pageSpeed.mobile.performanceScore} size={72} />
                      <p className="mt-2 text-[11px] font-semibold text-gray-700 text-center">Performance</p>
                    </div>
                    <div className="flex flex-col items-center">
                      <LighthouseGauge score={s.pageSpeed.mobile.accessibilityScore} size={72} />
                      <p className="mt-2 text-[11px] font-semibold text-gray-700 text-center">Accessibility</p>
                    </div>
                    <div className="flex flex-col items-center">
                      <LighthouseGauge score={s.pageSpeed.mobile.bestPracticesScore} size={72} />
                      <p className="mt-2 text-[11px] font-semibold text-gray-700 text-center">Best Practices</p>
                    </div>
                    <div className="flex flex-col items-center">
                      <LighthouseGauge score={s.pageSpeed.mobile.seoScore} size={72} />
                      <p className="mt-2 text-[11px] font-semibold text-gray-700 text-center">SEO</p>
                    </div>
                  </div>
                </div>

                {/* Performance Diagnostics */}
                <div className="border-t border-gray-100 px-6 py-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Core Web Vitals</p>
                  <div>
                    <LighthouseMetricRow
                      label="First Contentful Paint"
                      value={s.pageSpeed.mobile.firstContentfulPaint}
                      unit="s"
                      threshold={{ good: 1800, poor: 3000 }}
                    />
                    <LighthouseMetricRow
                      label="Largest Contentful Paint"
                      value={s.pageSpeed.mobile.largestContentfulPaint}
                      unit="s"
                      threshold={{ good: 2500, poor: 4000 }}
                    />
                    <LighthouseMetricRow
                      label="Total Blocking Time"
                      value={s.pageSpeed.mobile.totalBlockingTime}
                      unit="s"
                      threshold={{ good: 200, poor: 600 }}
                    />
                    <LighthouseMetricRow
                      label="Cumulative Layout Shift"
                      value={s.pageSpeed.mobile.cumulativeLayoutShift}
                      unit=""
                      threshold={{ good: 0.1, poor: 0.25 }}
                    />
                    <LighthouseMetricRow
                      label="Speed Index"
                      value={s.pageSpeed.mobile.speedIndex}
                      unit="s"
                      threshold={{ good: 3400, poor: 5800 }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Context note */}
            <p className="mt-3 text-[11px] text-gray-400 text-center">
              Scores from Google Lighthouse — the same tool used in Chrome DevTools and by Google to evaluate page quality for search rankings
            </p>
          </div>
        )}

        {/* Tracking stack — digital marketing only */}
        {isMarketing && <TrackingStackPanel s={s} />}

        {/*
          The "How You Compare" benchmark and the "Estimated Monthly Impact" range both used to
          sit here. Removed deliberately:

          * The benchmark averaged `100 - opportunity_score` across our own prospect list — a
            set selected BECAUSE those businesses looked weak — and called it "the average
            business". It also can no longer be compared to the score above, which is now
            derived from this report's own checks rather than that scale.
          * The impact range was `min(8, significant findings) x 8` to `x 15`. We hold no
            traffic data for these sites, so it was arithmetic on our own check count printed
            as a revenue forecast — the single least defensible number in the report.

          What replaces them is a breakdown of the findings we can actually stand behind.
        */}
        {/*
          Local market position. Replaces the removed "average business" benchmark with the
          real thing: Google's own review counts for the other businesses in the same trade
          and the same city, from the same searches that found this one. A business owner can
          verify every figure by searching their own trade in their own town, and the peers
          are competitors they know by name — which is why this lands harder than any score.
        */}
        {localMarket && localMarket.peerCount >= 5 && (
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-bold text-gray-900">Your Position in {localMarket.location}</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Compared with {localMarket.peerCount} other {localMarket.niche.toLowerCase()} businesses in {localMarket.location}, using Google review data.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-semibold text-gray-700">Your Google reviews</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color: myReviews < localMarket.avgReviews ? "#ef4444" : "#10b981" }}>{myReviews}</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (myReviews / Math.max(1, localMarket.topReviews)) * 100)}%`, backgroundColor: myReviews < localMarket.avgReviews ? "#ef4444" : "#10b981" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-semibold text-gray-500">Local average</span>
                  <span className="text-xs font-bold text-gray-400 tabular-nums">{localMarket.avgReviews}</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gray-300" style={{ width: `${Math.min(100, (localMarket.avgReviews / Math.max(1, localMarket.topReviews)) * 100)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-semibold text-gray-500">Best in {localMarket.location}</span>
                  <span className="text-xs font-bold text-gray-400 tabular-nums">{localMarket.topReviews}</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gray-400 w-full" />
                </div>
              </div>
            </div>

            {localMarket.aheadOfYou > 0 && (
              <p className="text-xs text-gray-600 mt-4 leading-relaxed">
                <span className="font-bold text-red-600">{localMarket.aheadOfYou} of {localMarket.peerCount}</span> {localMarket.niche.toLowerCase()} businesses we analyzed in {localMarket.location} have more Google reviews than you.
                {localMarket.avgRating !== null && ` The local average rating is ${localMarket.avgRating}★.`}
                {" "}Review count and rating are among the signals Google weighs for the map results, and they are what a customer checks before calling.
              </p>
            )}
          </div>
        )}

        {/* Core Web Vitals in seconds. "41/100" is abstract; "your main content appears after
            6.2 seconds" is something a business owner can feel — and it's Google's own
            measurement of their own site. */}
        {s.pageSpeed?.mobile && (
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-bold text-gray-900">What a Customer on a Phone Experiences</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Measured by Google Lighthouse on a mobile connection.
            </p>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                {
                  label: "Main content appears",
                  value: `${(s.pageSpeed.mobile.largestContentfulPaint / 1000).toFixed(1)}s`,
                  target: "Google's target: under 2.5s",
                  bad: s.pageSpeed.mobile.largestContentfulPaint > 2500,
                },
                {
                  label: "First content appears",
                  value: `${(s.pageSpeed.mobile.firstContentfulPaint / 1000).toFixed(1)}s`,
                  target: "Google's target: under 1.8s",
                  bad: s.pageSpeed.mobile.firstContentfulPaint > 1800,
                },
                {
                  label: "Layout stability",
                  value: s.pageSpeed.mobile.cumulativeLayoutShift.toFixed(2),
                  target: "Google's target: under 0.10",
                  bad: s.pageSpeed.mobile.cumulativeLayoutShift > 0.1,
                },
              ].map((m) => (
                <div key={m.label} className="rounded-xl p-3" style={{ background: m.bad ? "rgba(239,68,68,0.06)" : "rgba(16,185,129,0.06)" }}>
                  <p className="text-xl font-extrabold tabular-nums" style={{ color: m.bad ? "#ef4444" : "#10b981" }}>{m.value}</p>
                  <p className="text-[11px] font-semibold text-gray-700 mt-0.5 leading-tight">{m.label}</p>
                  <p className="text-[10px] text-gray-400 mt-1 leading-tight">{m.target}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {failChecks.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-bold text-gray-900">Where to Start</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              {failChecks.length} {failChecks.length === 1 ? "finding" : "findings"} from {checks.length} checks, ranked by how much each affects {isMarketing ? "lead capture and measurement" : isSeo ? "search visibility" : "customer trust and conversion"}.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              {[
                { n: failChecks.filter((c) => c.severity >= 3).length, label: "High priority", color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
                { n: failChecks.filter((c) => c.severity === 2).length, label: "Worth fixing", color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
                { n: failChecks.filter((c) => c.severity <= 1).length, label: "Minor polish", color: "#64748b", bg: "rgba(100,116,139,0.08)" },
              ].map((t) => (
                <div key={t.label} className="rounded-xl py-3" style={{ background: t.bg }}>
                  <p className="text-2xl font-extrabold" style={{ color: t.color }}>{t.n}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: t.color }}>{t.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Findings that need attention */}
        {failChecks.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl border-2 border-red-200 p-6">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <p className="text-sm font-bold text-red-900">{issuesHeading}</p>
            </div>
            <p className="text-xs text-gray-400 mb-2 ml-9">Ordered by likely impact — each finding states what we detected and what could be improved</p>
            <CategorySection
              title={issuesHeading}
              checks={failChecks}
              categoryOrder={categoryOrder}
              showCategories={showCategories}
              showRank={!showCategories}
            />
          </div>
        )}

        {/* Passing checks */}
        {passChecks.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl border-2 border-emerald-200 p-6">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-sm font-bold text-emerald-900">What&apos;s Working Well</p>
            </div>
            <p className="text-xs text-gray-400 mb-2 ml-9">Keep these up &mdash; they&apos;re giving you an edge</p>
            <div className="space-y-0">
              {passChecks.map((check, i) => (
                <div key={`${check.category}-${check.label}`} className={`flex items-start gap-3 py-3 ${i > 0 ? "border-t border-emerald-100" : ""}`}>
                  <span className="text-base mt-0.5 flex-shrink-0">{check.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-800">{check.label}</p>
                    <p className="text-[13px] text-emerald-700/60 mt-1 leading-relaxed">{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Marketing technology inventory */}
        {isMarketing && <MarketingStackPanel s={s} />}

        {/* Technologies */}
        {s.technologies.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-bold text-gray-900 mb-3">Technologies Detected</p>
            <div className="flex flex-wrap gap-2">
              {s.technologies.map((tech, i) => (
                <span key={i} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-50 text-violet-700 ring-1 ring-violet-200">
                  {tech}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Bottom line */}
        {failChecks.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-bold text-gray-900 mb-2">The Bottom Line</p>
            <p className="text-sm text-gray-600 leading-relaxed">
              {showCategories
                ? `These ${failChecks.length} findings are all addressable, and most are configuration rather than rebuild work. Fixed in the right order, they compound — the technical foundations make the on-page work count for more.`
                : `Every day these ${failChecks.length} ${failChecks.length === 1 ? "issue goes" : "issues go"} unfixed, potential customers are finding your business online and choosing a competitor instead. The good news: ${failChecks.length === 1 ? "this is" : "these are all"} fixable with the right expertise and a clear plan.`}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-lg font-extrabold text-gray-800">{failChecks.length}</p>
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Addressable {failChecks.length === 1 ? "Finding" : "Findings"}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-lg font-extrabold text-blue-600">Expert</p>
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Help Available</p>
              </div>
            </div>
          </div>
        )}

        {/* Next Steps */}
        {failChecks.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-bold text-gray-900 mb-4">Your Next Steps</p>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-blue-700">1</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Reply to the email</p>
                  <p className="text-xs text-gray-500">We&apos;ll create a priority fix plan specific to your business &mdash; no cost</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-violet-700">2</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Get your fix roadmap</p>
                  <p className="text-xs text-gray-500">We&apos;ll show you exactly what to fix, in what order, and how long each takes</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-emerald-700">3</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Start seeing results</p>
                  <p className="text-xs text-gray-500">We handle everything &mdash; you focus on running your business</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="mt-6 relative overflow-hidden rounded-2xl p-8 text-center" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #2a2158 100%)" }}>
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full blur-3xl" style={{ background: "rgba(105,98,196,0.15)" }} />
            <div className="absolute bottom-0 left-1/4 w-48 h-48 rounded-full blur-3xl" style={{ background: "rgba(167,139,250,0.1)" }} />
          </div>
          <div className="relative z-10">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(196,181,253,0.25)" }}>
              <svg className="w-5 h-5" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </div>
            <h2 className="text-lg font-bold text-white mb-2">
              {failChecks.length > 0 ? "These findings are all addressable." : "Your site is in good shape."}
            </h2>
            <p className="text-sm text-gray-400 leading-relaxed max-w-sm mx-auto">
              {failChecks.length > 0
                ? `Reply to the email that brought you here. We’ll show you exactly what to address first and how long each one takes — no cost for the roadmap.`
                : "If you want to go from good to great, reply to the email that brought you here and we’ll show you how."}
            </p>
          </div>
        </div>

        {/* Methodology — states the limits of what an external scan can conclude */}
        <div className="mt-6 bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">How This Was Produced</p>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            This report is generated automatically by analyzing {s.pagesAnalyzed && s.pagesAnalyzed > 1 ? `${s.pagesAnalyzed} publicly accessible pages` : "the publicly accessible pages"} of {data.website ? truncateUrl(data.website, 60) : "the website"}
            {s.pageSpeed ? ", together with Google PageSpeed Insights data" : ""}.
            Where a tool or feature is described as &ldquo;not detected&rdquo;, it means we did not find evidence of it in the pages we analyzed &mdash; it does not confirm the business isn&apos;t using it. Findings are indicative and worth verifying against the business&apos;s own records.
          </p>
        </div>

        {/* Footer */}
        <div className="text-center py-8">
          <p className="text-[10px] text-gray-300">
            Automated website audit &bull; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
