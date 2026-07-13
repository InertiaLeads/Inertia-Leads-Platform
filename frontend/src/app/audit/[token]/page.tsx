"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface PageSpeedMetrics {
  performanceScore: number;
  accessibilityScore: number;
  bestPracticesScore: number;
  seoScore: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  totalBlockingTime: number;
  cumulativeLayoutShift: number;
  speedIndex: number;
}

interface AuditData {
  company: string;
  website: string;
  industry: string;
  score: number;
  benchmark?: {
    avgHealth: number;
    sampleCount: number;
    scope: "industry" | "all";
    label: string;
  } | null;
  serviceType: string;
  language: string;
  summary: string | null;
  issues: string[];
  opportunity: string | null;
  signals: {
    hasOnlineBooking: boolean | null;
    hasContactForm: boolean | null;
    hasSSL: boolean | null;
    isMobileFriendly: boolean | null;
    hasMetaDescription: boolean | null;
    pageLoadTimeMs: number | null;
    pageSizeKB: number | null;
    copyrightYear: number | null;
    socialLinks: number;
    technologies: string[];
    isParkedDomain: boolean;
    _siteDown: boolean;
    pageSpeed: {
      mobile: PageSpeedMetrics | null;
      desktop: PageSpeedMetrics | null;
    } | null;
    hasGoogleAds: boolean | null;
    hasFacebookPixel: boolean | null;
    hasAnalytics: boolean | null;
    googleRating: number | null;
    googleReviewCount: number | null;
    hasLeadCaptureForm: boolean | null;
    hasOpenGraph: boolean | null;
    hasSchemaMarkup: boolean | null;
    hasEmailMarketing: boolean | null;
    hasCTA: boolean | null;
    hasRetargeting: boolean | null;
  };
}

function ScoreRing({ score }: { score: number }) {
  const healthScore = Math.max(0, Math.min(100, 100 - score));
  const grade =
    healthScore >= 80 ? "A" : healthScore >= 60 ? "B" : healthScore >= 40 ? "C" : healthScore >= 20 ? "D" : "F";
  const color =
    healthScore <= 30 ? "#ef4444" : healthScore <= 60 ? "#f59e0b" : "#10b981";
  const label =
    healthScore <= 30
      ? "Needs Immediate Attention"
      : healthScore <= 60
      ? "Room for Improvement"
      : "Looking Good";

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
  return clean.substring(0, maxLen) + "\u2026";
}

