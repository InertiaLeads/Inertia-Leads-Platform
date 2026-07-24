"use client";

import { useState } from "react";
import Link from "next/link";
import { apiPut } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

export type SetupRequiredType = "service" | "inbox" | "profile";

const SERVICE_OPTIONS = [
  { value: "web_dev", label: "Web Dev", iconPath: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" },
  { value: "digital_marketing", label: "Marketing", iconPath: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" },
  { value: "seo", label: "SEO", iconPath: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
] as const;

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed top-16 left-64 right-0 bottom-0 z-30 flex items-center justify-center p-4">
      {/* Dismissible backdrop */}
      <div className="absolute inset-0 backdrop-blur-sm bg-[#0d0a25]/60" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-md rounded-2xl p-8 text-center animate-[slideIn_0.3s_ease-out_forwards]"
        style={{
          background: "linear-gradient(135deg, #1a1540 0%, #0d0a25 100%)",
          border: "1px solid rgba(105,98,196,0.3)",
          boxShadow: "0 20px 60px rgba(13,10,37,0.5), 0 0 0 1px rgba(105,98,196,0.1)",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}

function IconBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: "rgba(105,98,196,0.15)" }}>
      {children}
    </div>
  );
}

// ---- Service: pick + save inline (no navigation, so no page flash) ----
function ServiceSetup({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [selected, setSelected] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    try {
      await apiPut("/stats/service-type", { serviceType: selected });
      const supabase = createClient();
      await supabase.auth.updateUser({ data: { service_type_set: true } });
      onSaved?.();
      onClose();
    } catch {
      setError("Couldn't save. Please try again.");
      setSaving(false);
    }
  };

  return (
    <>
      <IconBubble>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6962c4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      </IconBubble>

      <h2 className="text-xl font-bold text-white mb-2">Select your service first</h2>
      <p className="text-sm text-gray-400 mb-6 leading-relaxed">
        Your emails are personalized to what you offer. Pick your service so we can write in the right voice.
      </p>

      <div className="flex gap-3 justify-center mb-6">
        {SERVICE_OPTIONS.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setSelected(opt.value)}
              disabled={saving}
              className="relative flex flex-col items-center justify-center gap-2 w-[110px] py-4 rounded-xl text-center transition-all"
              style={{
                background: isSelected ? "rgba(196,181,253,0.12)" : "rgba(255,255,255,0.03)",
                border: isSelected ? "2px solid #c4b5fd" : "2px solid rgba(255,255,255,0.1)",
                boxShadow: isSelected ? "0 4px 20px rgba(196,181,253,0.2)" : "none",
              }}
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: isSelected ? "rgba(196,181,253,0.25)" : "rgba(255,255,255,0.1)" }}>
                <svg className="w-5 h-5" style={{ color: isSelected ? "#e9e0ff" : "rgba(255,255,255,0.75)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isSelected ? 2.5 : 1.8} d={opt.iconPath} />
                </svg>
              </div>
              <span className={`text-[11px] font-bold ${isSelected ? "text-white" : "text-white/70"}`}>{opt.label}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      <button
        onClick={save}
        disabled={!selected || saving}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
        style={{
          background: "linear-gradient(135deg, #6962c4 0%, #3d3580 100%)",
          boxShadow: "0 4px 15px rgba(105,98,196,0.4)",
        }}
      >
        {saving ? "Saving..." : "Continue"}
      </button>

      <button onClick={onClose} className="block w-full mt-4 text-xs text-gray-500 hover:text-gray-300 transition-colors">
        Not now
      </button>
    </>
  );
}

// ---- Inbox: needs the full Settings flow (Gmail OAuth / SMTP form), so navigate ----
function InboxSetup({ onClose }: { onClose: () => void }) {
  return (
    <>
      <IconBubble>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6962c4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      </IconBubble>

      <h2 className="text-xl font-bold text-white mb-2">Connect an inbox to send</h2>
      <p className="text-sm text-gray-400 mb-6 leading-relaxed">
        You need a connected email account before sending. Connect Gmail or SMTP in Settings, then start your campaign.
      </p>

      <Link
        href="/settings#inbox"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white transition-all hover:scale-105"
        style={{
          background: "linear-gradient(135deg, #6962c4 0%, #3d3580 100%)",
          boxShadow: "0 4px 15px rgba(105,98,196,0.4)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
        Connect Inbox
      </Link>

      <button onClick={onClose} className="block w-full mt-4 text-xs text-gray-500 hover:text-gray-300 transition-colors">
        Not now
      </button>
    </>
  );
}

// ---- Profile: name + business address are baked into every email (CAN-SPAM), so navigate ----
function ProfileSetup({ onClose }: { onClose: () => void }) {
  return (
    <>
      <IconBubble>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6962c4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </IconBubble>

      <h2 className="text-xl font-bold text-white mb-2">Complete your profile first</h2>
      <p className="text-sm text-gray-400 mb-6 leading-relaxed">
        Your name and business address are added to the bottom of every email — they&rsquo;re legally required (CAN-SPAM) for cold outreach. Add them in Settings before generating emails.
      </p>

      <Link
        href="/settings#profile"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white transition-all hover:scale-105"
        style={{
          background: "linear-gradient(135deg, #6962c4 0%, #3d3580 100%)",
          boxShadow: "0 4px 15px rgba(105,98,196,0.4)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        Complete Profile
      </Link>

      <button onClick={onClose} className="block w-full mt-4 text-xs text-gray-500 hover:text-gray-300 transition-colors">
        Not now
      </button>
    </>
  );
}

export default function SetupRequiredModal({
  type,
  onClose,
  onServiceSaved,
}: {
  type: SetupRequiredType;
  onClose: () => void;
  onServiceSaved?: () => void;
}) {
  return (
    <ModalShell onClose={onClose}>
      {type === "service"
        ? <ServiceSetup onClose={onClose} onSaved={onServiceSaved} />
        : type === "inbox"
        ? <InboxSetup onClose={onClose} />
        : <ProfileSetup onClose={onClose} />}
    </ModalShell>
  );
}
