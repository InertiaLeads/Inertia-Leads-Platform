"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { apiPost } from "@/lib/api";
import { LIST_PRICES } from "@/lib/pricing";

interface PricingModalProps {
  plan: string;
  hasPlan: boolean;
  isExpired: boolean;
  isOnTrial?: boolean;
  onClose: () => void;
  onToast: (message: string, type: "success" | "error" | "info") => void;
}

// Pricing modal styles that Tailwind utilities can't express: a slim purple scrollbar without
// arrow buttons, and the animated gradient border on the featured (Growth) card.
const PRICING_CSS = `
.pricing-scroll::-webkit-scrollbar{width:5px}
.pricing-scroll::-webkit-scrollbar-track{background:transparent}
.pricing-scroll::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#c4b5fd,#7c3aed);border-radius:9999px}
.pricing-scroll::-webkit-scrollbar-button{display:none;width:0;height:0}
@supports not selector(::-webkit-scrollbar){.pricing-scroll{scrollbar-width:thin;scrollbar-color:#a78bfa transparent}}
.pricing-featured{border:2px solid transparent;background:linear-gradient(180deg,#fff8ec 0%,#ffffff 38%) padding-box,linear-gradient(120deg,#f59e0b,#ec4899,#8b5cf6,#6366f1,#f59e0b) border-box;background-size:100% 100%,300% 300%;animation:pricingBorderShift 6s linear infinite}
@keyframes pricingBorderShift{0%{background-position:0 0,0% 50%}100%{background-position:0 0,150% 50%}}
@media (prefers-reduced-motion: reduce){.pricing-featured{animation:none}}
`;