// ===== LOADING SCREEN WITH PROGRESS BAR =====
function AuditLoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(0);

  const steps = [
    "Connecting to website...",
    "Analyzing page structure...",
    "Running desktop performance test...",
    "Running mobile performance test...",
    "Checking security & accessibility...",
    "Calculating scores...",
    "Finalizing report...",
  ];

  useEffect(() => {
    // Smooth progress: reaches ~90% in 40s, then slows down
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev;
        if (prev < 70) return prev + 1.8;
        if (prev < 85) return prev + 0.8;
        return prev + 0.3;
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Cycle through steps based on progress
    if (progress < 10) setStep(0);
    else if (progress < 25) setStep(1);
    else if (progress < 45) setStep(2);
    else if (progress < 60) setStep(3);
    else if (progress < 75) setStep(4);
    else if (progress < 88) setStep(5);
    else setStep(6);
  }, [progress]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/50 border border-gray-100 p-8">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
              <svg className="w-7 h-7 text-blue-600 animate-pulse" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-center text-lg font-bold text-gray-900 mb-1">Scanning Your Website</h2>
          <p className="text-center text-sm text-gray-400 mb-6">Running Google Lighthouse analysis</p>

          {/* Progress Bar */}
          <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Progress Text */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-gray-500 font-medium">{steps[step]}</p>
            <p className="text-xs text-gray-400 font-semibold">{Math.round(progress)}%</p>
          </div>

          {/* Subtle note */}
          <p className="text-[11px] text-gray-300 text-center">This may take up to 30 seconds for a thorough analysis</p>
        </div>
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

  useEffect(() => {
    if (!token) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
    fetch(`${apiUrl}/audit/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error("Report not found");
        return res.json();
      })
      .then((d) => {
        setData(d);
        // Track view (fire-and-forget — don't block page render)
        fetch(`${apiUrl}/audit/${token}/view`, { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => {});
      })
      .catch(() => setError("This audit report was not found or has expired."))
      .finally(() => setLoading(false));
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

  // Build checklist — each issue has impact statement + recommendation
  type Check = { label: string; pass: boolean; detail: string; impact: string; fix: string; icon: string };
  const checks: Check[] = [];
  const industry = data.industry || "Local Business";
  const serviceType = data.serviceType || "web_dev";

  if (serviceType === "digital_marketing" || serviceType === "social_media") {
    // ===== DIGITAL MARKETING / SMMA AUDIT CHECKS =====

    if (s.hasAnalytics !== null) {
      checks.push({
        label: s.hasAnalytics ? "Google Analytics Active" : "No Google Analytics — Flying Blind",
        pass: s.hasAnalytics,
        icon: "📊",
        detail: s.hasAnalytics
          ? "You're tracking website visitors — you can see where they come from and what they do on your site."
          : "Your website has zero tracking. You have no idea how many people visit, where they come from, which pages they look at, or why they leave without contacting you.",
        impact: s.hasAnalytics ? "" : "Without analytics, every marketing decision is a guess. You can't know what's working, what's wasting money, or where customers are dropping off.",
        fix: s.hasAnalytics ? "" : "Requires Google Analytics 4 setup, conversion event configuration, and proper data stream integration.",
      });
    }

    if (s.hasFacebookPixel !== null) {
      checks.push({
        label: s.hasFacebookPixel ? "Facebook/Meta Pixel Active" : "No Facebook/Meta Pixel",
        pass: s.hasFacebookPixel,
        icon: "🎯",
        detail: s.hasFacebookPixel
          ? "You're tracking visitors for Facebook/Instagram retargeting — you can show ads to people who already visited your site."
          : "No Meta Pixel detected. Every person who visits your site and leaves? Gone forever. You can't show them follow-up ads on Facebook or Instagram — they visited, left, and you lost them.",
        impact: s.hasFacebookPixel ? "" : "97% of first-time visitors don't convert. Without a pixel, you can't retarget them with ads — the cheapest, highest-converting ad strategy available.",
        fix: s.hasFacebookPixel ? "" : "Requires Meta Pixel installation, event tracking setup, and custom audience configuration in Ads Manager.",
      });
    }

    if (s.hasGoogleAds !== null) {
      checks.push({
        label: s.hasGoogleAds ? "Google Ads Tracking Active" : "No Google Ads Conversion Tracking",
        pass: s.hasGoogleAds,
        icon: "💰",
        detail: s.hasGoogleAds
          ? "Google Ads conversion tag is active — you can measure which ads and keywords drive real customers."
          : `Search for "${industry.toLowerCase()} near me" right now. Your competitors are paying to appear at the very top. You have no conversion tracking — even if you ran ads, you'd have no idea which ones actually generate customers.`,
        impact: s.hasGoogleAds ? "" : "Without conversion tracking, you can't optimize ad spend. You'd be paying for clicks with no way to know which ones turned into paying customers.",
        fix: s.hasGoogleAds ? "" : "Requires Google Ads tag installation, conversion action setup, and proper attribution configuration.",
      });
    }

    if (s.hasRetargeting !== null && s.hasFacebookPixel !== null) {
      const hasAnyRetargeting = s.hasRetargeting || s.hasFacebookPixel;
      if (!hasAnyRetargeting) {
        checks.push({
          label: "Zero Retargeting Setup",
          pass: false,
          icon: "🔄",
          detail: "No retargeting pixels detected — Facebook, TikTok, LinkedIn, none. When someone visits your site and doesn't call or book immediately, they're gone. No follow-up ads, no reminders, nothing.",
          impact: "Retargeting ads have 10x higher click-through rates than regular display ads. It's the lowest-cost, highest-ROI channel — and you're not using it at all.",
          fix: "Requires pixel installation across ad platforms, audience segmentation, and retargeting campaign strategy.",
        });
      }
    }

    if (s.hasLeadCaptureForm !== null) {
      checks.push({
        label: s.hasLeadCaptureForm ? "Lead Capture Form Found" : "No Lead Capture / Email Signup",
        pass: s.hasLeadCaptureForm,
        icon: "📥",
        detail: s.hasLeadCaptureForm
          ? "You have a way to collect visitor emails — you can nurture leads who aren't ready to buy yet."
          : "No email signup, newsletter form, or lead magnet found. The 95% of visitors who aren't ready to buy TODAY leave your site with no way for you to follow up. They forget about you by tomorrow.",
        impact: s.hasLeadCaptureForm ? "" : "Email marketing has an average ROI of $36 for every $1 spent. Without capturing emails, you lose every visitor who needs more time to decide.",
        fix: s.hasLeadCaptureForm ? "" : "Requires a lead magnet (free guide, discount, etc.), opt-in form placement, and email automation setup.",
      });
    }

    if (s.hasEmailMarketing !== null) {
      checks.push({
        label: s.hasEmailMarketing ? "Email Marketing Platform Detected" : "No Email Marketing System",
        pass: s.hasEmailMarketing,
        icon: "✉️",
        detail: s.hasEmailMarketing
          ? "You're connected to an email marketing platform — automated follow-ups and campaigns are possible."
          : "No email marketing tool found (Mailchimp, HubSpot, Klaviyo, etc.). Even if someone gave you their email, you have no automated way to nurture them into a customer.",
        impact: s.hasEmailMarketing ? "" : "Businesses with automated email sequences see 320% more revenue from email than those without. Manual follow-up doesn't scale.",
        fix: s.hasEmailMarketing ? "" : "Requires platform selection, list setup, welcome sequence creation, and integration with your website.",
      });
    }

    if (s.hasCTA !== null) {
      checks.push({
        label: s.hasCTA ? "Clear Call-to-Action Found" : "No Clear Call-to-Action",
        pass: s.hasCTA,
        icon: "👆",
        detail: s.hasCTA
          ? "Your website has a clear action for visitors to take above the fold — they know immediately what to do next."
          : "When someone lands on your homepage, there's no obvious next step. No prominent 'Get a Quote', 'Book Now', or 'Call Us' button above the fold. Visitors have to hunt for how to contact you — most won't bother.",
        impact: s.hasCTA ? "" : "Pages with a single clear CTA increase conversions by 371% compared to pages with no clear action. Every second of confusion = lost customers.",
        fix: s.hasCTA ? "" : "Requires strategic button placement, compelling copy, and A/B testing for maximum conversion.",
      });
    }

    if (s.hasOpenGraph !== null) {
      checks.push({
        label: s.hasOpenGraph ? "Social Sharing Tags Active" : "Broken Social Sharing",
        pass: s.hasOpenGraph,
        icon: "🔗",
        detail: s.hasOpenGraph
          ? "When your site is shared on social media, it shows a professional image + description — makes people want to click."
          : "Share your website on Facebook or WhatsApp right now. It shows a broken preview — no image, no description. Looks unprofessional and nobody clicks it.",
        impact: s.hasOpenGraph ? "" : "Links with rich previews (image + description) get 2-5x more clicks than those without. Every time someone shares your business, it looks broken.",
        fix: s.hasOpenGraph ? "" : "Requires Open Graph meta tags (og:title, og:image, og:description) properly configured for each page.",
      });
    }

    if (s.googleRating !== null) {
      const goodRating = s.googleRating >= 4.0;
      checks.push({
        label: goodRating ? `Google Rating: ${s.googleRating}★ (${s.googleReviewCount || 0} reviews)` : `Low Google Rating: ${s.googleRating}★`,
        pass: goodRating && (s.googleReviewCount || 0) >= 10,
        icon: "⭐",
        detail: goodRating
          ? `Your business has a solid ${s.googleRating}-star rating on Google with ${s.googleReviewCount || 0} reviews — this builds trust with new customers seeing your ads.`
          : `Your Google rating is ${s.googleRating} stars${s.googleReviewCount ? ` with only ${s.googleReviewCount} reviews` : ""}. When someone clicks your ad and checks reviews before calling, a sub-4-star rating kills the conversion. You paid for the click but lost the customer.`,
        impact: goodRating ? "" : "88% of consumers check reviews before choosing a local business. Low ratings mean your ad spend is wasted — people click but don't convert.",
        fix: goodRating ? "" : "A systematic review generation strategy can improve your rating and volume within 60-90 days.",
      });
    } else {
      checks.push({
        label: "No Google Business Profile Detected — Invisible to Local Searchers",
        pass: false,
        icon: "⭐",
        detail: "We couldn't find a Google Business Profile for your business. When potential customers search for your services nearby, they see your competitors' listings with reviews, photos, and contact info — but not yours.",
        impact: "88% of consumers who do a local search on their phone visit or call a business within 24 hours. Without a Google Business Profile, you're missing out on these high-intent customers entirely.",
        fix: "Set up a Google Business Profile with complete business information, high-quality photos, and service descriptions. Then build a review generation system to establish social proof.",
      });
    }

    if (s.hasSchemaMarkup !== null) {
      checks.push({
        label: s.hasSchemaMarkup ? "Structured Data Present" : "No Structured Data / Schema Markup",
        pass: s.hasSchemaMarkup,
        icon: "🏷️",
        detail: s.hasSchemaMarkup
          ? "Your site has structured data — search engines understand your business type, services, hours, and reviews."
          : "No schema markup detected. Google doesn't fully understand what your business does, your hours, or your services. Your search listing is plain text while competitors show stars, hours, and rich info.",
        impact: s.hasSchemaMarkup ? "" : "Rich snippets in search results get 58% more clicks. Without schema, your listing blends in with everything else.",
        fix: s.hasSchemaMarkup ? "" : "Requires LocalBusiness schema, FAQ schema, and service area markup implementation.",
      });
    }

    checks.push({
      label: s.socialLinks >= 2 ? `Active on ${s.socialLinks} Social Platforms` : s.socialLinks === 1 ? "Only 1 Social Profile Linked" : "No Social Media Presence",
      pass: s.socialLinks >= 2,
      icon: "👥",
      detail: s.socialLinks >= 2
        ? "Your website links to multiple social profiles — customers can verify you're active and engaged across platforms."
        : `No social media links found on your website. When a potential customer wants to check your Instagram or Facebook to see your work, reviews, or activity — they find nothing. For a ${industry.toLowerCase()}, that's a major trust signal missing.`,
      impact: s.socialLinks >= 2 ? "" : "71% of consumers who have a positive social media experience with a brand are likely to recommend it. No presence = no social proof = lower ad conversion rates.",
      fix: s.socialLinks >= 2 ? "" : "Link active profiles from your website, maintain consistent branding, and post regularly to build social proof.",
    });

  } else if (serviceType === "seo") {
    // ===== SEO AUDIT CHECKS =====

    // Performance check — SEO users care about speed as ranking factor
    const mobilePerf = s.pageSpeed?.mobile?.performanceScore;
    if (mobilePerf !== undefined && mobilePerf !== null) {
      const fast = mobilePerf >= 50;
      checks.push({
        label: fast ? `Performance Score — ${mobilePerf}/100` : `Poor Performance — ${mobilePerf}/100 (Google Ranking Factor)`,
        pass: fast,
        icon: "⚡",
        detail: fast
          ? `Google rates your mobile site performance at ${mobilePerf}/100. This is within acceptable range and shouldn't hurt your rankings.`
          : `Google rates your mobile site performance at ${mobilePerf} out of 100. You can verify this — go to pagespeed.web.dev and enter your URL. Google has confirmed page speed is a direct ranking factor.`,
        impact: fast ? "" : "Google's Page Experience update uses Core Web Vitals as a ranking signal. Sites scoring below 50 are penalized in search results — you're literally being ranked lower because of speed.",
        fix: fast ? "" : "Requires image optimization, code minification, server improvements, and render-blocking resource elimination.",
      });
    } else if (s.pageLoadTimeMs !== null) {
      const secs = (s.pageLoadTimeMs / 1000).toFixed(1);
      const fast = s.pageLoadTimeMs <= 3000;
      checks.push({
        label: fast ? `Fast Load Speed — ${secs}s` : `Slow Load Speed — ${secs}s (Hurts Rankings)`,
        pass: fast,
        icon: "⚡",
        detail: fast
          ? "Your site loads within Google's recommended 3-second window."
          : `Your website takes ${secs} seconds to load. Google penalizes slow sites in search rankings — you're losing positions to faster competitors.`,
        impact: fast ? "" : "Google research shows 53% of mobile visitors leave after 3 seconds. High bounce rates signal to Google that your content isn't relevant — pushing you further down.",
        fix: fast ? "" : "Requires server optimization, image compression, caching strategy, and render pipeline improvements.",
      });
    }

    if (s.isMobileFriendly !== null) {
      checks.push({
        label: s.isMobileFriendly ? "Mobile-Friendly (Google Requirement)" : "Not Mobile-Friendly — Google Penalizes This",
        pass: s.isMobileFriendly,
        icon: "📱",
        detail: s.isMobileFriendly
          ? "Your site passes Google's mobile-friendly test — you won't be penalized in mobile search results."
          : "Your site is not mobile-friendly. Since Google's mobile-first indexing update, Google primarily uses the mobile version of your site for ranking. A non-mobile site is being actively penalized.",
        impact: s.isMobileFriendly ? "" : "Google has used mobile-first indexing for all sites since 2023. If your mobile experience is poor, your rankings suffer across ALL devices — not just mobile.",
        fix: s.isMobileFriendly ? "" : "Requires full responsive redesign to pass Google's mobile-friendly criteria.",
      });
    }

    if (s.hasMetaDescription !== null) {
      checks.push({
        label: s.hasMetaDescription ? "Meta Description Present" : "Missing Meta Description — Lower Click-Through Rate",
        pass: s.hasMetaDescription,
        icon: "🔍",
        detail: s.hasMetaDescription
          ? "Your homepage has a meta description — Google shows it in search results to help people decide to click."
          : "No meta description found. Google auto-generates one by pulling random text from your page. Search for your business name — the description under your listing is random, unhelpful content.",
        impact: s.hasMetaDescription ? "" : "Pages with optimized meta descriptions get 5.8% higher click-through rates. Google also uses CTR as a ranking signal — fewer clicks = lower rankings over time.",
        fix: s.hasMetaDescription ? "" : "Each page needs a unique, keyword-optimized description (150-160 chars) that matches search intent.",
      });
    }

    if (s.hasSSL !== null) {
      checks.push({
        label: s.hasSSL ? "SSL Certificate Active (HTTPS)" : "No SSL — Google Ranking Penalty",
        pass: s.hasSSL,
        icon: "🔒",
        detail: s.hasSSL
          ? "Your site uses HTTPS — Google confirmed this as a ranking signal since 2014."
          : "Your site has no SSL certificate. Google has explicitly stated HTTPS is a ranking factor. You're giving up free ranking points to every competitor who has SSL.",
        impact: s.hasSSL ? "" : "Google Chrome shows 'Not Secure' to visitors AND ranks you lower. Double penalty — fewer clicks from search AND lower ranking position.",
        fix: s.hasSSL ? "" : "Requires SSL certificate installation, proper redirects, and mixed-content resolution.",
      });
    }

    if (s.hasSchemaMarkup !== null) {
      checks.push({
        label: s.hasSchemaMarkup ? "Schema Markup Present" : "No Schema Markup — Missing Rich Snippets",
        pass: s.hasSchemaMarkup,
        icon: "🏷️",
        detail: s.hasSchemaMarkup
          ? "Your site has structured data — this enables rich snippets (stars, FAQ, hours) in search results."
          : "No structured data found. Your Google listing shows plain text while competitors show star ratings, business hours, FAQ dropdowns, and service areas. You're invisible by comparison.",
        impact: s.hasSchemaMarkup ? "" : "Rich snippets increase click-through rates by up to 58%. For local businesses, LocalBusiness schema directly impacts Google Maps and local pack rankings.",
        fix: s.hasSchemaMarkup ? "" : "Requires JSON-LD implementation: LocalBusiness, FAQPage, Service, and Review schema markup.",
      });
    }

    if (s.hasAnalytics !== null) {
      checks.push({
        label: s.hasAnalytics ? "Analytics Tracking Active" : "No Analytics — Can't Measure SEO Results",
        pass: s.hasAnalytics,
        icon: "📊",
        detail: s.hasAnalytics
          ? "You're tracking visitor data — essential for measuring SEO performance and identifying opportunities."
          : "No Google Analytics detected. You have no way to track organic search traffic, see which keywords drive visits, or measure if SEO improvements are working.",
        impact: s.hasAnalytics ? "" : "Without analytics, you can't identify which pages rank, which keywords drive traffic, or where visitors drop off. SEO without measurement is guesswork.",
        fix: s.hasAnalytics ? "" : "Requires GA4 setup, Search Console integration, and conversion tracking for organic traffic.",
      });
    }

    if (s.googleRating !== null) {
      const goodRating = s.googleRating >= 4.0;
      checks.push({
        label: goodRating ? `Google Rating: ${s.googleRating}★ (${s.googleReviewCount || 0} reviews)` : `Low Google Rating: ${s.googleRating}★ — Hurts Local SEO`,
        pass: goodRating && (s.googleReviewCount || 0) >= 10,
        icon: "⭐",
        detail: goodRating
          ? `${s.googleRating}-star rating with ${s.googleReviewCount || 0} reviews — strong signal for local pack rankings.`
          : `Your rating is ${s.googleRating} stars${s.googleReviewCount ? ` with ${s.googleReviewCount} reviews` : ""}. Google uses review quality and quantity as a direct local ranking factor. Businesses with more, better reviews rank higher in the local pack (map results).`,
        impact: goodRating ? "" : "Reviews are one of Google's top 3 local ranking factors. Low review count or rating directly pushes you below competitors in Google Maps and local search.",
        fix: goodRating ? "" : "A review generation system targeting happy customers can significantly improve both rating and volume within 60-90 days.",
      });
    } else {
      checks.push({
        label: "No Google Business Profile Detected — Missing from Local Pack",
        pass: false,
        icon: "⭐",
        detail: "We couldn't find a Google Business Profile for your business. This means you're not appearing in Google Maps or the local 3-pack when people search for your services in your area.",
        impact: "The Google local pack (map results) gets 42% of all clicks for local searches. Without a Google Business Profile, you're invisible to nearly half of potential customers searching for your service.",
        fix: "Create and optimize a Google Business Profile with accurate business info, photos, services, and hours. Then implement a review generation strategy to build credibility.",
      });
    }

    checks.push({
      label: s.socialLinks >= 2 ? `${s.socialLinks} Social Profiles Linked` : "Few/No Social Signals",
      pass: s.socialLinks >= 2,
      icon: "👥",
      detail: s.socialLinks >= 2
        ? "Multiple social profiles linked from your site — these create brand signals that support SEO authority."
        : "Minimal social media presence. While social links aren't a direct ranking factor, they create brand signals, drive referral traffic, and help Google understand your business as a real entity.",
      impact: s.socialLinks >= 2 ? "" : "Google's entity recognition relies on consistent brand presence across the web. No social footprint makes it harder for Google to trust your business as legitimate.",
      fix: s.socialLinks >= 2 ? "" : "Establish profiles on key platforms and link them from your website to create consistent brand signals.",
    });

  } else {
    // ===== WEB DEV AUDIT CHECKS (default — existing behavior) =====

    if (s.hasSSL !== null) {
      checks.push({
        label: s.hasSSL ? "SSL Certificate Active" : "No SSL — Browser Shows \"Not Secure\"",
        pass: s.hasSSL,
        icon: "🔒",
        detail: s.hasSSL
          ? "Your site shows the lock icon — visitors see it as trustworthy and safe to use."
          : "Every person who visits your site sees a \"Not Secure\" warning in Chrome. Open your site right now and look at the address bar — you'll see it.",
        impact: s.hasSSL ? "" : "85% of consumers say they won't continue browsing an unsecure website. That's 8 out of 10 potential customers gone before they even read anything.",
        fix: s.hasSSL ? "" : "Requires proper certificate installation, server configuration, and redirect setup to avoid mixed-content errors.",
      });
    }
    if (s.isMobileFriendly !== null) {
      checks.push({
        label: s.isMobileFriendly ? "Mobile-Friendly Design" : "Not Optimized for Mobile",
        pass: s.isMobileFriendly,
        icon: "📱",
        detail: s.isMobileFriendly
          ? "Your site adapts to phone screens — text is readable, buttons are tappable, navigation works."
          : `Pull up your site on your phone right now. If text is tiny, buttons overlap, or you have to pinch-to-zoom — that's what every mobile customer sees.`,
        impact: s.isMobileFriendly ? "" : `63% of all Google searches come from mobile devices. For ${industry.toLowerCase()} businesses, most people searching "${industry.toLowerCase()} near me" are on their phone. If they can't navigate your site, they hit back and call your competitor.`,
        fix: s.isMobileFriendly ? "" : "Requires a full responsive redesign across all page templates, navigation, and forms to work on every device.",
      });
    }
    // Performance check — prefer Google PageSpeed score over raw load time
    const mobilePerf = s.pageSpeed?.mobile?.performanceScore;
    if (mobilePerf !== undefined && mobilePerf !== null) {
      const fast = mobilePerf >= 50;
      checks.push({
        label: fast ? `Performance Score — ${mobilePerf}/100` : `Poor Performance — ${mobilePerf}/100`,
        pass: fast,
        icon: "⚡",
        detail: fast
          ? `Google rates your mobile site performance at ${mobilePerf}/100. This is within acceptable range for user experience.`
          : `Google rates your mobile site performance at ${mobilePerf} out of 100. You can verify this yourself — go to pagespeed.web.dev and enter your website URL.`,
        impact: fast ? "" : `Google uses page speed as a ranking factor. Sites scoring below 50 load so slowly that over half of mobile visitors leave before seeing your content — choosing a competitor instead.`,
        fix: fast ? "" : "Requires image optimization, code minification, server improvements, and render-blocking resource elimination.",
      });
    } else if (s.pageLoadTimeMs !== null) {
      const secs = (s.pageLoadTimeMs / 1000).toFixed(1);
      const fast = s.pageLoadTimeMs <= 3000;
      checks.push({
        label: fast ? `Fast Load Speed — ${secs}s` : `Slow Load Speed — ${secs} seconds`,
        pass: fast,
        icon: "⚡",
        detail: fast
          ? "Your site loads within Google's recommended 3-second window. Visitors get instant access."
          : `Your website takes ${secs} seconds to load. That's ${(parseFloat(secs) - 3).toFixed(1)} seconds over Google's recommendation. You can test this yourself — open your site and count.`,
        impact: fast ? "" : "Google research shows 53% of mobile visitors leave if a page takes longer than 3 seconds. For every 100 people who click your site, roughly half are leaving before seeing anything.",
        fix: fast ? "" : "Image compression, caching, and platform optimization can cut load time by 50–70%.",
      });
    }
    if (s.hasOnlineBooking !== null) {
      checks.push({
        label: s.hasOnlineBooking ? "Online Booking Available" : "No Online Booking System",
        pass: s.hasOnlineBooking,
        icon: "📅",
        detail: s.hasOnlineBooking
          ? "Customers can schedule appointments directly from your website, 24/7, without calling."
          : `There's no way for someone to book an appointment on your website. When a potential customer visits at 10pm and wants to schedule with a ${industry.toLowerCase()}, they can't — they'll Google the next option and book there instead.`,
        impact: s.hasOnlineBooking ? "" : "Businesses with online booking report 2–3x more appointments than call-only businesses. 67% of customers prefer booking online over calling.",
        fix: s.hasOnlineBooking ? "" : "Needs integration with your calendar, automated confirmations, and proper placement to maximize conversions.",
      });
    }
    if (s.hasContactForm !== null) {
      checks.push({
        label: s.hasContactForm ? "Contact Form Found" : "No Contact Form",
        pass: s.hasContactForm,
        icon: "✉️",
        detail: s.hasContactForm
          ? "Visitors can send you a message directly from the website without leaving."
          : "There's no contact form on your site. The only option for a visitor is to pick up the phone and call — and most people won't. They'll find a competitor with a simple \"Get a Quote\" form instead.",
        impact: s.hasContactForm ? "" : "Contact forms capture leads 24/7, even when you're closed. Businesses without one miss every inquiry that happens outside of calling hours.",
        fix: s.hasContactForm ? "" : "Requires strategic placement, spam protection, and integration with your workflow to capture leads effectively.",
      });
    }
    if (s.hasMetaDescription !== null) {
      checks.push({
        label: s.hasMetaDescription ? "SEO Description Present" : "Missing SEO Description",
        pass: s.hasMetaDescription,
        icon: "🔍",
        detail: s.hasMetaDescription
          ? "When someone Googles your business, the search result shows a clear, compelling description of what you do."
          : `Google your business name right now. Instead of a professional description, you'll see a blank or auto-generated snippet that looks unprofessional compared to competitors who have proper descriptions.`,
        impact: s.hasMetaDescription ? "" : "Search results with optimized descriptions get 5.8% higher click-through rates. That's more people choosing your listing over competitors.",
        fix: s.hasMetaDescription ? "" : "Each page needs a unique, keyword-optimized description that matches search intent for your services.",
      });
    }
    checks.push({
      label: s.socialLinks >= 2 ? `Active on ${s.socialLinks} Social Platforms` : s.socialLinks === 1 ? "Only 1 Social Profile" : "No Social Media Presence",
      pass: s.socialLinks >= 2,
      icon: "👥",
      detail: s.socialLinks >= 2
        ? "Your business shows up across multiple social platforms — customers can find and verify you on the channels they use."
        : `When someone hears about your business and checks Instagram or Facebook to see your work, they find nothing. For a ${industry.toLowerCase()}, this is especially costly — people want to see your portfolio and social proof before reaching out.`,
      impact: s.socialLinks >= 2 ? "" : "71% of consumers who have a positive social media experience with a brand are likely to recommend it. No presence means no word-of-mouth amplification.",
      fix: s.socialLinks >= 2 ? "" : "Even one active profile with consistent posting builds trust and shows potential customers you're active and engaged.",
    });
    if (s.copyrightYear !== null) {
      const fresh = s.copyrightYear >= currentYear - 1;
      checks.push({
        label: fresh ? `Copyright Up to Date (${s.copyrightYear})` : `Outdated Copyright — © ${s.copyrightYear}`,
        pass: fresh,
        icon: "📆",
        detail: fresh
          ? "Your website footer shows the current year — signals an active, maintained business."
          : `Your website footer says © ${s.copyrightYear}. Scroll to the bottom of your site and check. To a visitor, this signals the business may be closed or that nobody is maintaining the website.`,
        impact: fresh ? "" : `That's ${currentYear - s.copyrightYear} years out of date. Visitors subconsciously notice — it's a small detail that erodes trust, especially when competitors' sites look fresh.`,
        fix: fresh ? "" : "A 10-second fix that instantly makes your site look current and maintained.",
      });
    }
  }

  const failChecks = checks.filter(c => !c.pass);
  const passChecks = checks.filter(c => c.pass);
  const healthScore = Math.max(0, Math.min(100, 100 - data.score));
  const benchmark = data.benchmark ?? null;
  const industryAvg = benchmark ? benchmark.avgHealth : null;
  const estimatedLossMin = failChecks.length * 8;
  const estimatedLossMax = failChecks.length * 15;

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
            {serviceType === "digital_marketing" || serviceType === "social_media"
              ? "Digital Marketing Audit"
              : serviceType === "seo"
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
            We analyzed <span className="font-semibold text-gray-900">{data.company}</span>&apos;s online presence across {checks.length} key areas that directly impact whether potential customers choose you or a competitor.
          </p>
          {failChecks.length > 0 && (
            <p className="text-sm text-gray-600 leading-relaxed mt-3">
              <span className="font-semibold text-red-700">{failChecks.length} critical {failChecks.length === 1 ? "issue was" : "issues were"} found</span> that {failChecks.length === 1 ? "is" : "are"} actively driving customers to competitors. {failChecks.length >= 2 ? "The combination of these issues compounds the problem \u2014 each one makes the others worse." : ""}
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
              {serviceType === "digital_marketing" || serviceType === "social_media"
                ? "Marketing Readiness Score"
                : serviceType === "seo"
                ? "SEO Health Score"
                : "Digital Health Score"}
            </p>
            <ScoreRing score={data.score} />
          </div>
          <div className="border-t border-gray-100 bg-gray-50/80 px-6 py-4">
            <div className="grid grid-cols-3 divide-x divide-gray-200 text-center">
              <div className="px-2">
                <p className="text-xl font-extrabold text-red-600">{failChecks.length}</p>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">Issues</p>
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

        {/* Google Lighthouse Score — only for web_dev and seo */}
        {(serviceType === "web_dev" || serviceType === "seo") && s.pageSpeed && (s.pageSpeed.mobile || s.pageSpeed.desktop) && (
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

        {/* How You Compare — only shown when we have a real benchmark */}
        {benchmark && industryAvg !== null && (
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-bold text-gray-900 mb-4">How You Compare</p>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-semibold text-gray-700">Your Score</span>
                  <span className="text-xs font-bold" style={{ color: healthScore <= 30 ? '#ef4444' : healthScore <= 60 ? '#f59e0b' : '#10b981' }}>{healthScore}/100</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${healthScore}%`, backgroundColor: healthScore <= 30 ? '#ef4444' : healthScore <= 60 ? '#f59e0b' : '#10b981' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-semibold text-gray-500">{benchmark.scope === "industry" ? `Average ${benchmark.label}` : "Average business"}</span>
                  <span className="text-xs font-bold text-gray-400">{industryAvg}/100</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gray-300 transition-all duration-1000" style={{ width: `${industryAvg}%` }} />
                </div>
              </div>
            </div>
            {healthScore < industryAvg ? (
              <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                Your digital presence scores <span className="font-bold text-red-600">{industryAvg - healthScore} points below</span> the average {benchmark.scope === "industry" ? `${benchmark.label.toLowerCase()} business` : "business"} we&rsquo;ve analyzed ({benchmark.sampleCount} analyzed).
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                You&rsquo;re <span className="font-bold text-emerald-600">{healthScore - industryAvg} points above</span> the average {benchmark.scope === "industry" ? `${benchmark.label.toLowerCase()} business` : "business"} we&rsquo;ve analyzed ({benchmark.sampleCount} analyzed).
              </p>
            )}
          </div>
        )}

        {/* Estimated customer loss */}
        {failChecks.length > 0 && (
          <div className="mt-6 bg-gradient-to-r from-red-50 to-orange-50 rounded-2xl border border-red-200 p-6 text-center">
            <p className="text-[10px] font-bold text-red-800 uppercase tracking-widest mb-2">
              {serviceType === "digital_marketing" || serviceType === "social_media"
                ? "Estimated Monthly Revenue Loss"
                : "Estimated Monthly Impact"}
            </p>
            <p className="text-3xl font-extrabold text-red-700">{estimatedLossMin}&ndash;{estimatedLossMax}</p>
            <p className="text-sm font-semibold text-red-600 mt-1">
              {serviceType === "digital_marketing" || serviceType === "social_media"
                ? "potential leads lost per month"
                : "potential customers lost per month"}
            </p>
            <p className="text-xs text-red-500/70 mt-2 leading-relaxed">
              Based on {failChecks.length} active {failChecks.length === 1 ? "issue" : "issues"} affecting your {serviceType === "digital_marketing" || serviceType === "social_media" ? "marketing effectiveness and lead conversion" : serviceType === "seo" ? "search visibility and rankings" : "online visibility and conversion rate"}
            </p>
          </div>
        )}

        {/* Issues */}
        {failChecks.length > 0 && (
          <div className="mt-6 bg-red-50 rounded-2xl border-2 border-red-200 p-6">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <p className="text-sm font-bold text-red-900">What Needs Fixing</p>
            </div>
            <p className="text-xs text-red-600/70 mb-4 ml-9">Each issue below is actively sending customers to your competitors</p>
            <div className="space-y-0">
              {failChecks.map((check, i) => (
                <div key={i} className={`py-4 ${i > 0 ? "border-t border-red-200/50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-base mt-0.5 flex-shrink-0">{check.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-red-800">{check.label}</p>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-600 text-white uppercase tracking-wider">
                          #{i + 1}{i === 0 ? " — Fix This First" : " Priority"}
                        </span>
                      </div>
                      <p className="text-[13px] text-red-900/70 mt-1.5 leading-relaxed">{check.detail}</p>
                      {check.impact && (
                        <p className="text-xs text-red-700/60 mt-2 leading-relaxed italic">{check.impact}</p>
                      )}
                      {check.fix && (
                        <div className="mt-2.5 flex items-start gap-1.5">
                          <svg className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                          <p className="text-xs font-medium text-red-700/80">{check.fix}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Passed */}
        {passChecks.length > 0 && (
          <div className="mt-6 bg-emerald-50 rounded-2xl border-2 border-emerald-200 p-6">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-sm font-bold text-emerald-900">What&apos;s Working Well</p>
            </div>
            <p className="text-xs text-emerald-600/70 mb-4 ml-9">Keep these up &mdash; they&apos;re giving you an edge</p>
            <div className="space-y-0">
              {passChecks.map((check, i) => (
                <div key={i} className={`flex items-start gap-3 py-3 ${i > 0 ? "border-t border-emerald-200/50" : ""}`}>
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
              Every day these {failChecks.length} {failChecks.length === 1 ? "issue goes" : "issues go"} unfixed, potential customers are finding your business online and choosing a competitor instead. The good news: {failChecks.length === 1 ? "this is" : "these are all"} fixable with the right expertise and a clear plan.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-lg font-extrabold text-gray-800">{failChecks.length}</p>
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Fixable {failChecks.length === 1 ? "Issue" : "Issues"}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-lg font-extrabold text-blue-600">Expert</p>
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Help Needed</p>
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
              {failChecks.length > 0 ? "These issues are all fixable." : "Your site is in good shape."}
            </h2>
            <p className="text-sm text-gray-400 leading-relaxed max-w-sm mx-auto">
              {failChecks.length > 0
                ? `Reply to the email that brought you here. We\u2019ll show you exactly what to fix first and how long each one takes \u2014 no cost for the roadmap.`
                : "If you want to go from good to great, reply to the email that brought you here and we\u2019ll show you how."}
            </p>
          </div>
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
