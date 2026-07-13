"use client";

import Link from "next/link";
import { usePlan } from "./PlanContext";

export default function LockedFeatureModal() {
  const { subscriptionStatus, trialEndsAt, currentPeriodEnd, pastDueSince } = usePlan();

  // Determine which message to show
  const isTrialExpired = subscriptionStatus === "trialing" && trialEndsAt && new Date(trialEndsAt) < new Date();
  const isCancelledExpired = subscriptionStatus === "cancelled" && (!currentPeriodEnd || new Date(currentPeriodEnd) <= new Date());
  const isExpired = subscriptionStatus === "expired";
  const isPaused = subscriptionStatus === "paused";
  const isPastDueExpired = subscriptionStatus === "past_due" && pastDueSince && (Date.now() - new Date(pastDueSince).getTime()) >= 3 * 24 * 60 * 60 * 1000;

  let title = "Feature Locked";
  let description = (
    <>To access this feature, please <span className="text-[#a5a0e6] font-semibold">choose a plan</span> from your settings.</>
  );
  let ctaText = "Go to Settings";
  let footerText = "Cancel anytime";

  if (isTrialExpired) {
    title = "Free Trial Ended";
    description = (
      <>Your 7-day free trial has ended. To continue using all features, please <span className="text-[#a5a0e6] font-semibold">choose a plan</span>.</>
    );
    ctaText = "Choose a Plan";
    footerText = "Pick up right where you left off";
  } else if (isPastDueExpired) {
    title = "Payment Failed";
    description = (
      <>Your payment could not be processed. Please <span className="text-[#a5a0e6] font-semibold">update your payment method</span> to restore access to all features.</>
    );
    ctaText = "Update Payment";
    footerText = "Your data is safe — update payment to continue";
  } else if (isCancelledExpired || isExpired) {
    title = "Subscription Expired";
    description = (
      <>Your subscription has expired. To regain access to all features, please <span className="text-[#a5a0e6] font-semibold">reactivate your plan</span>.</>
    );
    ctaText = "Reactivate Plan";
    footerText = "Your data is safe and waiting for you";
  } else if (isPaused) {
    title = "Subscription Paused";
    description = (
      <>Your subscription is currently paused. Resume it to <span className="text-[#a5a0e6] font-semibold">unlock all features</span> again.</>
    );
    ctaText = "Resume Plan";
    footerText = "Your data is safe and waiting for you";
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Blurred backdrop */}
      <div className="absolute inset-0 backdrop-blur-sm bg-[#0d0a25]/60" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-md mx-4 rounded-2xl p-8 text-center animate-[slideIn_0.3s_ease-out_forwards]"
        style={{
          background: "linear-gradient(135deg, #1a1540 0%, #0d0a25 100%)",
          border: "1px solid rgba(105,98,196,0.3)",
          boxShadow: "0 20px 60px rgba(13,10,37,0.5), 0 0 0 1px rgba(105,98,196,0.1)",
        }}
      >
        {/* Lock icon */}
        <div
          className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5"
          style={{ background: "rgba(105,98,196,0.15)" }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6962c4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-white mb-2">
          {title}
        </h2>

        {/* Description */}
        <p className="text-sm text-gray-400 mb-6 leading-relaxed">
          {description}
        </p>

        {/* CTA Button */}
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white transition-all hover:scale-105"
          style={{
            background: "linear-gradient(135deg, #6962c4 0%, #3d3580 100%)",
            boxShadow: "0 4px 15px rgba(105,98,196,0.4)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {ctaText}
        </Link>

        {/* Secondary info */}
        <p className="text-xs text-gray-500 mt-4">
          {footerText}
        </p>
      </div>
    </div>
  );
}
