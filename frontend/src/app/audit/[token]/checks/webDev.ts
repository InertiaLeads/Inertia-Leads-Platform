import type { AuditSignals, Check } from "../types";

// =============================================
// Web development audit findings
// =============================================
// Ported verbatim from the original inline implementation — the copy, thresholds and
// ordering are deliberately unchanged. Only the shape changed (status/category/severity)
// so all three service types render through one code path.
//
// Everything lives in a single "Website Health" category, so the report renders this
// service type as one flat list exactly as it did before.

const CATEGORY = "Website Health";

export function buildWebDevChecks(s: AuditSignals, industry: string, currentYear: number): Check[] {
  const checks: Check[] = [];
  const trade = (industry || "Local Business").toLowerCase();
  const push = (c: Check) => checks.push(c);

  if (s.hasSSL !== null) {
    push({
      label: s.hasSSL ? "SSL Certificate Active" : 'No SSL — Browser Shows "Not Secure"',
      status: s.hasSSL ? "good" : "opportunity",
      category: CATEGORY,
      icon: "🔒",
      severity: 3,
      detail: s.hasSSL
        ? "Your site shows the lock icon — visitors see it as trustworthy and safe to use."
        : 'Every person who visits your site sees a "Not Secure" warning in Chrome. Open your site right now and look at the address bar — you\'ll see it.',
      impact: s.hasSSL ? "" : "85% of consumers say they won't continue browsing an unsecure website. That's 8 out of 10 potential customers gone before they even read anything.",
      fix: s.hasSSL ? "" : "Requires proper certificate installation, server configuration, and redirect setup to avoid mixed-content errors.",
    });
  }

  if (s.isMobileFriendly !== null) {
    push({
      label: s.isMobileFriendly ? "Mobile-Friendly Design" : "Not Optimized for Mobile",
      status: s.isMobileFriendly ? "good" : "opportunity",
      category: CATEGORY,
      icon: "📱",
      severity: 3,
      detail: s.isMobileFriendly
        ? "Your site adapts to phone screens — text is readable, buttons are tappable, navigation works."
        : "Pull up your site on your phone right now. If text is tiny, buttons overlap, or you have to pinch-to-zoom — that's what every mobile customer sees.",
      impact: s.isMobileFriendly ? "" : `63% of all Google searches come from mobile devices. For ${trade} businesses, most people searching "${trade} near me" are on their phone. If they can't navigate your site, they hit back and call your competitor.`,
      fix: s.isMobileFriendly ? "" : "Requires a full responsive redesign across all page templates, navigation, and forms to work on every device.",
    });
  }

  // Performance check — prefer Google PageSpeed score over raw load time
  const mobilePerf = s.pageSpeed?.mobile?.performanceScore;
  if (mobilePerf !== undefined && mobilePerf !== null) {
    const fast = mobilePerf >= 50;
    push({
      label: fast ? `Performance Score — ${mobilePerf}/100` : `Poor Performance — ${mobilePerf}/100`,
      status: fast ? "good" : "opportunity",
      category: CATEGORY,
      icon: "⚡",
      severity: 2,
      detail: fast
        ? `Google rates your mobile site performance at ${mobilePerf}/100. This is within acceptable range for user experience.`
        : `Google rates your mobile site performance at ${mobilePerf} out of 100. You can verify this yourself — go to pagespeed.web.dev and enter your website URL.`,
      impact: fast ? "" : "Google uses page speed as a ranking factor. Sites scoring below 50 load so slowly that over half of mobile visitors leave before seeing your content — choosing a competitor instead.",
      fix: fast ? "" : "Requires image optimization, code minification, server improvements, and render-blocking resource elimination.",
    });
  } else if (s.pageLoadTimeMs !== null) {
    const secs = (s.pageLoadTimeMs / 1000).toFixed(1);
    const fast = s.pageLoadTimeMs <= 3000;
    push({
      label: fast ? `Fast Load Speed — ${secs}s` : `Slow Load Speed — ${secs} seconds`,
      status: fast ? "good" : "opportunity",
      category: CATEGORY,
      icon: "⚡",
      severity: 2,
      detail: fast
        ? "Your site loads within Google's recommended 3-second window. Visitors get instant access."
        : `Your website takes ${secs} seconds to load. That's ${(parseFloat(secs) - 3).toFixed(1)} seconds over Google's recommendation. You can test this yourself — open your site and count.`,
      impact: fast ? "" : "Google research shows 53% of mobile visitors leave if a page takes longer than 3 seconds. For every 100 people who click your site, roughly half are leaving before seeing anything.",
      fix: fast ? "" : "Image compression, caching, and platform optimization can cut load time by 50–70%.",
    });
  }

  if (s.hasOnlineBooking !== null) {
    push({
      label: s.hasOnlineBooking ? "Online Booking Available" : "No Online Booking System",
      status: s.hasOnlineBooking ? "good" : "opportunity",
      category: CATEGORY,
      icon: "📅",
      severity: 2,
      detail: s.hasOnlineBooking
        ? "Customers can schedule appointments directly from your website, 24/7, without calling."
        : `There's no way for someone to book an appointment on your website. When a potential customer visits at 10pm and wants to schedule with a ${trade}, they can't — they'll Google the next option and book there instead.`,
      impact: s.hasOnlineBooking ? "" : "Businesses with online booking report 2–3x more appointments than call-only businesses. 67% of customers prefer booking online over calling.",
      fix: s.hasOnlineBooking ? "" : "Needs integration with your calendar, automated confirmations, and proper placement to maximize conversions.",
    });
  }

  if (s.hasContactForm !== null) {
    push({
      label: s.hasContactForm ? "Contact Form Found" : "No Contact Form",
      status: s.hasContactForm ? "good" : "opportunity",
      category: CATEGORY,
      icon: "✉️",
      severity: 2,
      detail: s.hasContactForm
        ? "Visitors can send you a message directly from the website without leaving."
        : 'There\'s no contact form on your site. The only option for a visitor is to pick up the phone and call — and most people won\'t. They\'ll find a competitor with a simple "Get a Quote" form instead.',
      impact: s.hasContactForm ? "" : "Contact forms capture leads 24/7, even when you're closed. Businesses without one miss every inquiry that happens outside of calling hours.",
      fix: s.hasContactForm ? "" : "Requires strategic placement, spam protection, and integration with your workflow to capture leads effectively.",
    });
  }

  if (s.hasMetaDescription !== null) {
    push({
      label: s.hasMetaDescription ? "SEO Description Present" : "Missing SEO Description",
      status: s.hasMetaDescription ? "good" : "opportunity",
      category: CATEGORY,
      icon: "🔍",
      severity: 1,
      detail: s.hasMetaDescription
        ? "When someone Googles your business, the search result shows a clear, compelling description of what you do."
        : "Google your business name right now. Instead of a professional description, you'll see a blank or auto-generated snippet that looks unprofessional compared to competitors who have proper descriptions.",
      impact: s.hasMetaDescription ? "" : "Search results with optimized descriptions get 5.8% higher click-through rates. That's more people choosing your listing over competitors.",
      fix: s.hasMetaDescription ? "" : "Each page needs a unique, keyword-optimized description that matches search intent for your services.",
    });
  }

  push({
    label: s.socialLinks >= 2 ? `Active on ${s.socialLinks} Social Platforms` : s.socialLinks === 1 ? "Only 1 Social Profile" : "No Social Media Presence",
    status: s.socialLinks >= 2 ? "good" : "opportunity",
    category: CATEGORY,
    icon: "👥",
    severity: 1,
    detail: s.socialLinks >= 2
      ? "Your business shows up across multiple social platforms — customers can find and verify you on the channels they use."
      : `When someone hears about your business and checks Instagram or Facebook to see your work, they find nothing. For a ${trade}, this is especially costly — people want to see your portfolio and social proof before reaching out.`,
    impact: s.socialLinks >= 2 ? "" : "71% of consumers who have a positive social media experience with a brand are likely to recommend it. No presence means no word-of-mouth amplification.",
    fix: s.socialLinks >= 2 ? "" : "Even one active profile with consistent posting builds trust and shows potential customers you're active and engaged.",
  });

  if (s.copyrightYear !== null) {
    const fresh = s.copyrightYear >= currentYear - 1;
    push({
      label: fresh ? `Copyright Up to Date (${s.copyrightYear})` : `Outdated Copyright — © ${s.copyrightYear}`,
      status: fresh ? "good" : "opportunity",
      category: CATEGORY,
      icon: "📆",
      severity: 1,
      detail: fresh
        ? "Your website footer shows the current year — signals an active, maintained business."
        : `Your website footer says © ${s.copyrightYear}. Scroll to the bottom of your site and check. To a visitor, this signals the business may be closed or that nobody is maintaining the website.`,
      impact: fresh ? "" : `That's ${currentYear - s.copyrightYear} years out of date. Visitors subconsciously notice — it's a small detail that erodes trust, especially when competitors' sites look fresh.`,
      fix: fresh ? "" : "A 10-second fix that instantly makes your site look current and maintained.",
    });
  }

  return checks;
}
