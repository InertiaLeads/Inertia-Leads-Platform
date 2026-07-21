"use client";

import { useState, type ReactNode } from "react";

interface FAQ {
  question: string;
  answer: string;
  category: string;
}

const faqs: FAQ[] = [
  // Getting Started
  {
    category: "Getting Started",
    question: "How do I find leads for my business?",
    answer:
      "Go to Auto Lead Finder from the sidebar. Enter your target industry, location, and any keywords. Our AI will search and return high-quality leads with business names, addresses, and contact info. You can find up to 50 leads per search.",
  },
  {
    category: "Getting Started",
    question: "What happens after I find leads?",
    answer:
      "Once leads are found, they're added to a campaign. You can then enrich them — our AI visits their websites to extract emails, phone numbers, and business insights. After enrichment, each lead gets a score (0–100) so you can prioritize the best ones.",
  },
  {
    category: "Getting Started",
    question: "How do I send emails to my leads?",
    answer:
      "First, connect a Gmail or SMTP account in Settings. Then go to your campaign, select the leads you want to contact, and use the email generator. Our AI crafts personalized cold emails based on each lead's business data. You can review and edit before sending.",
  },
  {
    category: "Getting Started",
    question: "Can I upload my own leads?",
    answer:
      "Yes! Go to Upload Leads and import a CSV file with your existing contacts. The CSV should have columns like business name, email, phone, and website. Once uploaded, you can enrich and score them just like auto-found leads.",
  },
  // Lead Finding
  {
    category: "Lead Finding",
    question: "How does lead scoring work?",
    answer:
      "Each lead is scored from 0 to 100 based on multiple factors: whether they have a website, email, phone number, online reviews, social media presence, and how well they match your target criteria. Leads scoring 70+ are considered high-quality prospects.",
  },
  {
    category: "Lead Finding",
    question: "What does enrichment do?",
    answer:
      "Enrichment visits each lead's website and extracts valuable data — email addresses, phone numbers, business descriptions, technologies used, and whether they have online booking or contact forms. This data powers better lead scores and more personalized emails.",
  },
  {
    category: "Lead Finding",
    question: "Why are some phone numbers or emails missing?",
    answer:
      "Not all businesses list their contact info publicly on their websites. Some sites also block automated access. We extract what's available — the more established a business's online presence, the more complete their data will be.",
  },
  {
    category: "Lead Finding",
    question: "What does the 'Call Leads' number on the dashboard mean?",
    answer:
      "Call Leads are leads that have a phone number available. These are great for direct outreach — you can call them in addition to (or instead of) emailing them.",
  },
  // Email & Campaigns
  {
    category: "Email & Campaigns",
    question: "Why is there a warmup period for new email accounts?",
    answer:
      "Email providers like Gmail monitor sending patterns. If a new account suddenly sends hundreds of emails, it gets flagged as spam. The 21-day warmup gradually increases your daily send limit — starting small and building up — so your emails land in inboxes, not spam folders.",
  },
  {
    category: "Email & Campaigns",
    question: "Can I connect multiple email accounts?",
    answer:
      "Yes! The number of inboxes depends on your plan — Starter gets 1, Growth gets 2, and Scale gets 4. Multiple inboxes let you distribute sends across accounts for better deliverability and higher total daily volume.",
  },
  {
    category: "Email & Campaigns",
    question: "How do I avoid my emails going to spam?",
    answer:
      "We handle a lot of this automatically: emails are sent as plain text (so they read like a personal message and stay out of the Promotions tab), with send rate limiting, warm-up, personalized content, and a built-in opt-out line recipients can reply to. On your end: use a professional email address, keep your messages relevant and non-spammy, honour any opt-out requests promptly, and avoid ALL CAPS, excessive links, and spam trigger words.",
  },
  {
    category: "Email & Campaigns",
    question: "Can I use Outlook, Yahoo, or other email providers?",
    answer:
      "Yes! Besides Gmail, you can connect any email via SMTP — including Outlook, Yahoo, Zoho, Microsoft 365, or any custom SMTP server. Go to Settings and click 'Connect Email Account' under SMTP Accounts.",
  },
  // Account & Billing
  {
    category: "Account & Billing",
    question: "What are the plan limits?",
    answer:
      "Starter ($39/mo): 50 leads/day, 500 leads/month, 1 inbox, 50 daily emails. Growth ($79/mo): 50 leads/day, 1000 leads/month, 2 inboxes, 100 daily emails. Scale ($149/mo): 50 leads/day, 2000 leads/month, 4 inboxes, 200 daily emails.",
  },
  {
    category: "Account & Billing",
    question: "Can I upgrade or downgrade my plan?",
    answer:
      "Yes, you can change your plan anytime. Upgrades take effect immediately, and downgrades apply at the end of your current billing cycle. Your data and campaigns are preserved regardless of plan changes.",
  },
  {
    category: "Account & Billing",
    question: "How do I update my profile or change my password?",
    answer:
      "Click the avatar icon in the top-right corner and select Settings. From there you can update your name, bio, profile photo, and change your password.",
  },
];

