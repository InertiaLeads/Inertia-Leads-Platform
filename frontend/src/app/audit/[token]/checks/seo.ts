import type { AuditSignals, Check } from "../types";

// =============================================
// SEO audit findings
// =============================================
// Organised into the sections the report renders: Technical SEO, On-Page SEO,
// Structured Data, Local SEO Readiness, Performance.
//
// Wording rules (non-negotiable — these reports go to strangers who know their own
// site better than we do):
//   • "Not detected", never "does not use"
//   • "May reduce", never "will reduce"
//   • A deliberate configuration is a `warning`, not an `opportunity`
//   • Every finding must be something the reader can verify themselves

export function buildSeoChecks(s: AuditSignals, industry: string): Check[] {
  const checks: Check[] = [];
  const trade = (industry || "local business").toLowerCase();

  const push = (c: Check) => checks.push(c);

  // Google's own browser could not render this page — the single most consequential thing we
  // can observe, and fully reproducible by the reader.
  if (s.pageSpeed?.renderFailure) {
    push({
      label: "Google's Rendering Test Could Not Load Your Homepage",
      status: "opportunity",
      category: "Technical SEO",
      icon: "🚨",
      severity: 4,
      detail: "When Google's PageSpeed Insights loaded your homepage, the page completed without painting any content. This is reproducible at pagespeed.web.dev.",
      impact: "Google indexes pages with the same rendering engine. A homepage that renders blank for it risks being treated as an empty page, which affects how — and whether — it ranks.",
      fix: "Typically content that only appears after JavaScript runs, a render-blocking script, or a server stalling on the first request. Needs diagnosis against the live page.",
    });
  }

  // =========================================================================
  // TECHNICAL SEO
  // =========================================================================

  // ---- robots.txt ----
  if (s.hasRobotsTxt !== null) {
    if (!s.hasRobotsTxt) {
      push({
        label: "No robots.txt File Detected",
        status: "opportunity",
        category: "Technical SEO",
        icon: "🤖",
        severity: 1,
        detail: "No accessible robots.txt file was found at the root of the domain. This is the file search engines look for first to understand which parts of a site they should crawl.",
        impact: "A missing robots.txt is not an error on its own — crawlers assume everything is allowed. It does mean there is no place to declare a sitemap, and no way to steer crawl activity away from low-value pages.",
        fix: "Add a robots.txt file that permits crawling of public pages and declares the XML sitemap location.",
      });
    } else if (s.robotsBlocksSite) {
      push({
        label: "robots.txt Appears to Block the Entire Site",
        status: "opportunity",
        category: "Technical SEO",
        icon: "🚫",
        severity: 3,
        detail: `The robots.txt file contains a rule that disallows all crawlers from the whole site (\`Disallow: /\` for \`User-agent: *\`). You can check this yourself by visiting /robots.txt on the domain.`,
        impact: "While that rule is in place, search engines are asked not to crawl any page. This is one of the few technical settings that can remove a site from search results entirely — though it is sometimes left over from a staging environment rather than intentional.",
        fix: "Review the robots.txt rules and confirm whether the site-wide block is intended. If it isn't, restrict the disallow rules to the specific paths that should stay private.",
      });
    } else if (s.robotsBlockedPaths.length > 0) {
      push({
        label: "robots.txt Restricts Some Sections",
        status: "warning",
        category: "Technical SEO",
        icon: "🤖",
        severity: 1,
        detail: `A robots.txt file was found, and it restricts crawlers from ${s.robotsBlockedPaths.length} path${s.robotsBlockedPaths.length === 1 ? "" : "s"} beyond the usual admin and checkout areas${s.robotsBlockedPaths.length ? ` (for example ${s.robotsBlockedPaths.slice(0, 2).join(", ")})` : ""}.`,
        impact: "Restricting paths is often deliberate. It is worth confirming that none of the blocked sections contain pages that should be discoverable in search.",
        fix: "Review the disallow rules and confirm each blocked path is intentional.",
      });
    } else {
      push({
        label: "robots.txt Present and Permissive",
        status: "good",
        category: "Technical SEO",
        icon: "🤖",
        severity: 1,
        detail: "A robots.txt file was found and it does not restrict crawlers from the site's public content.",
        impact: "",
        fix: "",
      });
    }
  }

  // ---- XML sitemap ----
  if (s.hasSitemap !== null) {
    if (s.hasSitemap) {
      const count = s.sitemapUrlCount ?? 0;
      push({
        label: count > 0 ? `XML Sitemap Found — ${count} URL${count === 1 ? "" : "s"} Listed` : "XML Sitemap Found",
        status: "good",
        category: "Technical SEO",
        icon: "🗺️",
        severity: 1,
        detail: count > 0
          ? `An accessible ${s.isSitemapIndex ? "XML sitemap index" : "XML sitemap"} was detected listing ${count} URL${count === 1 ? "" : "s"}${s.robotsSitemapDeclared ? ", and it is declared in robots.txt" : ""}.`
          : "An accessible XML sitemap was detected.",
        impact: "",
        fix: "",
      });
      if (!s.robotsSitemapDeclared && s.hasRobotsTxt) {
        push({
          label: "Sitemap Not Declared in robots.txt",
          status: "opportunity",
          category: "Technical SEO",
          icon: "🔗",
          severity: 1,
          detail: "A sitemap was found, but no `Sitemap:` line was detected inside robots.txt.",
          impact: "Declaring the sitemap in robots.txt is the standard way to point every crawler at it without relying on manual submission in each search console.",
          fix: "Add a `Sitemap:` line to robots.txt pointing at the sitemap URL.",
        });
      }
    } else {
      push({
        label: "No XML Sitemap Detected",
        status: "opportunity",
        category: "Technical SEO",
        icon: "🗺️",
        severity: 2,
        detail: "No accessible XML sitemap was found at the conventional locations (/sitemap.xml, /sitemap_index.xml) or declared in robots.txt.",
        impact: "A sitemap helps search engines discover pages efficiently, particularly pages that aren't linked prominently from the homepage. Without one, discovery relies entirely on internal links being followed.",
        fix: "Generate an XML sitemap covering the site's important pages, declare it in robots.txt, and submit it in Google Search Console.",
      });
    }
  }

  // ---- HTTPS ----
  if (s.hasSSL !== null) {
    push({
      label: s.hasSSL ? "SSL Certificate Active (HTTPS)" : "No SSL Certificate Detected",
      status: s.hasSSL ? "good" : "opportunity",
      category: "Technical SEO",
      icon: "🔒",
      severity: 3,
      detail: s.hasSSL
        ? "The site serves content over HTTPS. Google has confirmed HTTPS as a ranking signal since 2014."
        : "The site did not respond over HTTPS during our checks. Chrome labels pages served over plain HTTP as \"Not Secure\" in the address bar.",
      impact: s.hasSSL ? "" : "HTTPS is a confirmed (if lightweight) ranking signal, and the browser warning is visible to every visitor before they read a word of the page.",
      fix: s.hasSSL ? "" : "Install an SSL certificate, then redirect all HTTP traffic to HTTPS and resolve any mixed-content warnings.",
    });
  }

  // ---- HTTP → HTTPS redirect ----
  // Distinct from having a certificate: plenty of sites serve both versions.
  if (s.redirectsToHttps !== null && s.hasSSL) {
    push({
      label: s.redirectsToHttps ? "HTTP Traffic Redirects to HTTPS" : "HTTP Version Does Not Redirect to HTTPS",
      status: s.redirectsToHttps ? "good" : "opportunity",
      category: "Technical SEO",
      icon: "↪️",
      severity: 2,
      detail: s.redirectsToHttps
        ? "Requests to the http:// version of the site are redirected to the secure https:// version."
        : "The http:// version of the site responded without redirecting to https://. You can verify this by typing the address with http:// in front of it.",
      impact: s.redirectsToHttps ? "" : "When both versions respond, search engines can treat them as two separate sites. That may split ranking signals between them, and some visitors stay on the insecure version.",
      fix: s.redirectsToHttps ? "" : "Add a server-level 301 redirect from every HTTP URL to its HTTPS equivalent.",
    });
  }

  // ---- Canonical tag ----
  if (s.hasCanonical !== null) {
    if (s.canonicalIssue) {
      push({
        label: "Canonical Tag May Be Misconfigured",
        status: "opportunity",
        category: "Technical SEO",
        icon: "🏷️",
        severity: 2,
        detail: `${s.canonicalIssue}.`,
        impact: "A canonical tag tells search engines which URL is the definitive version of a page. When it points somewhere unexpected, ranking signals may be attributed to the wrong URL.",
        fix: "Review the canonical tag on each template and confirm it points at the intended version of the page.",
      });
    } else if (s.hasCanonical) {
      push({
        label: "Canonical Tag Present",
        status: "good",
        category: "Technical SEO",
        icon: "🏷️",
        severity: 1,
        detail: "The homepage declares a canonical URL, which helps search engines consolidate ranking signals onto a single version of the page.",
        impact: "",
        fix: "",
      });
    } else {
      push({
        label: "No Canonical Tag Detected",
        status: "opportunity",
        category: "Technical SEO",
        icon: "🏷️",
        severity: 1,
        detail: "No `rel=\"canonical\"` link was found on the analyzed page.",
        impact: "Without a canonical tag, variations of the same page (with and without a trailing slash, with tracking parameters, http and https) may be treated as separate pages, which can dilute ranking signals.",
        fix: "Add a self-referencing canonical tag to each page template.",
      });
    }
  }

  // ---- Indexability ----
  // Intentional noindex is a legitimate choice — reported as a warning, never a failure.
  if (s.hasNoindex !== null) {
    if (s.hasNoindex) {
      push({
        label: "Noindex Directive Detected",
        status: "warning",
        category: "Technical SEO",
        icon: "🔍",
        severity: 3,
        detail: `A \`noindex\` directive was detected via the ${s.noindexSource || "robots meta tag"} on the analyzed page.`,
        impact: "A noindex directive asks search engines to keep the page out of their results. This is sometimes intentional — but when it is left over from a redesign or staging site, it removes the page from search entirely.",
        fix: "Confirm whether the noindex is intentional. If it isn't, remove the directive and request re-indexing in Google Search Console.",
      });
    } else if (s.hasNofollow) {
      push({
        label: "Nofollow Directive Detected",
        status: "warning",
        category: "Technical SEO",
        icon: "🔍",
        severity: 1,
        detail: "A `nofollow` directive was detected on the analyzed page, which asks search engines not to follow the links it contains.",
        impact: "This can limit how crawlers discover the rest of the site from this page.",
        fix: "Confirm the directive is intentional; if not, remove it so internal links pass discovery signals normally.",
      });
    } else {
      push({
        label: "Page Is Indexable",
        status: "good",
        category: "Technical SEO",
        icon: "🔍",
        severity: 1,
        detail: "No noindex or nofollow directive was detected, so the analyzed page is open to search engines.",
        impact: "",
        fix: "",
      });
    }
  }

  // ---- Broken internal links ----
  if (s.checkedLinkCount !== null && s.checkedLinkCount > 0) {
    const broken = s.brokenInternalLinks.length;
    if (broken > 0) {
      push({
        label: `${broken} Internal Link${broken === 1 ? "" : "s"} Returned an Error`,
        status: "opportunity",
        category: "Technical SEO",
        icon: "🔗",
        severity: 3,
        // Proportional: 2 dead links out of 40 is not the same finding as 20 out of 40.
        ratio: Math.max(0, 1 - broken / s.checkedLinkCount),
        detail: `Of ${s.checkedLinkCount} internal links checked, ${broken} returned an error response${broken ? `. For example: ${s.brokenInternalLinks[0]}` : ""}.`,
        impact: "Visitors who follow a broken link reach a dead end, and crawlers waste crawl activity on URLs that return nothing. On a small site this is usually a handful of quick fixes.",
        fix: "Update or remove the links that no longer resolve, and add redirects for any pages that have moved.",
      });
    } else {
      push({
        label: `Internal Links Resolving Correctly`,
        status: "good",
        category: "Technical SEO",
        icon: "🔗",
        severity: 1,
        detail: `All ${s.checkedLinkCount} internal links we sampled returned a working response.`,
        impact: "",
        fix: "",
      });
    }

    // Only flag redirect chains when there are enough to represent a pattern.
    if (s.redirectingInternalLinks.length >= 3) {
      push({
        label: `${s.redirectingInternalLinks.length} Internal Links Point to Redirects`,
        status: "opportunity",
        category: "Technical SEO",
        icon: "↩️",
        severity: 1,
        detail: `${s.redirectingInternalLinks.length} of the internal links we sampled redirect to a different URL rather than linking to the final destination directly.`,
        impact: "Each redirect adds a step before the page loads. It is a minor effect individually, but updating the links to their final destination is a simple tidy-up.",
        fix: "Update internal links to point directly at their final URLs.",
      });
    }
  }

  // ---- Mobile-friendly ----
  if (s.isMobileFriendly !== null) {
    push({
      label: s.isMobileFriendly ? "Mobile-Friendly Configuration Detected" : "Mobile Viewport Not Configured",
      status: s.isMobileFriendly ? "good" : "opportunity",
      category: "Technical SEO",
      icon: "📱",
      severity: 3,
      detail: s.isMobileFriendly
        ? "The page declares a mobile viewport, so it is set up to adapt to phone screens."
        : "No usable mobile viewport declaration was detected. Pages without one typically render at desktop width on a phone, requiring visitors to pinch and zoom.",
      impact: s.isMobileFriendly ? "" : "Google has used mobile-first indexing for all sites since 2023, meaning the mobile version is what gets assessed. A poor mobile experience may affect visibility across all devices.",
      fix: s.isMobileFriendly ? "" : "Add a responsive viewport meta tag and review the layout across common phone screen sizes.",
    });
  }

  // =========================================================================
  // ON-PAGE SEO
  // =========================================================================

  // ---- Page title ----
  if (s.hasTitle !== null) {
    const len = s.titleLength ?? 0;
    if (!s.hasTitle) {
      push({
        label: "No Page Title Detected",
        status: "opportunity",
        category: "On-Page SEO",
        icon: "📄",
        severity: 3,
        detail: "No `<title>` element was found on the analyzed page.",
        impact: "The title is the clickable headline in search results and the label in browser tabs. Without one, search engines generate their own from page content, which rarely reads the way a business would choose.",
        fix: "Add a unique, descriptive title to every page — typically the service plus the location for a local business.",
      });
    } else if (len < 30) {
      push({
        label: `Short Page Title — ${len} Characters`,
        status: "opportunity",
        category: "On-Page SEO",
        icon: "📄",
        severity: 1,
        detail: `The page title is ${len} characters long. Titles in the 30–60 character range generally use the available space in search results without being cut off.`,
        impact: "A very short title leaves room unused that could describe the service and location, which is often what a searcher is scanning for.",
        fix: "Expand the title to describe the service and service area, staying roughly within 60 characters. Treat the range as a guideline rather than a rule.",
      });
    } else if (len > 60) {
      push({
        label: `Long Page Title — ${len} Characters`,
        status: "warning",
        category: "On-Page SEO",
        icon: "📄",
        severity: 1,
        detail: `The page title is ${len} characters long. Search results typically truncate titles beyond roughly 60 characters.`,
        impact: "The end of the title may not be visible in search results, so any wording placed there could go unread.",
        fix: "Move the most important words to the front of the title and consider trimming it toward 60 characters.",
      });
    } else {
      push({
        label: `Page Title Well-Sized — ${len} Characters`,
        status: "good",
        category: "On-Page SEO",
        icon: "📄",
        severity: 1,
        detail: `The page title is ${len} characters, comfortably within the range that displays in full in search results.`,
        impact: "",
        fix: "",
      });
    }
  }

  // ---- Meta description ----
  if (s.hasMetaDescription !== null) {
    push({
      label: s.hasMetaDescription ? "Meta Description Present" : "No Meta Description Detected",
      status: s.hasMetaDescription ? "good" : "opportunity",
      category: "On-Page SEO",
      icon: "📝",
      severity: 2,
      detail: s.hasMetaDescription
        ? "The page provides a meta description, which search engines can use as the summary beneath the listing."
        : "No meta description was found on the analyzed page. Search a business name on Google and compare the snippet shown with what you would want a customer to read.",
      impact: s.hasMetaDescription ? "" : "When no description is provided, search engines assemble one from whatever page text seems relevant. That excerpt often reads as fragments rather than a reason to click.",
      fix: s.hasMetaDescription ? "" : "Write a unique 150–160 character description for each page that states the service, the area covered, and a reason to choose the business.",
    });
  }

  // ---- Heading structure ----
  if (s.h1Count !== null) {
    const h1 = s.h1Count;
    const issues = s.headingIssues || [];
    if (h1 === 0) {
      push({
        label: "No H1 Heading Detected",
        status: "opportunity",
        category: "On-Page SEO",
        icon: "🔠",
        severity: 2,
        detail: "No H1 element was found on the analyzed page. The H1 is normally the main on-page headline describing what the page is about.",
        impact: "The H1 is one of the clearest signals of a page's topic for both search engines and screen readers. Without one, that context has to be inferred from elsewhere.",
        fix: "Add a single descriptive H1 to each page that states what the page covers.",
      });
    } else if (h1 > 1) {
      push({
        label: `Multiple H1 Headings Detected — ${h1} Found`,
        status: "warning",
        category: "On-Page SEO",
        icon: "🔠",
        severity: 1,
        detail: `${h1} H1 elements were found on a single page. Modern HTML permits this, but it does make the page's primary topic less clear-cut.`,
        impact: "A single, unambiguous H1 makes the page structure easier for search engines and assistive technology to interpret.",
        fix: "Keep one H1 as the page headline and demote the remaining ones to H2 or H3 to form a clear outline.",
      });
    } else if (issues.length === 0) {
      push({
        label: "Clear Heading Structure",
        status: "good",
        category: "On-Page SEO",
        icon: "🔠",
        severity: 1,
        detail: "The page uses a single H1 with a consistent heading hierarchy beneath it.",
        impact: "",
        fix: "",
      });
    }

    // Structural problems beyond the H1 count itself.
    const structural = issues.filter((i) => /skip a step|empty heading|Almost no heading/i.test(i));
    if (structural.length > 0) {
      push({
        label: "Heading Hierarchy Could Be Clearer",
        status: "opportunity",
        category: "On-Page SEO",
        icon: "🪜",
        severity: 1,
        detail: `${structural.join(". ")}.`,
        impact: "Headings form the document outline that search engines and screen readers rely on to understand how a page is organised.",
        fix: "Use headings in order (H1 → H2 → H3) without skipping levels, and remove or fill any empty heading elements.",
      });
    }
  }

  // ---- Image alt text ----
  if (s.altTextCoverage !== null && (s.imageCount ?? 0) > 0) {
    const coverage = s.altTextCoverage;
    const missing = s.imagesWithoutAlt ?? 0;
    if (coverage >= 80) {
      push({
        label: `Image Alt Text — ${coverage}% Coverage`,
        status: "good",
        category: "On-Page SEO",
        icon: "🖼️",
        severity: 1,
        detail: `${s.imagesWithAlt} of ${s.imageCount} images analyzed carry descriptive alt text.`,
        impact: "",
        fix: "",
      });
    } else {
      // An empty alt="" is correct markup for a decorative image, so it's reported
      // separately rather than lumped in with images that have no alt attribute at all.
      const empty = s.emptyAltCount ?? 0;
      const genuinelyMissing = Math.max(0, missing - empty);
      push({
        label: `Image Optimization — ${coverage}% Alt-Text Coverage`,
        status: "opportunity",
        category: "On-Page SEO",
        icon: "🖼️",
        severity: 2,
        // 34% coverage used to score identically to 0%. It now scores 0.34 of the weight.
        ratio: coverage / 100,
        detail: empty > 0
          ? `${missing} of ${s.imageCount} images analyzed carry no descriptive alt text — ${genuinelyMissing} have no alt attribute at all, and ${empty} use an empty alt="" (valid for decorative images).`
          : `${missing} of ${s.imageCount} images analyzed do not contain descriptive alt attributes.`,
        impact: "Alt text is how search engines interpret an image and how screen-reader users experience it. For a business whose work is largely visual, it is also the only way image search can surface that work.",
        fix: "Add short, factual alt text describing each meaningful image. Decorative images can keep an empty alt attribute deliberately.",
      });
    }
  }

  // ---- Content depth ----
  if (s.wordCount !== null) {
    if (s.isThinContent) {
      push({
        label: `Limited Visible Content — ~${s.wordCount} Words`,
        status: "opportunity",
        category: "On-Page SEO",
        icon: "📰",
        severity: 3,
        // Scaled against ~600 words, the point where a local service page has room to answer
        // what a customer actually wants to know. 120 words scores 0.2, not 0.
        ratio: Math.min(1, (s.wordCount ?? 0) / 600),
        detail: `Approximately ${s.wordCount} words of visible text were detected on the analyzed page.`,
        impact: "Pages with little text give search engines less to work with when matching a page to what someone searched for. It also leaves fewer opportunities to answer the questions a prospective customer has before getting in touch.",
        fix: `Expand the page with genuinely useful detail — services offered, areas covered, what to expect, and common questions ${trade} customers ask.`,
      });
    } else {
      push({
        label: `Content Depth — ~${s.wordCount} Words`,
        status: "good",
        category: "On-Page SEO",
        icon: "📰",
        severity: 1,
        detail: `The analyzed page contains approximately ${s.wordCount} words of visible content, enough for search engines to understand its topic.`,
        impact: "",
        fix: "",
      });
    }
  }

  // ---- Duplicate metadata across crawled pages ----
  const pages = s.pagesAnalyzed ?? 0;
  if (pages >= 2) {
    const dupTitles = s.duplicateTitleCount ?? 0;
    const dupDescs = s.duplicateMetaDescriptionCount ?? 0;
    const dupH1 = s.duplicateH1Count ?? 0;

    if (dupTitles >= 2) {
      const example = s.duplicateTitles[0];
      push({
        label: `Duplicate Page Titles Across ${dupTitles} Pages`,
        status: "opportunity",
        category: "On-Page SEO",
        icon: "📑",
        severity: 2,
        detail: `Of the ${pages} pages analyzed, ${dupTitles} share an identical title tag${example ? ` — for example, "${example.length > 70 ? example.slice(0, 70) + "…" : example}"` : ""}.`,
        impact: "When several pages carry the same title, search engines have less to distinguish them, and the search listing gives a searcher no clue which page answers their question.",
        fix: "Give each page a distinct title reflecting its specific service, location or topic.",
      });
    }
    if (dupDescs >= 2) {
      push({
        label: `Duplicate Meta Descriptions Across ${dupDescs} Pages`,
        status: "opportunity",
        category: "On-Page SEO",
        icon: "📑",
        severity: 1,
        detail: `Of the ${pages} pages analyzed, ${dupDescs} share an identical meta description.`,
        impact: "A repeated description means several listings read the same way in search results, which makes it harder for a searcher to pick the right page.",
        fix: "Write a description specific to each page's content.",
      });
    }
    if (dupH1 >= 2) {
      const exampleH1 = s.duplicateH1s[0];
      push({
        label: `Duplicate H1 Headings Across ${dupH1} Pages`,
        status: "warning",
        category: "On-Page SEO",
        icon: "📑",
        severity: 1,
        detail: `Of the ${pages} pages analyzed, ${dupH1} use the same H1 heading text${exampleH1 ? ` — "${exampleH1.length > 60 ? exampleH1.slice(0, 60) + "…" : exampleH1}"` : ""}.`,
        impact: "Identical headings make pages harder to tell apart, both for visitors landing from search and for crawlers assessing what each page is for.",
        fix: "Give each page an H1 that names its own subject.",
      });
    }
    if (dupTitles < 2 && dupDescs < 2 && dupH1 < 2) {
      push({
        label: "Unique Metadata Across Analyzed Pages",
        status: "good",
        category: "On-Page SEO",
        icon: "📑",
        severity: 1,
        detail: `Each of the ${pages} pages analyzed uses its own title, description and heading.`,
        impact: "",
        fix: "",
      });
    }
  }

  // ---- hreflang (only meaningful for multilingual sites) ----
  if (s.hasHreflang) {
    if (s.hreflangIssues.length > 0) {
      push({
        label: "Hreflang Declarations Need Review",
        status: "opportunity",
        category: "On-Page SEO",
        icon: "🌐",
        severity: 1,
        detail: `Hreflang tags were detected for ${s.hreflangLanguages.length} language variant${s.hreflangLanguages.length === 1 ? "" : "s"}, but there are issues: ${s.hreflangIssues.join("; ")}.`,
        impact: "Hreflang tells search engines which language version to show which audience. Malformed or duplicated values may be ignored, leaving the wrong version surfaced.",
        fix: "Correct the hreflang values to valid language or language-region codes and remove duplicates.",
      });
    } else {
      push({
        label: `Multilingual Setup — ${s.hreflangLanguages.length} Language Variant${s.hreflangLanguages.length === 1 ? "" : "s"}`,
        status: "good",
        category: "On-Page SEO",
        icon: "🌐",
        severity: 1,
        detail: `Valid hreflang declarations were detected for: ${s.hreflangLanguages.slice(0, 6).join(", ")}.`,
        impact: "",
        fix: "",
      });
    }
  }

  // =========================================================================
  // STRUCTURED DATA
  // =========================================================================

  if (s.hasSchemaMarkup !== null) {
    const types = s.schemaTypes || [];
    if (!s.hasSchemaMarkup && types.length === 0) {
      push({
        label: "No Structured Data Detected",
        status: "opportunity",
        category: "Structured Data",
        icon: "🧩",
        severity: 2,
        detail: "No schema markup (JSON-LD, microdata or RDFa) was detected on the analyzed pages.",
        impact: "Structured data is how a site states its business type, hours, services and reviews in a format search engines read directly. Without it, that information has to be inferred from page text, and rich result formats generally aren't available.",
        fix: "Add LocalBusiness schema covering name, address, phone, hours and services, plus FAQ schema where the site answers common questions.",
      });
    } else {
      push({
        label: types.length > 0 ? `Structured Data Detected — ${types.length} Type${types.length === 1 ? "" : "s"}` : "Structured Data Detected",
        status: "good",
        category: "Structured Data",
        icon: "🧩",
        severity: 1,
        detail: types.length > 0
          ? `Schema markup was detected declaring: ${types.slice(0, 8).join(", ")}${types.length > 8 ? ", and others" : ""}.`
          : "Schema markup was detected on the analyzed pages.",
        impact: "",
        fix: "",
      });

      // The high-value follow-up: schema exists, but not the local kind.
      if (s.hasLocalBusinessSchema === false) {
        push({
          label: "No LocalBusiness Schema Type Found",
          status: "opportunity",
          category: "Structured Data",
          icon: "📍",
          severity: 2,
          detail: `Structured data was detected, but none of the declared types (${types.slice(0, 5).join(", ")}) correspond to a LocalBusiness-related schema.`,
          impact: "LocalBusiness schema is the type search engines associate with a physical, service-area business — it carries the address, opening hours, service area and review data used to build a local listing.",
          fix: `Add a LocalBusiness schema type appropriate to a ${trade}, including name, address, phone, hours and service area.`,
        });
      } else if (s.hasLocalBusinessSchema) {
        push({
          label: "LocalBusiness Schema Present",
          status: "good",
          category: "Structured Data",
          icon: "📍",
          severity: 1,
          detail: "A LocalBusiness-related schema type was detected, which is what search engines use to understand a business as a local entity.",
          impact: "",
          fix: "",
        });
      }
    }
  }

  // =========================================================================
  // LOCAL SEO READINESS
  // =========================================================================

  if (s.googleRating !== null) {
    const goodRating = s.googleRating >= 4.0;
    const reviews = s.googleReviewCount || 0;
    push({
      label: goodRating && reviews >= 10
        ? `Google Rating: ${s.googleRating}★ (${reviews} reviews)`
        : `Google Rating: ${s.googleRating}★ — ${reviews} Review${reviews === 1 ? "" : "s"}`,
      status: goodRating && reviews >= 10 ? "good" : "opportunity",
      category: "Local SEO Readiness",
      icon: "⭐",
      severity: 4,
      // Rating and volume both scale. 3 reviews and 40 reviews are not the same position.
      ratio: Math.min(1, (Math.min(1, reviews / 50) * 0.6) + (Math.max(0, Math.min(1, (s.googleRating - 3) / 2)) * 0.4)),
      detail: goodRating && reviews >= 10
        ? `A ${s.googleRating}-star rating across ${reviews} reviews was found — a strong signal for local pack rankings.`
        : `A ${s.googleRating}-star rating across ${reviews} review${reviews === 1 ? "" : "s"} was found.`,
      impact: goodRating && reviews >= 10 ? "" : "Review quantity and rating are among the factors Google weighs for local pack (map) results, and they are also what a prospective customer checks before calling.",
      fix: goodRating && reviews >= 10 ? "" : "Build a consistent process for requesting reviews from satisfied customers shortly after the work is completed.",
    });
  } else {
    push({
      label: "No Google Business Profile Detected",
      status: "opportunity",
      category: "Local SEO Readiness",
      icon: "⭐",
      severity: 3,
      detail: "We were unable to find a Google Business Profile associated with this business during our checks.",
      impact: "The local pack — the map results at the top of a local search — draws a large share of clicks for searches with local intent. A business without a profile generally isn't eligible to appear there.",
      fix: "Create and verify a Google Business Profile with complete category, service, hours and photo information, then build a review generation process.",
    });
  }

  if (s.napConsistency !== null) {
    const strong = s.napConsistency === "strong";
    const partial = s.napConsistency === "partial";
    push({
      label: strong
        ? "Business Contact Details Clearly Published"
        : partial
        ? "Business Contact Details Partially Published"
        : "Limited Business Contact Details Detected",
      status: strong ? "good" : "opportunity",
      category: "Local SEO Readiness",
      icon: "🏢",
      severity: strong ? 1 : 2,
      detail: [
        s.hasBusinessAddress ? "a physical address was detected" : "no physical address was detected",
        s.hasVisiblePhone ? "a phone number was detected" : "no visible phone number was detected",
        s.hasLocalBusinessSchema ? "and contact details are backed by structured data" : "and contact details are not backed by structured data",
      ].join(", ").replace(/^./, (c) => c.toUpperCase()) + " on the analyzed pages.",
      impact: strong ? "" : "Search engines cross-reference a business's name, address and phone number across the web to establish it as a real local entity. Details that are missing from the site itself can't contribute to that.",
      fix: strong ? "" : "Publish the full business name, address and phone number in the site footer and on a contact page, and mirror them in LocalBusiness structured data.",
    });
  }

  if (s.socialPlatformCount !== null) {
    const count = s.socialPlatformCount;
    push({
      label: count >= 2 ? `Linked to ${count} Social Platforms` : count === 1 ? "One Social Profile Linked" : "No Social Profiles Linked",
      status: count >= 2 ? "good" : "opportunity",
      category: "Local SEO Readiness",
      icon: "👥",
      severity: 1,
      detail: count > 0
        ? `Links to ${s.socialPlatforms.join(", ")} were detected on the site.`
        : "No links to social media profiles were detected on the analyzed pages.",
      impact: count >= 2 ? "" : "Consistent profiles across the web help search engines connect the various references to a business into one recognised entity, and they give a visitor a way to check the business is active.",
      fix: count >= 2 ? "" : "Link the business's active profiles from the site footer, keeping the name and contact details identical across each one.",
    });
  }

  // =========================================================================
  // PERFORMANCE
  // =========================================================================

  const mobilePerf = s.pageSpeed?.mobile?.performanceScore;
  if (mobilePerf !== undefined && mobilePerf !== null) {
    const fast = mobilePerf >= 50;
    push({
      label: fast ? `Mobile Performance Score — ${mobilePerf}/100` : `Low Mobile Performance Score — ${mobilePerf}/100`,
      status: fast ? "good" : "opportunity",
      category: "Performance",
      icon: "⚡",
      severity: 2,
      // Mobile performance is a weighted component of the headline score in its own right;
      // counting it again here would double-count it.
      excludeFromScore: true,
      ratio: mobilePerf / 100,
      detail: `Google Lighthouse rates this site's mobile performance at ${mobilePerf} out of 100. You can reproduce this at pagespeed.web.dev by entering the site URL.`,
      impact: fast ? "" : "Core Web Vitals form part of Google's page experience signals, and slow-loading pages tend to see higher abandonment on mobile connections.",
      fix: fast ? "" : "Compress and correctly size images, minify render-blocking CSS and JavaScript, and enable caching at the server or CDN level.",
    });
  } else if (s.pageLoadTimeMs !== null) {
    const secs = (s.pageLoadTimeMs / 1000).toFixed(1);
    const fast = s.pageLoadTimeMs <= 3000;
    push({
      label: fast ? `Page Loaded in ${secs}s` : `Slow Page Load — ${secs}s`,
      status: fast ? "good" : "opportunity",
      category: "Performance",
      icon: "⚡",
      severity: 2,
      excludeFromScore: true,
      detail: `The homepage took approximately ${secs} seconds to respond during our check.`,
      impact: fast ? "" : "Google's own research reports that a majority of mobile visitors abandon a page that takes more than three seconds to load.",
      fix: fast ? "" : "Compress images, enable caching, and review hosting performance.",
    });
  }

  // ---- Google's own SEO sub-audits ----
  // These come from the Lighthouse run we already perform, so they cost nothing extra
  // and carry more authority than our own parsing.
  const lighthouseSeoIssues = s.pageSpeed?.mobile?.seoIssues || s.pageSpeed?.desktop?.seoIssues || [];
  if (lighthouseSeoIssues.length > 0) {
    push({
      label: `Google Lighthouse Flagged ${lighthouseSeoIssues.length} SEO Check${lighthouseSeoIssues.length === 1 ? "" : "s"}`,
      status: "opportunity",
      category: "Performance",
      icon: "🔬",
      severity: 2,
      detail: `Google's own automated SEO checks did not pass on: ${lighthouseSeoIssues.slice(0, 5).map((a) => a.title).join("; ")}${lighthouseSeoIssues.length > 5 ? `, and ${lighthouseSeoIssues.length - 5} more` : ""}.`,
      impact: "These are Google's own assessments, run through the same Lighthouse engine built into Chrome — they reflect what Google's tooling reports about the page rather than a third-party interpretation.",
      fix: "Work through the flagged checks in Chrome DevTools' Lighthouse panel, which lists the exact elements involved for each one.",
    });
  }

  if (s.hasAnalytics !== null) {
    push({
      label: s.hasAnalytics ? "Analytics Tracking Detected" : "No Analytics Tracking Detected",
      status: s.hasAnalytics ? "good" : "opportunity",
      category: "Performance",
      icon: "📊",
      severity: 2,
      detail: s.hasAnalytics
        ? "An analytics implementation was detected, so organic search traffic can be measured over time."
        : "No supported analytics implementation was detected on the analyzed pages.",
      impact: s.hasAnalytics ? "" : "Without analytics there is no record of which pages attract search traffic, which queries bring visitors in, or whether a change improved anything.",
      fix: s.hasAnalytics ? "" : "Install Google Analytics 4, connect Google Search Console, and define the actions that count as a lead.",
    });
  }

  return checks;
}
