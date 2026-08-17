import type { AuditSignals, Check } from "../types";

// =============================================
// Digital marketing audit findings
// =============================================
// Organised around the funnel the report renders: Measurement, Acquisition,
// Conversion, Retention & Nurturing.
//
// Same wording rules as the SEO checks — detection proves presence, but absence only
// proves we didn't find it in the HTML we fetched. Every negative finding says "not
// detected", and no finding claims a specific conversion or revenue figure.

export function buildMarketingChecks(s: AuditSignals, industry: string): Check[] {
  const checks: Check[] = [];
  const trade = (industry || "local business").toLowerCase();
  const push = (c: Check) => checks.push(c);

  // =========================================================================
  // MEASUREMENT
  // =========================================================================

  if (s.hasAnalytics !== null) {
    push({
      label: s.hasAnalytics ? "Website Analytics Detected" : "No Website Analytics Detected",
      status: s.hasAnalytics ? "good" : "opportunity",
      category: "Measurement",
      icon: "📊",
      severity: 3,
      detail: s.hasAnalytics
        ? "An analytics implementation was detected, so visitor numbers, traffic sources and on-site behaviour can be measured."
        : "No supported analytics implementation was detected on the analyzed pages.",
      impact: s.hasAnalytics ? "" : "Without analytics there is no record of how many people visit, where they arrive from, or which pages they leave on. Every marketing decision then rests on assumption rather than observation.",
      fix: s.hasAnalytics ? "" : "Install Google Analytics 4 and configure the events that represent a genuine lead — form submission, phone tap, booking completed.",
    });
  }

  if (s.hasTagManager !== null) {
    push({
      label: s.hasTagManager ? "Tag Manager Detected" : "No Tag Manager Detected",
      status: s.hasTagManager ? "good" : "opportunity",
      category: "Measurement",
      icon: "🏷️",
      severity: 1,
      detail: s.hasTagManager
        ? "Google Tag Manager was detected, which allows tracking to be added and changed without editing site code."
        : "No tag management container was detected on the analyzed pages.",
      impact: s.hasTagManager ? "" : "A tag manager isn't essential, but without one every new tracking tag requires a developer to edit the site, which tends to slow measurement work down considerably.",
      fix: s.hasTagManager ? "" : "Consider a tag manager container to centralise analytics and advertising tags.",
    });
  }

  if (s.hasGoogleAds !== null) {
    push({
      label: s.hasGoogleAds ? "Google Ads Conversion Tracking Detected" : "No Advertising Conversion Tracking Detected",
      status: s.hasGoogleAds ? "good" : "opportunity",
      category: "Measurement",
      icon: "💰",
      severity: 3,
      detail: s.hasGoogleAds
        ? "A Google Ads conversion tag was detected, so ad spend can be attributed to the enquiries it produces."
        : "No supported advertising conversion tag was detected on the analyzed pages.",
      impact: s.hasGoogleAds ? "" : "Without measurable conversion events, evaluating which campaigns, keywords or audiences actually generate enquiries becomes considerably more difficult — spend can only be judged by clicks, not outcomes.",
      fix: s.hasGoogleAds ? "" : "Review the advertising measurement setup and configure conversion actions for the events that represent a real enquiry.",
    });
  }

  if (s.hasHeatmapTool !== null) {
    const tools = [s.hasHotjar ? "Hotjar" : null, s.hasClarity ? "Microsoft Clarity" : null].filter(Boolean);
    push({
      label: s.hasHeatmapTool ? `Session Analysis Tool Detected${tools.length ? ` — ${tools.join(", ")}` : ""}` : "No Heatmap or Session Analysis Tool Detected",
      status: s.hasHeatmapTool ? "good" : "opportunity",
      category: "Measurement",
      icon: "🔥",
      severity: 1,
      detail: s.hasHeatmapTool
        ? `${tools.join(" and ")} was detected, which records how visitors scroll, click and move through pages.`
        : "No heatmap or session-recording tool was detected on the analyzed pages.",
      impact: s.hasHeatmapTool ? "" : "Analytics shows that visitors left; session analysis shows where they hesitated before leaving. Free options exist, so this is usually a low-effort addition.",
      fix: s.hasHeatmapTool ? "" : "Consider adding a free session-analysis tool such as Microsoft Clarity to see how visitors interact with key pages.",
    });
  }

  // =========================================================================
  // ACQUISITION
  // =========================================================================

  if (s.hasFacebookPixel !== null) {
    push({
      label: s.hasFacebookPixel ? "Meta Pixel Detected" : "No Meta Pixel Detected",
      status: s.hasFacebookPixel ? "good" : "opportunity",
      category: "Acquisition",
      icon: "🎯",
      severity: 2,
      detail: s.hasFacebookPixel
        ? "A Meta (Facebook/Instagram) Pixel was detected, so site visitors can form audiences for social advertising."
        : "No supported Meta Pixel implementation was detected on the analyzed pages.",
      impact: s.hasFacebookPixel ? "" : "A pixel is what allows a visitor who didn't enquire on their first visit to be reached again through Facebook or Instagram. Without one, that audience can't be built retrospectively — the data isn't collected until the pixel is installed.",
      fix: s.hasFacebookPixel ? "" : "Install the Meta Pixel and define the events worth tracking, even before running ads, so an audience accumulates from now on.",
    });
  }

  if (s.hasRetargeting !== null && s.hasFacebookPixel !== null) {
    const anyRetargeting = !!(s.hasRetargeting || s.hasFacebookPixel);
    push({
      label: anyRetargeting ? "Retargeting Capability Detected" : "No Retargeting Pixels Detected",
      status: anyRetargeting ? "good" : "opportunity",
      category: "Acquisition",
      icon: "🔄",
      severity: 2,
      detail: anyRetargeting
        ? "At least one retargeting pixel was detected, so visitors who leave without enquiring can be reached again through advertising."
        : "No retargeting pixels were detected across the platforms we check — Meta, TikTok, LinkedIn, X, Pinterest, Microsoft and Snapchat.",
      impact: anyRetargeting ? "" : "Most first-time visitors to a service business site leave without making contact. Retargeting is the mechanism for reaching them afterwards; without any pixel in place, that audience isn't being collected.",
      fix: anyRetargeting ? "" : "Install retargeting pixels for the platforms the business's customers actually use, and begin building audiences before spending on campaigns.",
    });
  }

  if (s.hasMicrosoftUET !== null && s.hasGoogleAds) {
    // Only worth raising once the business is clearly already advertising.
    push({
      label: s.hasMicrosoftUET ? "Microsoft Ads Tracking Detected" : "No Microsoft Ads Tracking Detected",
      status: s.hasMicrosoftUET ? "good" : "opportunity",
      category: "Acquisition",
      icon: "🅱️",
      severity: 1,
      detail: s.hasMicrosoftUET
        ? "A Microsoft Ads UET tag was detected alongside Google Ads tracking."
        : "Google Ads tracking was detected, but no Microsoft Ads UET tag was found.",
      impact: s.hasMicrosoftUET ? "" : "Bing and the wider Microsoft search network carry a smaller but often less competitive audience. For a business already running search ads, it is usually a low-cost extension rather than a new channel.",
      fix: s.hasMicrosoftUET ? "" : "Consider mirroring the existing search campaigns onto Microsoft Ads and installing the UET tag to measure them.",
    });
  }

  if (s.socialPresenceStrength !== null) {
    const count = s.socialPlatformCount ?? 0;
    const strong = s.socialPresenceStrength === "strong";
    push({
      label: strong
        ? `Active Across ${count} Social Platforms`
        : count > 0
        ? `Limited Social Presence — ${count} Platform${count === 1 ? "" : "s"} Linked`
        : "No Social Profiles Linked",
      status: strong ? "good" : "opportunity",
      category: "Acquisition",
      icon: "👥",
      severity: 1,
      detail: count > 0
        ? `Links to ${s.socialPlatforms.join(", ")} were detected on the site.`
        : "No links to social media profiles were detected on the analyzed pages.",
      impact: strong ? "" : `A prospective customer checking whether a ${trade} is active and reputable often looks for social profiles before making contact. Links that aren't published can't be found.`,
      fix: strong ? "" : "Link the business's active profiles from the site header or footer, and keep branding and contact details consistent across each.",
    });
  }

  if (s.hasOpenGraph !== null) {
    push({
      label: s.hasOpenGraph ? "Social Sharing Preview Configured" : "No Social Sharing Tags Detected",
      status: s.hasOpenGraph ? "good" : "opportunity",
      category: "Acquisition",
      icon: "🔗",
      severity: 1,
      detail: s.hasOpenGraph
        ? "Open Graph tags were detected, so links shared on social platforms and messaging apps display a title, description and image."
        : "No Open Graph title and image tags were detected. You can check this by pasting the site URL into a WhatsApp or Facebook message and looking at the preview.",
      impact: s.hasOpenGraph ? "" : "Without these tags, shared links tend to render as a bare URL with no image or description, which may reduce how often they get clicked when customers pass the business on.",
      fix: s.hasOpenGraph ? "" : "Add og:title, og:description and og:image tags to each page template.",
    });
  }

  if (s.googleRating !== null) {
    const goodRating = s.googleRating >= 4.0;
    const reviews = s.googleReviewCount || 0;
    push({
      label: goodRating && reviews >= 10 ? `Google Rating: ${s.googleRating}★ (${reviews} reviews)` : `Google Rating: ${s.googleRating}★ — ${reviews} Review${reviews === 1 ? "" : "s"}`,
      status: goodRating && reviews >= 10 ? "good" : "opportunity",
      category: "Acquisition",
      icon: "⭐",
      severity: 2,
      detail: goodRating && reviews >= 10
        ? `A ${s.googleRating}-star rating across ${reviews} reviews was found — solid social proof for anyone arriving from an ad.`
        : `A ${s.googleRating}-star rating across ${reviews} review${reviews === 1 ? "" : "s"} was found.`,
      impact: goodRating && reviews >= 10 ? "" : "Many people check reviews between clicking an ad and making contact. A thin or low review profile at that moment may reduce the return on advertising spend that has already been paid for.",
      fix: goodRating && reviews >= 10 ? "" : "Introduce a consistent process for requesting reviews from satisfied customers shortly after each job.",
    });
  } else {
    push({
      label: "No Google Business Profile Detected",
      status: "opportunity",
      category: "Acquisition",
      icon: "⭐",
      severity: 2,
      detail: "We were unable to find a Google Business Profile associated with this business during our checks.",
      impact: "A Google Business Profile carries the reviews, photos and contact details that appear alongside local search results — often the first impression a customer forms before visiting the website at all.",
      fix: "Create and verify a Google Business Profile with complete business information and photographs.",
    });
  }

  // =========================================================================
  // CONVERSION
  // =========================================================================

  // ---- CTA quality (deeper than simple presence) ----
  if (s.ctaStrength !== null) {
    const strength = s.ctaStrength;
    if (strength === "strong") {
      push({
        label: `Clear Call-to-Action — "${s.primaryCTA}"`,
        status: "good",
        category: "Conversion",
        icon: "👆",
        severity: 2,
        detail: `A high-intent call-to-action ("${s.primaryCTA}") was detected in the opening section of the page, so visitors are given an obvious next step immediately.`,
        impact: "",
        fix: "",
      });
    } else if (strength === "medium") {
      push({
        label: "Call-to-Action Could Be More Prominent",
        status: "opportunity",
        category: "Conversion",
        icon: "👆",
        severity: 2,
        detail: s.primaryCTA
          ? `Calls-to-action were detected (the clearest being "${s.primaryCTA}"), but no high-intent action appears in the opening section of the page.`
          : "Calls-to-action were detected, but none appear prominently in the opening section of the page.",
        impact: "A visitor deciding whether to make contact generally does so within the first screen. An action placed further down may be missed by those who don't scroll.",
        fix: "Place one clear, specific action in the opening section — \"Book an appointment\", \"Get a quote\", \"Call now\" — and keep it visible as the page scrolls.",
      });
    } else {
      push({
        label: "No Clear Call-to-Action Detected",
        status: "opportunity",
        category: "Conversion",
        icon: "👆",
        severity: 3,
        detail: s.ctaCount && s.ctaCount > 0
          ? `${s.ctaCount} link${s.ctaCount === 1 ? "" : "s"} and button${s.ctaCount === 1 ? "" : "s"} were detected, but none use action wording that asks the visitor to make contact — the detected text is mostly navigational ("learn more", "our services").`
          : "No prominent action button or high-intent link was detected on the homepage.",
        impact: "When there is no obvious next step, a visitor who is ready to make contact has to search for how. Some will; many close the page instead.",
        fix: `Add one primary action to the opening section — for a ${trade}, that is usually "Book an appointment", "Get a free quote" or a tappable phone number.`,
      });
    }
  }

  // ---- Competing calls-to-action ----
  // Only raised when several DIFFERENT high-intent actions share the opening screen.
  // Repeating one action down the page is good practice and is not flagged.
  if (s.competingCtas) {
    const texts = s.competingCtaTexts;
    push({
      label: `${texts.length} Competing Actions in the Opening Section`,
      status: "warning",
      category: "Conversion",
      icon: "🔀",
      severity: 1,
      detail: `Several different actions compete for attention above the fold: ${texts.map((t) => `"${t}"`).join(", ")}.`,
      impact: "Offering a visitor multiple different next steps at the same moment asks them to make a decision before they have decided anything. A single, repeated action is usually easier to follow.",
      fix: "Choose one primary action for the opening section and present the others as secondary options further down the page.",
    });
  }

  // ---- Conversion path (highest-value marketing finding) ----
  if (s.hasClearConversionPath !== null) {
    if (s.hasClearConversionPath) {
      const dest = s.conversionDestinationType;
      const destLabel =
        dest === "booking" ? "a booking system" :
        dest === "form" ? "a working enquiry form" :
        dest === "phone" ? "a tappable phone number" :
        dest === "email" ? "a contact email link" : "a working contact option";
      push({
        label: "Conversion Path Is Complete",
        status: "good",
        category: "Conversion",
        icon: "🛤️",
        severity: 3,
        detail: `The primary call-to-action leads to ${destLabel}, so a visitor who decides to make contact can complete that in one step.`,
        impact: "",
        fix: "",
      });
    } else {
      push({
        label: "Conversion Path Appears Incomplete",
        status: "opportunity",
        category: "Conversion",
        icon: "🛤️",
        severity: 3,
        detail: s.conversionPathIssues.length > 0
          ? `${s.conversionPathIssues.join(". ")}.`
          : "We were unable to trace a complete path from the homepage's main action to a place where a visitor can make contact.",
        impact: "A site can have a call-to-action, a contact form and working tracking, and still lose enquiries if the button doesn't lead to the form. This is the kind of gap that stays invisible in analytics because the visitor never reaches a page worth measuring.",
        fix: "Follow the site's main call-to-action as a visitor would and confirm the destination contains a working enquiry form, booking widget or clickable phone number.",
      });
    }
  }

  // ---- Lead form friction ----
  if (s.formFriction !== null) {
    const fields = s.formFieldCount ?? 0;
    const required = s.requiredFieldCount ?? 0;
    const friction = s.formFriction;
    if (friction === "low") {
      push({
        label: `Low-Friction Lead Form — ${fields} Field${fields === 1 ? "" : "s"}`,
        status: "good",
        category: "Conversion",
        icon: "📥",
        severity: 1,
        detail: `The primary enquiry form asks for ${fields} field${fields === 1 ? "" : "s"}${required > 0 ? `, ${required} of them required` : ""} — short enough to complete quickly.`,
        impact: "",
        fix: "",
      });
    } else {
      push({
        label: friction === "high" ? "Lead Form — High Friction" : "Lead Form — Moderate Friction",
        status: "opportunity",
        category: "Conversion",
        icon: "📥",
        severity: friction === "high" ? 2 : 1,
        detail: required > 0
          ? `The primary enquiry form requires ${required} field${required === 1 ? "" : "s"} before it can be submitted (${fields} in total)${s.formHasPhoneRequired ? ", including a mandatory phone number" : ""}.`
          : `The primary enquiry form contains ${fields} fields.`,
        impact: "Each additional required field is another reason for someone to abandon the form, particularly on a phone. A mandatory phone number in particular tends to deter visitors who would happily give an email address.",
        fix: "Reduce the required fields to what is genuinely needed to respond — usually a name, one contact method and a short message — and make the rest optional.",
      });
    }
  }

  // ---- Booking ----
  if (s.hasOnlineBooking !== null) {
    push({
      label: s.hasOnlineBooking ? "Online Booking Available" : "No Online Booking Detected",
      status: s.hasOnlineBooking ? "good" : "opportunity",
      category: "Conversion",
      icon: "📅",
      severity: 2,
      detail: s.hasOnlineBooking
        ? "A booking or scheduling system was detected, so customers can arrange an appointment without calling."
        : "No online booking or scheduling system was detected on the analyzed pages.",
      impact: s.hasOnlineBooking ? "" : `Enquiries from a ${trade} website often arrive outside working hours. Without a way to book directly, those visitors have to remember to call back the next day.`,
      fix: s.hasOnlineBooking ? "" : "Consider a scheduling tool connected to the business calendar, with automated confirmations and reminders.",
    });
  }

  // ---- Contact form ----
  if (s.hasContactForm !== null) {
    push({
      label: s.hasContactForm ? "Contact Form Detected" : "No Contact Form Detected",
      status: s.hasContactForm ? "good" : "opportunity",
      category: "Conversion",
      icon: "✉️",
      severity: 2,
      detail: s.hasContactForm
        ? "An enquiry form or live chat option was detected, giving visitors a way to make contact without phoning."
        : "No enquiry form or live chat option was detected on the analyzed pages.",
      impact: s.hasContactForm ? "" : "A form captures enquiries at any hour and suits visitors who would rather not call. Without one, the only route to contact is a phone call during business hours.",
      fix: s.hasContactForm ? "" : "Add a short enquiry form to the contact page and link to it from the site's main action button.",
    });
  }

  // ---- Live chat ----
  if (s.hasLiveChat !== null) {
    const chatTool = s.techByCategory?.chat?.[0];
    push({
      label: s.hasLiveChat ? `Live Chat Detected${chatTool ? ` — ${chatTool}` : ""}` : "No Live Chat Detected",
      status: s.hasLiveChat ? "good" : "opportunity",
      category: "Conversion",
      icon: "💬",
      severity: 1,
      detail: s.hasLiveChat
        ? `A live chat widget${chatTool ? ` (${chatTool})` : ""} was detected, offering visitors an immediate way to ask a question.`
        : "No live chat or messaging widget was detected on the analyzed pages.",
      impact: s.hasLiveChat ? "" : "Chat suits the visitor who has one question standing between them and an enquiry, and who won't phone to ask it.",
      fix: s.hasLiveChat ? "" : "Consider a chat widget, or a click-to-WhatsApp link if the business already handles enquiries that way.",
    });
  }

  // ---- Lead magnet ----
  if (s.hasLeadMagnet !== null) {
    push({
      label: s.hasLeadMagnet ? `Lead Magnet Detected — ${s.leadMagnetType}` : "No Lead Magnet Detected",
      status: s.hasLeadMagnet ? "good" : "opportunity",
      category: "Conversion",
      icon: "🎁",
      severity: 1,
      detail: s.hasLeadMagnet
        ? `A value-exchange offer was detected on the site (${s.leadMagnetType?.toLowerCase()}), giving visitors who aren't ready to buy a reason to leave their details.`
        : "No downloadable guide, free assessment, calculator or comparable offer was detected on the analyzed pages.",
      impact: s.hasLeadMagnet ? "" : "Visitors who are researching rather than buying rarely fill in a \"contact us\" form. An offer they get something for gives that group a reason to identify themselves.",
      fix: s.hasLeadMagnet ? "" : `Offer something genuinely useful in exchange for contact details — for a ${trade}, a free quote, checklist or short guide usually works.`,
    });
  }

  // ---- Conversion popup ----
  if (s.hasConversionPopup !== null) {
    push({
      label: s.hasConversionPopup ? `Conversion Overlay Detected${s.popupTechnology ? ` — ${s.popupTechnology}` : ""}` : "No Conversion Overlay Detected",
      status: s.hasConversionPopup ? "good" : "opportunity",
      category: "Conversion",
      icon: "🪟",
      severity: 1,
      detail: s.hasConversionPopup
        ? `An email-capture overlay${s.popupTechnology ? ` powered by ${s.popupTechnology}` : ""} was detected.`
        : "No email-capture overlay or exit-intent prompt was detected on the analyzed pages.",
      impact: s.hasConversionPopup ? "" : "A well-timed prompt — shown on exit intent rather than immediately — gives a leaving visitor one last, low-commitment reason to stay in contact.",
      fix: s.hasConversionPopup ? "" : "Consider an exit-intent prompt tied to a genuine offer, configured not to interrupt visitors as they arrive.",
    });
  }

  // =========================================================================
  // RETENTION & NURTURING
  // =========================================================================

  if (s.hasLeadCaptureForm !== null) {
    push({
      label: s.hasLeadCaptureForm ? "Email Capture Detected" : "No Email Capture Detected",
      status: s.hasLeadCaptureForm ? "good" : "opportunity",
      category: "Retention & Nurturing",
      icon: "📧",
      severity: 2,
      detail: s.hasLeadCaptureForm
        ? "A signup or subscription form was detected, so visitor email addresses can be collected for follow-up."
        : "No newsletter, signup or list-building form was detected on the analyzed pages.",
      impact: s.hasLeadCaptureForm ? "" : "Visitors who aren't ready to buy today leave no trace unless there is a way to collect their details. Without capture, re-contacting them later isn't possible.",
      fix: s.hasLeadCaptureForm ? "" : "Add a simple email capture tied to something worth receiving, and place it where visitors are already engaged.",
    });
  }

  if (s.hasEmailMarketing !== null) {
    const platform = s.techByCategory?.automation?.[0];
    push({
      label: s.hasEmailMarketing ? `Email Platform Detected${platform ? ` — ${platform}` : ""}` : "No Email Marketing Platform Detected",
      status: s.hasEmailMarketing ? "good" : "opportunity",
      category: "Retention & Nurturing",
      icon: "📮",
      severity: 2,
      detail: s.hasEmailMarketing
        ? `An email marketing platform${platform ? ` (${platform})` : ""} was detected, so automated follow-up sequences are possible.`
        : "No supported email marketing platform was detected on the analyzed pages.",
      impact: s.hasEmailMarketing ? "" : "Even with addresses collected, follow-up handled manually tends to stop happening once the business gets busy — which is usually when it matters most.",
      fix: s.hasEmailMarketing ? "" : "Connect an email platform and set up at least a welcome sequence, so every new enquiry receives a consistent first response.",
    });
  }

  if (s.hasHubSpot !== null) {
    const automationTools = s.techByCategory?.automation || [];
    const hasAutomation = automationTools.length > 0;
    push({
      label: hasAutomation ? `Marketing Automation Detected — ${automationTools.slice(0, 2).join(", ")}` : "No Marketing Automation Detected",
      status: hasAutomation ? "good" : "opportunity",
      category: "Retention & Nurturing",
      icon: "⚙️",
      severity: 1,
      detail: hasAutomation
        ? `${automationTools.slice(0, 3).join(", ")} detected on the site, indicating enquiries can be routed and followed up automatically.`
        : "No marketing automation or CRM integration was detected on the analyzed pages.",
      impact: hasAutomation ? "" : "Without automation, every enquiry depends on someone noticing it and replying. Response time is one of the few conversion factors a business fully controls.",
      fix: hasAutomation ? "" : "Consider connecting enquiries to a CRM with automatic acknowledgement and follow-up reminders.",
    });
  }

  return checks;
}