const categories = [...new Set(faqs.map((f) => f.category))];

export default function HelpPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredFaqs = faqs.filter((faq) => {
    const matchesCategory =
      activeCategory === "All" || faq.category === activeCategory;
    const matchesSearch =
      !searchQuery ||
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const categoryIcons: Record<string, ReactNode> = {
    "Getting Started": <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />,
    "Lead Finding": <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
    "Email & Campaigns": <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />,
    "Account & Billing": <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
  };

  return (
    <div>
      {/* Hero Section with email contact */}
      <div className="relative overflow-hidden rounded-2xl p-8 md:p-12 mb-8" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #0d0a25 100%)" }}>
        <div className="absolute inset-0">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full" style={{ background: "radial-gradient(circle, rgba(105,98,196,0.15) 0%, transparent 70%)" }} />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full" style={{ background: "radial-gradient(circle, rgba(61,53,128,0.12) 0%, transparent 70%)" }} />
        </div>
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white">
              How can we help you?
            </h1>
            <p className="mt-3 text-base" style={{ color: "rgba(255,255,255,0.5)" }}>
              Browse by category below or reach out to us directly.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <a
              href="/user-guide"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-all shadow-sm hover:opacity-90"
              style={{ background: "rgba(105,98,196,0.2)", color: "#c4b5fd", border: "1px solid rgba(105,98,196,0.4)" }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              User Guide
            </a>
            <a
              href="mailto:info@inertialeads.com"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-all shadow-sm hover:opacity-90"
              style={{ background: "rgba(105,98,196,0.2)", color: "#c4b5fd", border: "1px solid rgba(105,98,196,0.4)" }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            info@inertialeads.com
            </a>
          </div>
        </div>
      </div>

      {/* Category Filter Pills + Search */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {["All", ...categories].map((cat) => {
          return (
            <button
              key={cat}
              onClick={() => {
                setActiveCategory(cat);
                setOpenIndex(null);
              }}
              className={`px-4 py-2 text-sm font-medium rounded-full transition-all ${
                activeCategory === cat
                  ? "text-white shadow-sm"
                  : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:text-gray-900"
              }`}
              style={activeCategory === cat ? { background: "rgba(105,98,196,0.9)", boxShadow: "0 2px 8px rgba(105,98,196,0.3)" } : undefined}
            >
              {cat}
            </button>
          );
        })}
        {/* Search bar on the right */}
        <div className="ml-auto relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setOpenIndex(null);
            }}
            placeholder="Search..."
            className="pl-9 pr-4 py-2 w-80 rounded-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(105,98,196,0.3)] focus:border-[#6962c4] transition-all shadow-sm"
          />
        </div>
      </div>

      {/* Section Label */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold" style={{ color: "#1a1540" }}>
          {activeCategory === "All" ? "All Questions" : activeCategory}
        </h2>
        <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full" style={{ background: "rgba(105,98,196,0.12)", color: "#6962c4" }}>
          {filteredFaqs.length}
        </span>
      </div>

      {/* FAQ List */}
      {filteredFaqs.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-gray-600 font-medium">
            No results for &quot;{searchQuery}&quot;
          </p>
          <p className="text-gray-400 text-sm mt-2">
            Try a different search term or{" "}
            <a href="mailto:info@inertialeads.com" className="text-blue-600 hover:underline font-medium">
              contact support
            </a>
          </p>
        </div>
      ) : (
        <div className="flex gap-3 items-start">
          {/* Left Column */}
          <div className="flex-1 space-y-3">
            {filteredFaqs.filter((_, i) => i % 2 === 0).map((faq, i) => {
              const realIndex = i * 2;
              const isOpen = openIndex === realIndex;
              return (
                <div
                  key={realIndex}
                  className={`rounded-xl border-2 transition-all duration-200 bg-white ${
                    isOpen
                      ? "shadow-md"
                      : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                  }`}
                  style={isOpen ? { borderColor: "#6962c4" } : undefined}
                >
                  <button
                    onClick={() => toggle(realIndex)}
                    className="w-full flex items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3.5 pr-4">
                      <span
                        className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                        style={isOpen ? { background: "rgba(105,98,196,0.15)", color: "#6962c4" } : { background: "rgba(105,98,196,0.08)", color: "#6962c4" }}
                      >
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          {categoryIcons[faq.category]}
                        </svg>
                      </span>
                      <span className="text-sm font-semibold text-gray-900">
                        {faq.question}
                      </span>
                    </div>
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all"
                      style={isOpen ? { background: "rgba(105,98,196,0.15)" } : { background: "#f3f4f6" }}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                        style={isOpen ? { color: "#6962c4" } : { color: "#9ca3af" }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  <div
                    className="grid transition-all duration-300 ease-in-out"
                    style={{ gridTemplateRows: isOpen ? "1fr" : "0fr", opacity: isOpen ? 1 : 0 }}
                  >
                    <div className="overflow-hidden">
                      <div className="px-5 pb-5 pl-[4.25rem]">
                        <p className="text-sm text-gray-600 leading-relaxed">
                          {faq.answer}
                        </p>
                        <span className="inline-block mt-3 px-2.5 py-0.5 text-xs font-semibold rounded-full" style={{ background: "rgba(105,98,196,0.12)", color: "#6962c4" }}>
                          {faq.category}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Right Column */}
          <div className="flex-1 space-y-3">
            {filteredFaqs.filter((_, i) => i % 2 === 1).map((faq, i) => {
              const realIndex = i * 2 + 1;
              const isOpen = openIndex === realIndex;
              return (
                <div
                  key={realIndex}
                  className={`rounded-xl border-2 transition-all duration-200 bg-white ${
                    isOpen
                      ? "shadow-md"
                      : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                  }`}
                  style={isOpen ? { borderColor: "#6962c4" } : undefined}
                >
                  <button
                    onClick={() => toggle(realIndex)}
                    className="w-full flex items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3.5 pr-4">
                      <span
                        className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                        style={isOpen ? { background: "rgba(105,98,196,0.15)", color: "#6962c4" } : { background: "rgba(105,98,196,0.08)", color: "#6962c4" }}
                      >
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          {categoryIcons[faq.category]}
                        </svg>
                      </span>
                      <span className="text-sm font-semibold text-gray-900">
                        {faq.question}
                      </span>
                    </div>
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all"
                      style={isOpen ? { background: "rgba(105,98,196,0.15)" } : { background: "#f3f4f6" }}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                        style={isOpen ? { color: "#6962c4" } : { color: "#9ca3af" }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  <div
                    className="grid transition-all duration-300 ease-in-out"
                    style={{ gridTemplateRows: isOpen ? "1fr" : "0fr", opacity: isOpen ? 1 : 0 }}
                  >
                    <div className="overflow-hidden">
                      <div className="px-5 pb-5 pl-[4.25rem]">
                        <p className="text-sm text-gray-600 leading-relaxed">
                          {faq.answer}
                        </p>
                        <span className="inline-block mt-3 px-2.5 py-0.5 text-xs font-semibold rounded-full" style={{ background: "rgba(105,98,196,0.12)", color: "#6962c4" }}>
                          {faq.category}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom CTA */}
      <div className="mt-10 rounded-2xl border-2 p-8 text-center" style={{ background: "linear-gradient(135deg, rgba(13,10,37,0.03) 0%, rgba(105,98,196,0.08) 100%)", borderColor: "rgba(105,98,196,0.2)" }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(105,98,196,0.12)" }}>
          <svg className="w-7 h-7" style={{ color: "#6962c4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold" style={{ color: "#1a1540" }}>Still have questions?</h3>
        <p className="text-sm text-gray-500 mt-1 mb-4">
          We&apos;re always happy to help you out.
        </p>
        <a
          href="mailto:info@inertialeads.com"
          className="inline-flex items-center gap-2 px-6 py-3 text-white text-sm font-semibold rounded-xl transition-all hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)", boxShadow: "0 4px 14px rgba(105,98,196,0.3)" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Email our support team
        </a>
      </div>
    </div>
  );
}