// Feature list that keeps the card at its original height: the list scrolls inside the card,
// and while there is more below, an animated pill bounces at the bottom ("3 new features")
// so the eye catches it. Clicking the pill scrolls down; it disappears once the end is reached.
function ScrollableFeatures({ children, moreLabel }: { children: ReactNode; moreLabel: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [showMore, setShowMore] = useState(false);
  // Set by the effect below: glides the list to the end using the same engine as the wheel.
  const scrollToEndRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setShowMore(el.scrollHeight > el.clientHeight + 2 && el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    const raf = requestAnimationFrame(check);

    // Eased wheel scrolling. The hidden part of the list is short (~100px), so a native wheel
    // notch jumps straight to the end; this glides there instead. The wheel event is always
    // consumed here, so it never leaks to the page behind the modal.
    let target = el.scrollTop;
    let anim = 0;
    const step = () => {
      const diff = target - el.scrollTop;
      if (Math.abs(diff) < 0.5) { el.scrollTop = target; anim = 0; return; }
      el.scrollTop += diff * 0.28;
      anim = requestAnimationFrame(step);
    };
    const onWheel = (e: WheelEvent) => {
      if (el.scrollHeight <= el.clientHeight) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      if (!anim) target = el.scrollTop; // resync if the user dragged the scrollbar meanwhile
      target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, target + delta));
      if (!anim) anim = requestAnimationFrame(step);
    };
    scrollToEndRef.current = () => {
      target = el.scrollHeight - el.clientHeight;
      if (!anim) anim = requestAnimationFrame(step);
    };

    el.addEventListener("scroll", check, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(raf);
      if (anim) cancelAnimationFrame(anim);
      el.removeEventListener("scroll", check);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", check);
    };
  }, []);

  // 12 visible rows (304px) + a 26px hint row = the same 330px the 13-row list used to take,
  // so the card keeps its original height. -mr-5 puts the scrollbar on the card's right border.
  return (
    <div className="relative mb-5 flex-grow -mr-5">
      <ul ref={ref} className="pricing-scroll space-y-2 max-h-[304px] overflow-y-auto overscroll-contain pr-4">
        {children}
      </ul>
      <div
        aria-hidden="true"
        className={`absolute left-0 right-5 bottom-[26px] h-5 pointer-events-none transition-opacity duration-300 ${showMore ? "opacity-100" : "opacity-0"}`}
        style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0), #ffffff)" }}
      />
      <div className="h-[26px] pr-5 flex items-end justify-center">
        <button
          type="button"
          onClick={() => scrollToEndRef.current()}
          className={`cursor-pointer transition-opacity duration-300 ${showMore ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          tabIndex={showMore ? 0 : -1}
          aria-label={moreLabel}
        >
          <span
            className="animate-bounce inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a78bfa)", boxShadow: "0 4px 14px rgba(124,58,237,0.45)" }}
          >
            ✨ {moreLabel}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
          </span>
        </button>
      </div>
    </div>
  );
}

export default function PricingModal({ plan, hasPlan, isExpired, isOnTrial, onClose, onToast }: PricingModalProps) {
  // During the free trial the user has NO paid subscription yet (their `plan` is just the trial's
  // Growth tier). So every plan must be purchasable — treat trial like "no plan": show "Get Started"
  // on all cards, no "Current Plan", no upgrade/downgrade confirmation (buying = a fresh checkout).
  const noPaidPlan = isExpired || !hasPlan || !!isOnTrial;

  // Freeze the page behind the modal so wheel/trackpad scrolling over the modal never moves it.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { html: html.style.overflow, body: body.style.overflow, pad: body.style.paddingRight };
    const scrollbar = window.innerWidth - html.clientWidth;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => { html.style.overflow = prev.html; body.style.overflow = prev.body; body.style.paddingRight = prev.pad; };
  }, []);
  const [loading, setLoading] = useState<string | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<string | null>(null);
  // When set, Dodo's full (2-column) hosted checkout is embedded in this modal via iframe.
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const PLAN_PRICES: Record<string, number> = { ...LIST_PRICES };

  // Detect the post-payment redirect. Dodo navigates the iframe to our return_url
  // (/billing/return) — that's same-origin, so we can read the URL once it lands.
  // While it's still on Dodo's domain the read throws (cross-origin) and is ignored.
  //
  // /billing/return normally breaks out to the top window itself; this is only a fallback
  // for the case where its script hasn't run. Matching on the PATH (not a full query
  // string) matters: the previous version looked for "/settings?payment=success" and
  // silently missed anything else, which is how a failed payment could leave the modal
  // sitting open over an embedded page.
  function handleIframeLoad(e: React.SyntheticEvent<HTMLIFrameElement>) {
    setIframeLoaded(true);
    try {
      const iframeUrl = e.currentTarget.contentWindow?.location.href;
      if (!iframeUrl) return;
      const { pathname, search } = new URL(iframeUrl);
      if (pathname.startsWith("/billing/return")) {
        // The return page's own script would have added payment=return; since it evidently
        // didn't run, set it here so /settings knows to verify the outcome.
        const forwarded = new URLSearchParams(search);
        forwarded.set("payment", "return");
        window.location.href = `/settings?${forwarded.toString()}`;
      } else if (pathname === "/settings") {
        // Legacy return_url shape, still honoured.
        window.location.href = `/settings${search}`;
      }
    } catch {
      // Cross-origin (still on Dodo's checkout) — nothing to do.
    }
  }

  function closeCheckout() {
    setCheckoutUrl(null);
    setIframeLoaded(false);
  }

  function handlePlanClick(selectedPlan: string) {
    // Only a paying subscriber switching plans sees the proration confirmation.
    // Trial/expired/new users go straight to a fresh checkout for any plan.
    if (!noPaidPlan && plan !== selectedPlan) {
      setConfirmPlan(selectedPlan);
    } else {
      handleSubscribe(selectedPlan);
    }
  }

  async function handleSubscribe(selectedPlan: string) {
    setLoading(selectedPlan);
    try {
      const res = await apiPost<{ checkoutUrl?: string; success?: boolean; message?: string }>("/billing/checkout", { plan: selectedPlan });
      if (res.success) {
        // Plan was swapped instantly (existing subscriber upgrade/downgrade)
        onToast(res.message || "Plan changed successfully!", "success");
        onClose();
        window.location.reload();
      } else if (res.checkoutUrl) {
        // Embed Dodo's inline checkout inside this modal. Setting the URL renders the
        // container, and the effect above mounts the checkout into it.
        setCheckoutUrl(res.checkoutUrl);
      } else {
        onToast("Failed to create checkout session", "error");
      }
    } catch (err) {
      onToast((err as { message?: string } | null)?.message || "Failed to start checkout", "error");
    } finally {
      setLoading(null);
    }
  }

  // Checkout view: Dodo's full 2-column hosted checkout embedded inside this modal.
  if (checkoutUrl) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeCheckout}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="relative bg-white rounded-3xl shadow-2xl max-w-[1280px] w-full h-[calc(100vh-2.8rem)] overflow-hidden px-8" onClick={(e) => e.stopPropagation()}>
          <button onClick={closeCheckout} className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          {!iframeLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-[5]">
              <div className="flex items-end gap-[7px] h-20">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="w-[7px] rounded-full bg-gradient-to-t from-[#6962c4] to-[#a9a4e8]" style={{ animation: "barWave 1s ease-in-out infinite", animationDelay: `${i * 0.1}s`, height: "16px" }} />
                ))}
              </div>
              <p className="mt-7 text-lg font-semibold text-gray-700">Loading Checkout...</p>
              <p className="mt-2 text-sm text-gray-400">Securely connecting to payment provider</p>
              <style jsx>{`
                @keyframes barWave {
                  0%, 100% { height: 16px; opacity: 0.4; }
                  50% { height: 72px; opacity: 1; }
                }
              `}</style>
            </div>
          )}

          <iframe
            src={checkoutUrl}
            className={`w-full h-full border-0 rounded-3xl transition-opacity duration-300 ${iframeLoaded ? "opacity-100" : "opacity-0"}`}
            title="Checkout"
            onLoad={handleIframeLoad}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-gradient-to-b from-gray-50 to-white rounded-3xl shadow-2xl max-w-[1100px] w-full py-8 px-10" onClick={(e) => e.stopPropagation()}>
        <style>{PRICING_CSS}</style>
        <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none" aria-hidden="true">
          <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-[560px] h-[280px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(139,92,246,0.18), transparent 70%)" }} />
          <div className="absolute -bottom-28 -right-20 w-80 h-80 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(245,158,11,0.12), transparent 70%)" }} />
          <div className="absolute -bottom-28 -left-20 w-80 h-80 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(99,102,241,0.10), transparent 70%)" }} />
        </div>
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <div className="relative text-center mb-7">
          <h2 className="text-2xl font-extrabold bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(90deg, #1a1540 0%, #6962c4 50%, #1a1540 100%)" }}>Choose Your Plan</h2>
          <p className="text-sm text-gray-500 mt-1.5">Scale your outreach with the right plan</p>
        </div>
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
          {/* Starter */}
          <div className={`relative rounded-2xl p-5 pt-6 transition-all duration-300 flex flex-col ${plan === "starter" ? "bg-white shadow-lg ring-2 ring-violet-400" : "bg-white shadow-sm border border-gray-200"}`}>
            <div className="-mx-5 -mt-6 px-5 pt-6 pb-4 mb-4" style={{ background: "linear-gradient(180deg, #eef2ff 0%, #f6f7ff 100%)", borderBottom: "1px solid rgba(99,102,241,0.16)", borderTopLeftRadius: "15px", borderTopRightRadius: "15px" }}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)", boxShadow: "0 4px 12px rgba(99,102,241,0.25)" }}>
                  <svg className="w-4 h-4" style={{ color: "#4f46e5" }} fill="currentColor" viewBox="0 0 20 20"><path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z"/></svg>
                </div>
                <h3 className="text-base font-bold text-gray-900">Starter</h3>
              </div>
  
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold tracking-tight" style={{ color: "#312e81" }}><span className="text-lg align-top mr-0.5">$</span>{LIST_PRICES.starter}</span>
                <span className="text-sm text-gray-400 font-medium">/month</span>
              </div>
            </div>
            <div className="relative mb-5 flex-grow">
            <ul className="space-y-2">
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">50</strong> cold emails/day (after warmup)</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">1,100</strong> leads per month</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">50</strong> leads per enrichment batch</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">1</strong> connected Gmail inbox</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>AI email personalization</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Automated Gmail warmup (3-week)</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Lead scoring & data enrichment</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Auto find leads</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Daily limits reset at midnight</span></li>
            </ul>
            <div className="mt-3 md:mt-0 md:absolute md:bottom-0 md:inset-x-0 rounded-xl px-3 py-2" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.05) 0%, rgba(245,158,11,0.06) 100%)", border: "1px dashed rgba(124,58,237,0.3)" }}>
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#7c3aed" }}>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                Unlock with Growth
              </p>
              <div className="flex flex-wrap gap-[5px]">
                {["Hot leads", "CSV upload", "Audit reports", "Email tracking", "AI inbox", "Smart sequences"].map((f) => (
                  <span key={f} className="inline-flex items-center px-1.5 py-px rounded-md text-[10px] leading-[14px] font-medium text-gray-500 bg-white" style={{ border: "1px solid rgba(124,58,237,0.15)" }}>
                    {f}
                  </span>
                ))}
              </div>
            </div>
            </div>
            {noPaidPlan ? (
              <button
                onClick={() => handlePlanClick("starter")}
                disabled={loading === "starter"}
                className="w-full py-2.5 text-xs font-bold rounded-xl text-white transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] mt-auto disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}
              >
                {loading === "starter" ? "Redirecting..." : "Get Started"}
              </button>
            ) : plan === "starter" ? (
              <button
                disabled
                className="w-full py-2.5 text-xs font-bold rounded-xl cursor-not-allowed transition-all mt-auto flex items-center justify-center gap-1.5"
                style={{ color: "#6962c4", boxShadow: "inset 0 0 0 2px #6962c4", background: "rgba(105,98,196,0.05)" }}
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                Current Plan
              </button>
            ) : (
              <button
                onClick={() => handlePlanClick("starter")}
                disabled={loading === "starter"}
                className="w-full py-2.5 text-xs font-bold rounded-xl text-white transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] mt-auto disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}
              >
                {loading === "starter" ? "Switching..." : "Downgrade"}
              </button>
            )}
          </div>

          {/* Growth - Featured */}
          <div className={`pricing-featured relative z-10 rounded-2xl p-5 pt-6 pb-[19px] transition-all duration-300 flex flex-col ${plan === "growth" ? "ring-2 ring-violet-400 ring-offset-2" : ""}`} style={{ boxShadow: "0 24px 60px -18px rgba(124,58,237,0.45), 0 10px 28px -14px rgba(245,158,11,0.4)" }}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full text-white shadow-md bg-gradient-to-r from-amber-500 to-orange-500">🔥 Most Popular</div>
            <div className="-mx-5 -mt-6 px-5 pt-6 pb-4 mb-4" style={{ background: "linear-gradient(180deg, #fff1d6 0%, #fff8ec 100%)", borderBottom: "1px solid rgba(245,158,11,0.28)", borderTopLeftRadius: "14px", borderTopRightRadius: "14px" }}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f97316 100%)", boxShadow: "0 4px 12px rgba(249,115,22,0.4)" }}>
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd"/></svg>
                </div>
                <h3 className="text-base font-bold text-gray-900">Growth</h3>
              </div>
  
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(135deg, #1a1540 0%, #6d28d9 100%)" }}><span className="text-lg align-top mr-0.5">$</span>{LIST_PRICES.growth}</span>
                <span className="text-sm text-gray-400 font-medium">/month</span>
              </div>
            </div>
            <ScrollableFeatures moreLabel="3 new features">
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">100</strong> cold emails/day (after warmup)</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">2,200</strong> leads per month</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">100</strong> leads per enrichment batch</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">2</strong> connected Gmail inboxes</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>AI email personalization</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Automated Gmail warmup (3-week)</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Lead scoring & data enrichment</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Auto find leads</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Hot lead tracking</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>CSV lead upload</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Daily limits reset at midnight</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>AI audit reports (SEO, marketing & web)</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Email open & click tracking<span className="ml-1.5 px-1.5 py-px rounded text-[9px] font-bold align-middle" style={{ color: "#7c3aed", background: "rgba(124,58,237,0.1)" }}>NEW</span></span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Unified inbox with AI reply sorting<span className="ml-1.5 px-1.5 py-px rounded text-[9px] font-bold align-middle" style={{ color: "#7c3aed", background: "rgba(124,58,237,0.1)" }}>NEW</span></span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Smart follow-up sequences<span className="ml-1.5 px-1.5 py-px rounded text-[9px] font-bold align-middle" style={{ color: "#7c3aed", background: "rgba(124,58,237,0.1)" }}>NEW</span></span></li>
              <li className="flex items-start gap-2 text-xs text-gray-400"><div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-gray-300" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg></div><span>CRM integration <em>(coming soon)</em></span></li>
            </ScrollableFeatures>
            {noPaidPlan ? (
              <button
                onClick={() => handlePlanClick("growth")}
                disabled={loading === "growth"}
                className="w-full py-2.5 text-xs font-bold rounded-xl text-white transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] mt-auto disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #8b5cf6 100%)", boxShadow: "0 10px 24px -8px rgba(124,58,237,0.6)" }}
              >
                {loading === "growth" ? "Redirecting..." : "Get Started"}
              </button>
            ) : plan === "growth" ? (
              <button
                disabled
                className="w-full py-2.5 text-xs font-bold rounded-xl cursor-not-allowed transition-all mt-auto flex items-center justify-center gap-1.5"
                style={{ color: "#6962c4", boxShadow: "inset 0 0 0 2px #6962c4", background: "rgba(105,98,196,0.05)" }}
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                Current Plan
              </button>
            ) : plan === "agency" ? (
              <button
                onClick={() => handlePlanClick("growth")}
                disabled={loading === "growth"}
                className="w-full py-2.5 text-xs font-bold rounded-xl text-white transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] mt-auto disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}
              >
                {loading === "growth" ? "Switching..." : "Downgrade"}
              </button>
            ) : (
              <button
                onClick={() => handlePlanClick("growth")}
                disabled={loading === "growth"}
                className="w-full py-2.5 text-xs font-bold rounded-xl text-white transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] mt-auto disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #8b5cf6 100%)", boxShadow: "0 10px 24px -8px rgba(124,58,237,0.6)" }}
              >
                {loading === "growth" ? "Switching..." : "Upgrade"}
              </button>
            )}
          </div>

          {/* Agency */}
          <div className={`relative rounded-2xl p-5 pt-6 transition-all duration-300 flex flex-col ${plan === "agency" ? "bg-white shadow-lg ring-2 ring-violet-400" : "bg-white shadow-sm border border-gray-200"}`}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full text-white shadow-md bg-gradient-to-r from-purple-600 to-indigo-600">⚡ Priority Support</div>
            <div className="-mx-5 -mt-6 px-5 pt-6 pb-4 mb-4" style={{ background: "linear-gradient(180deg, #f2ecff 0%, #f8f5ff 100%)", borderBottom: "1px solid rgba(124,58,237,0.16)", borderTopLeftRadius: "15px", borderTopRightRadius: "15px" }}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3d3580 0%, #7c3aed 100%)", boxShadow: "0 4px 12px rgba(91,33,182,0.4)" }}>
                  <svg className="w-4 h-4" style={{ color: "#ffffff" }} fill="currentColor" viewBox="0 0 20 20"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/></svg>
                </div>
                <h3 className="text-base font-bold text-gray-900">Agency</h3>
              </div>
  
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(135deg, #1a1540 0%, #6d28d9 100%)" }}><span className="text-lg align-top mr-0.5">$</span>{LIST_PRICES.agency}</span>
                <span className="text-sm text-gray-400 font-medium">/month</span>
              </div>
            </div>
            <ScrollableFeatures moreLabel="3 new features">
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">200</strong> cold emails/day (after warmup)</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">4,400</strong> leads per month</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">200</strong> leads per enrichment batch</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span><strong className="font-bold text-gray-900">4</strong> connected Gmail inboxes</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>AI email personalization</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Automated Gmail warmup (3-week)</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Lead scoring & data enrichment</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Auto find leads</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Hot lead tracking</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>CSV lead upload</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Daily limits reset at midnight</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>AI audit reports (SEO, marketing & web)</span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Email open & click tracking<span className="ml-1.5 px-1.5 py-px rounded text-[9px] font-bold align-middle" style={{ color: "#7c3aed", background: "rgba(124,58,237,0.1)" }}>NEW</span></span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Unified inbox with AI reply sorting<span className="ml-1.5 px-1.5 py-px rounded text-[9px] font-bold align-middle" style={{ color: "#7c3aed", background: "rgba(124,58,237,0.1)" }}>NEW</span></span></li>
              <li className="flex items-start gap-2 text-xs text-gray-600"><div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg></div><span>Smart follow-up sequences<span className="ml-1.5 px-1.5 py-px rounded text-[9px] font-bold align-middle" style={{ color: "#7c3aed", background: "rgba(124,58,237,0.1)" }}>NEW</span></span></li>
              <li className="flex items-start gap-2 text-xs text-gray-400"><div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5"><svg className="w-2.5 h-2.5 text-gray-300" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg></div><span>CRM integration <em>(coming soon)</em></span></li>
            </ScrollableFeatures>
            {noPaidPlan ? (
              <button
                onClick={() => handlePlanClick("agency")}
                disabled={loading === "agency"}
                className="w-full py-2.5 text-xs font-bold rounded-xl text-white transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] mt-auto disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}
              >
                {loading === "agency" ? "Redirecting..." : "Get Started"}
              </button>
            ) : plan === "agency" ? (
              <button
                disabled
                className="w-full py-2.5 text-xs font-bold rounded-xl cursor-not-allowed transition-all mt-auto flex items-center justify-center gap-1.5"
                style={{ color: "#6962c4", boxShadow: "inset 0 0 0 2px #6962c4", background: "rgba(105,98,196,0.05)" }}
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                Current Plan
              </button>
            ) : (
              <button
                onClick={() => handlePlanClick("agency")}
                disabled={loading === "agency"}
                className="w-full py-2.5 text-xs font-bold rounded-xl text-white transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] mt-auto disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}
              >
                {loading === "agency" ? "Switching..." : "Upgrade"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Plan Change Confirmation Popup */}
      {confirmPlan && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setConfirmPlan(null)} />
          <div className="relative bg-[#1e1b3a] rounded-2xl shadow-2xl max-w-md w-full p-8 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: "rgba(105,98,196,0.2)" }}>
              <svg className="w-7 h-7" style={{ color: "#a9a4e8" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-3">
              {PLAN_PRICES[confirmPlan] > PLAN_PRICES[plan] ? "Upgrade" : "Downgrade"} to {confirmPlan.charAt(0).toUpperCase() + confirmPlan.slice(1)}?
            </h3>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-4" style={{ border: "1px solid rgba(255,255,255,0.15)" }}>
              <span className="text-xs text-gray-400">{plan.charAt(0).toUpperCase() + plan.slice(1)} (${PLAN_PRICES[plan]})</span>
              <span className="text-xs text-gray-500">→</span>
              <span className="text-xs text-gray-400">{confirmPlan.charAt(0).toUpperCase() + confirmPlan.slice(1)} (${PLAN_PRICES[confirmPlan]})</span>
            </div>
            <p className="text-xs text-gray-400 mb-7">
              {PLAN_PRICES[confirmPlan] > PLAN_PRICES[plan]
                ? "A prorated amount will be charged to your card immediately."
                : "You'll receive credit for the remaining period on your current plan."}
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => setConfirmPlan(null)}
                className="flex-1 py-3 text-sm font-semibold rounded-xl text-gray-300 border border-gray-500 hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmPlan(null); handleSubscribe(confirmPlan); }}
                disabled={!!loading}
                className="flex-1 py-3 text-sm font-bold rounded-xl text-white transition-all hover:opacity-90 disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}
              >
                {loading ? "Switching..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
