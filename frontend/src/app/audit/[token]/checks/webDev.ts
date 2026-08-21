import type { AuditSignals, Check } from "../types";

// =============================================
// Web development audit findings
// =============================================
// Grouped into four sections so the report reads the way a developer would present it, and
// so a 13-finding audit doesn't render as one undifferentiated list. Section order is set by
// WEB_DEV_CATEGORIES in ../types.

const TRUST = "Security & Trust";
const SPEED = "Mobile & Performance";
const CONVERT = "Turning Visitors Into Customers";
const BUILD = "Build Quality";

export function buildWebDevChecks(s: AuditSignals, industry: string, currentYear: number): Check[] {
  const checks: Check[] = [];
  const trade = (industry || "Local Business").toLowerCase();
  const push = (c: Check) => checks.push(c);
  // Google's own browser could not render this page. This outranks every other finding:
  // if Lighthouse paints nothing, a share of real visitors and crawlers see nothing either.
  if (s.pageSpeed?.renderFailure) {
    push({
      label: "Google's Tools Could Not Load Your Homepage",
      status: "opportunity",
      category: BUILD,
      icon: "🚨",
      severity: 4,
      detail: "When Google's PageSpeed Insights tool loaded your homepage, the page finished without displaying any content. You can reproduce this at pagespeed.web.dev by entering your address.",
      impact: "Google uses this same rendering engine to index pages. A homepage that paints nothing for it risks being indexed as an empty page, and any visitor on a slower connection or an older phone may see the same blank screen.",
      fix: "Usually caused by content that only appears after JavaScript runs, a blocking script, or a server that stalls on the first request. Needs diagnosis against the live page.",
    });
  }


  // Static-HTML crawl: on a JS-rendered site the booking widget and contact form are built
  // in the browser, so "not found in the markup" is our blind spot, not their omission.
  const contentVisible = !s.isSPA;

  if (s.hasSSL !== null) {
    push({
      label: s.hasSSL ? "SSL Certificate Active" : 'No SSL — Browser Shows "Not Secure"',
      status: s.hasSSL ? "good" : "opportunity",
      category: TRUST,
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
      category: SPEED,
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
      category: SPEED,
      icon: "⚡",
      severity: 2,
      excludeFromScore: true,
      ratio: mobilePerf / 100,
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
      category: SPEED,
      icon: "⚡",
      severity: 2,
      excludeFromScore: true,
      detail: fast
        ? "Your site loads within Google's recommended 3-second window. Visitors get instant access."
        : `Your website takes ${secs} seconds to load. That's ${(parseFloat(secs) - 3).toFixed(1)} seconds over Google's recommendation. You can test this yourself — open your site and count.`,
      impact: fast ? "" : "Google research shows 53% of mobile visitors leave if a page takes longer than 3 seconds. For every 100 people who click your site, roughly half are leaving before seeing anything.",
      fix: fast ? "" : "Image compression, caching, and platform optimization can cut load time by 50–70%.",
    });
  }

  if (s.hasOnlineBooking !== null && contentVisible) {
    push({
      label: s.hasOnlineBooking ? "Online Booking Available" : "No Online Booking System",
      status: s.hasOnlineBooking ? "good" : "opportunity",
      category: CONVERT,
      icon: "📅",
      severity: 4,
      detail: s.hasOnlineBooking
        ? "Customers can schedule appointments directly from your website, 24/7, without calling."
        : `There's no way for someone to book an appointment on your website. When a potential customer visits at 10pm and wants to schedule with a ${trade}, they can't — they'll Google the next option and book there instead.`,
      impact: s.hasOnlineBooking ? "" : "Businesses with online booking report 2–3x more appointments than call-only businesses. 67% of customers prefer booking online over calling.",
      fix: s.hasOnlineBooking ? "" : "Needs integration with your calendar, automated confirmations, and proper placement to maximize conversions.",
    });
  }

  if (s.hasContactForm !== null && contentVisible) {
    push({
      label: s.hasContactForm ? "Contact Form Found" : "No Contact Form",
      status: s.hasContactForm ? "good" : "opportunity",
      category: CONVERT,
      icon: "✉️",
      severity: 4,
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
      category: BUILD,
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
    category: TRUST,
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
      category: TRUST,
      icon: "📆",
      severity: 1,
      detail: fresh
        ? "Your website footer shows the current year — signals an active, maintained business."
        : `Your website footer says © ${s.copyrightYear}. Scroll to the bottom of your site and check. To a visitor, this signals the business may be closed or that nobody is maintaining the website.`,
      impact: fresh ? "" : `That's ${currentYear - s.copyrightYear} years out of date. Visitors subconsciously notice — it's a small detail that erodes trust, especially when competitors' sites look fresh.`,
      fix: fresh ? "" : "A 10-second fix that instantly makes your site look current and maintained.",
    });
  }

  // =========================================================================
  // Build-quality checks
  // =========================================================================
  // These come from data the crawler and Lighthouse already collect but which only the SEO
  // report was showing. They are all squarely web-development concerns — dead links, HTTPS
  // configuration, page weight, accessibility — so a web-dev audit that omits them is
  // reporting less than it knows.

  // ---- Broken internal links ----
  if (s.checkedLinkCount !== null && s.checkedLinkCount > 0) {
    const broken = s.brokenInternalLinks.length;
    push({
      label: broken > 0
        ? `${broken} Broken Link${broken === 1 ? "" : "s"} on Your Site`
        : "All Links Working",
      status: broken > 0 ? "opportunity" : "good",
      category: BUILD,
      icon: "🔗",
      severity: 3,
      // Proportional: 2 dead links out of 40 is a different finding from 20 out of 40.
      ratio: Math.max(0, 1 - broken / s.checkedLinkCount),
      detail: broken > 0
        ? `We followed ${s.checkedLinkCount} links on your site and ${broken} led to an error page${s.brokenInternalLinks[0] ? `. For example: ${s.brokenInternalLinks[0]}` : ""}.`
        : `We followed ${s.checkedLinkCount} links across your site and every one of them worked.`,
      impact: broken > 0
        ? "A visitor who clicks a broken link usually leaves rather than hunting for the right page — and it makes the site feel neglected at the exact moment someone was interested enough to click."
        : "",
      fix: broken > 0
        ? "Each one needs the link corrected or a redirect added so the old address still reaches the right page."
        : "",
    });
  }

  // ---- HTTPS configuration ----
  if (s.redirectsToHttps !== null && s.hasSSL) {
    push({
      label: s.redirectsToHttps ? "Secure Connection Enforced" : "Insecure Version of Site Still Loads",
      status: s.redirectsToHttps ? "good" : "opportunity",
      category: TRUST,
      icon: "🔐",
      severity: 3,
      detail: s.redirectsToHttps
        ? "Anyone arriving at the http:// address is redirected to the secure https:// version automatically."
        : "Your site has a certificate, but the old http:// address still serves the site instead of redirecting to the secure version. Try typing http:// in front of your domain.",
      impact: s.redirectsToHttps
        ? ""
        : "Old links, printed material and directory listings often still point at http://. Visitors arriving that way get the unsecured page, and search engines can end up treating the two versions as separate sites.",
      fix: s.redirectsToHttps ? "" : "A server-level redirect from http:// to https:// — a configuration change rather than a rebuild.",
    });
  }

  // ---- Page weight ----
  if (s.pageSizeKB !== null && s.pageSizeKB > 0) {
    const heavy = s.pageSizeKB > 2048;
    push({
      label: heavy ? `Heavy Homepage — ${(s.pageSizeKB / 1024).toFixed(1)} MB` : `Homepage Weight — ${s.pageSizeKB} KB`,
      status: heavy ? "opportunity" : "good",
      category: SPEED,
      icon: "📦",
      severity: 2,
      // Scaled against a 2MB reference point rather than pass/fail at the threshold.
      ratio: Math.max(0, Math.min(1, 1 - (s.pageSizeKB - 500) / 3500)),
      detail: heavy
        ? `Your homepage transfers about ${(s.pageSizeKB / 1024).toFixed(1)} MB. On a mobile connection that is a meaningful wait before anything is usable.`
        : `Your homepage transfers about ${s.pageSizeKB} KB, which is a reasonable weight.`,
      impact: heavy
        ? "Page weight is usually the largest single cause of a slow mobile site, and it is almost always uncompressed images rather than anything structural."
        : "",
      fix: heavy ? "Compress and correctly size images, serve modern formats, and load below-the-fold media only when scrolled into view." : "",
    });
  }

  // ---- Accessibility ----
  const a11y = s.pageSpeed?.mobile?.accessibilityScore ?? s.pageSpeed?.desktop?.accessibilityScore;
  if (a11y !== undefined && a11y !== null) {
    const issueCount = (s.pageSpeed?.mobile?.accessibilityIssues || s.pageSpeed?.desktop?.accessibilityIssues || []).length;
    const ok = a11y >= 90;
    push({
      label: ok ? `Accessibility — ${a11y}/100` : `Accessibility Issues — ${a11y}/100`,
      status: ok ? "good" : "opportunity",
      category: BUILD,
      icon: "♿",
      severity: 2,
      // Lighthouse accessibility already contributes to the headline score as part of the
      // Google quality component; counting it here as well would double-count it.
      excludeFromScore: true,
      detail: ok
        ? `Google Lighthouse rates the accessibility of your site at ${a11y} out of 100.`
        : `Google Lighthouse rates the accessibility of your site at ${a11y} out of 100${issueCount ? `, flagging ${issueCount} specific issue${issueCount === 1 ? "" : "s"}` : ""}. This is reproducible at pagespeed.web.dev.`,
      impact: ok
        ? ""
        : "Accessibility problems — unlabelled buttons, low contrast text, tap targets too small — affect real customers using phones, older eyes and screen readers. In several markets they also carry legal exposure for a business website.",
      fix: ok ? "" : "Most issues are contrast, form labels and image descriptions, all fixable without redesigning the site.",
    });
  }

  // ---- Image alt text ----
  if (s.altTextCoverage !== null && s.imageCount !== null && s.imageCount > 0) {
    const good = s.altTextCoverage >= 80;
    push({
      label: good ? `Image Descriptions — ${s.altTextCoverage}% Complete` : `Missing Image Descriptions — ${s.altTextCoverage}% Complete`,
      status: good ? "good" : "opportunity",
      category: BUILD,
      icon: "🖼️",
      severity: 2,
      ratio: s.altTextCoverage / 100,
      detail: good
        ? `${s.imagesWithAlt} of ${s.imageCount} images carry a text description.`
        : `Only ${s.imagesWithAlt} of ${s.imageCount} images on your site carry a text description.`,
      impact: good
        ? ""
        : "Image descriptions are what screen readers announce, what shows when an image fails to load, and what lets your photos appear in Google Images. They are usually left blank simply because nobody filled them in.",
      fix: good ? "" : "Add a short, plain description to each meaningful image — decorative images should be left deliberately empty.",
    });
  }

  return checks;
}
