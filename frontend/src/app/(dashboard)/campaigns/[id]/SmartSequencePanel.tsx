"use client";

import { useState, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiPut } from "@/lib/api";
import UpgradeLock from "../../UpgradeLock";

// =============================================
// Campaign → Smart Sequences
// =============================================
// A compact chip in the campaign header's settings bar (next to timezone / Follow-ups) shows
// the live ON/OFF state. Clicking it slides in a drawer from the right edge with the master
// switch, one card per behaviour trigger and the hot-lead threshold. The header itself never
// grows, so nothing shifts and nothing collides with the enrich/generate/send progress bars.
// Saved through the existing PUT /api/campaigns/:id (backend validates/clamps the config).

export interface SmartConfig {
  accelerate_on_opens: boolean;
  accelerate_opens_threshold: number;
  accelerate_opens_hours: number;
  accelerate_on_audit_click: boolean;
  accelerate_click_hours: number;
  hot_lead_flag: boolean;
  hot_lead_opens_threshold: number;
}

export const DEFAULT_SMART_CONFIG: SmartConfig = {
  accelerate_on_opens: true,
  accelerate_opens_threshold: 2,
  accelerate_opens_hours: 4,
  accelerate_on_audit_click: true,
  accelerate_click_hours: 2,
  hot_lead_flag: true,
  hot_lead_opens_threshold: 3,
};

const DRAWER_CSS = `
@keyframes ssDrawerIn{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes ssFadeIn{from{opacity:0}to{opacity:1}}
.ss-drawer{animation:ssDrawerIn .32s cubic-bezier(.22,1,.36,1)}
.ss-backdrop{animation:ssFadeIn .25s ease-out}
.ss-scroll::-webkit-scrollbar{width:5px}
.ss-scroll::-webkit-scrollbar-thumb{background:rgba(167,139,250,.35);border-radius:9999px}
.ss-scroll::-webkit-scrollbar-button{display:none;width:0;height:0}
@media (prefers-reduced-motion: reduce){.ss-drawer,.ss-backdrop{animation:none}}
`;

function Toggle({ on, onChange, disabled, size = "md", label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: "md" | "lg"; label: string }) {
  const lg = size === "lg";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      className={`relative shrink-0 rounded-full transition-all duration-300 ${lg ? "w-12 h-7" : "w-10 h-6"} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      style={{ background: on ? "linear-gradient(135deg, #7c3aed, #a78bfa)" : "rgba(255,255,255,0.14)", boxShadow: on ? "0 0 16px rgba(167,139,250,0.45)" : "none" }}
    >
      <span
        className={`absolute top-1 left-1 rounded-full bg-white shadow transition-transform duration-300 ${lg ? "w-5 h-5" : "w-4 h-4"}`}
        style={{ transform: on ? `translateX(${lg ? 20 : 16}px)` : "translateX(0)" }}
      />
    </button>
  );
}

function TriggerCard({ icon, tint, title, hint, on, onChange, disabled, children }: {
  icon: ReactNode; tint: string; title: string; hint: string; on: boolean; onChange: (v: boolean) => void; disabled: boolean; children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl p-4 transition-all duration-300 ${disabled ? "opacity-45" : ""}`}
      style={{ background: on && !disabled ? "rgba(167,139,250,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${on && !disabled ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.07)"}` }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: tint }}>
          <svg className="w-[18px] h-[18px] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">{icon}</svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white leading-snug">{title}</p>
          <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>{hint}</p>
          {children}
        </div>
        <Toggle on={on} onChange={onChange} disabled={disabled} label={title} />
      </div>
    </div>
  );
}

export default function SmartSequencePanel({
  campaignId,
  enabled,
  config,
  locked = false,
  onSaved,
  onToast,
}: {
  campaignId: string;
  enabled: boolean;
  config: Partial<SmartConfig> | null | undefined;
  locked?: boolean;
  onSaved: (enabled: boolean, config: SmartConfig) => void;
  onToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const saved = { ...DEFAULT_SMART_CONFIG, ...(config || {}) };
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(enabled);
  const [cfg, setCfg] = useState<SmartConfig>(saved);
  const [saving, setSaving] = useState(false);

  const openDrawer = () => {
    // Always start from the saved state so a previously cancelled edit never lingers.
    setOn(enabled);
    setCfg({ ...DEFAULT_SMART_CONFIG, ...(config || {}) });
    setOpen(true);
  };

  // Freeze the page behind the drawer; Esc closes it.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = { html: html.style.overflow, body: body.style.overflow, pad: body.style.paddingRight };
    const scrollbar = window.innerWidth - html.clientWidth;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prev.html; body.style.overflow = prev.body; body.style.paddingRight = prev.pad;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dirty = on !== enabled || JSON.stringify(cfg) !== JSON.stringify(saved);
  const activeCount = [cfg.accelerate_on_opens, cfg.accelerate_on_audit_click, cfg.hot_lead_flag].filter(Boolean).length;

  const save = async () => {
    setSaving(true);
    try {
      const data = await apiPut<{ campaign: { smart_sequences_enabled: boolean; smart_sequence_config: SmartConfig } }>(`/campaigns/${campaignId}`, {
        smart_sequences_enabled: on,
        smart_sequence_config: cfg,
      });
      onSaved(data.campaign.smart_sequences_enabled, { ...DEFAULT_SMART_CONFIG, ...(data.campaign.smart_sequence_config || {}) });
      onToast(on ? "Smart sequences are on for this campaign" : "Smart sequence settings saved", "success");
      setOpen(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to save smart sequence settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const setThreshold = (n: number) => setCfg((c) => ({ ...c, hot_lead_opens_threshold: Math.min(20, Math.max(2, n)) }));

  // ---------------- chip in the header settings bar ----------------
  const chip = (
    <button
      type="button"
      onClick={openDrawer}
      className="inline-flex items-center gap-2 rounded-lg px-3 py-[6px] transition-all duration-200 hover:brightness-125 cursor-pointer"
      style={{
        background: enabled && !locked ? "linear-gradient(135deg, rgba(124,58,237,0.25), rgba(167,139,250,0.12))" : "rgba(255,255,255,0.06)",
        border: `1px solid ${enabled && !locked ? "rgba(167,139,250,0.45)" : "rgba(255,255,255,0.08)"}`,
        boxShadow: enabled && !locked ? "0 0 18px rgba(124,58,237,0.25)" : "none",
      }}
      title={locked ? "Smart Sequences — Growth & Agency plans" : "Smart Sequences settings"}
    >
      <svg className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
      <span className="text-[12px] font-semibold text-white">Smart Sequences</span>
      {locked ? (
        <svg className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.6)" }} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[9px] font-bold tracking-wider"
          style={enabled ? { background: "linear-gradient(135deg, #7c3aed, #a78bfa)", color: "#fff" } : { background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)" }}
        >
          {enabled && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
          {enabled ? "ON" : "OFF"}
        </span>
      )}
    </button>
  );

  // ---------------- drawer ----------------
  const drawer = open && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <style>{DRAWER_CSS}</style>
      <div className="ss-backdrop absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Smart Sequences"
        className="ss-drawer relative h-full w-full max-w-[480px] flex flex-col shadow-2xl"
        style={{ background: "linear-gradient(180deg, #120e30 0%, #1a1540 45%, #0d0a25 100%)", borderLeft: "1px solid rgba(167,139,250,0.2)" }}
      >
        {/* Header */}
        <div className="relative shrink-0 px-6 pt-6 pb-5 overflow-hidden" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full blur-3xl pointer-events-none" style={{ background: "radial-gradient(circle, rgba(124,58,237,0.35), transparent 70%)" }} />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7c3aed, #a78bfa)", boxShadow: "0 8px 24px rgba(124,58,237,0.45)" }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white leading-tight">Smart Sequences</h2>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>Follow-ups that react to how each lead engages</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors" style={{ color: "rgba(255,255,255,0.6)" }} aria-label="Close">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {locked ? (
          <div className="flex-1 p-6">
            <UpgradeLock title="Smart Sequences" description="Follow-ups that react to opens, audit-report clicks and replies instead of fixed delays." />
          </div>
        ) : (
          <>
            <div className="ss-scroll flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-5">
              {/* Master switch */}
              <div
                className="rounded-2xl p-5 transition-all duration-300"
                style={on
                  ? { background: "linear-gradient(135deg, rgba(124,58,237,0.28), rgba(99,102,241,0.14))", border: "1px solid rgba(167,139,250,0.5)", boxShadow: "0 10px 30px -10px rgba(124,58,237,0.5)" }
                  : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-white">Enable for this campaign</p>
                    <p className="text-[11px] mt-1" style={{ color: on ? "#ddd6fe" : "rgba(255,255,255,0.5)" }}>
                      {on ? `${activeCount} of 4 triggers active` : "Off — follow-ups use fixed delays only"}
                    </p>
                  </div>
                  <Toggle on={on} onChange={setOn} size="lg" label="Enable smart sequences" />
                </div>
              </div>

              {/* Triggers */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-3" style={{ color: "rgba(255,255,255,0.45)" }}>Triggers</p>
                <div className="space-y-3">
                  <TriggerCard
                    disabled={!on}
                    on={cfg.accelerate_on_audit_click}
                    onChange={(v) => setCfg({ ...cfg, accelerate_on_audit_click: v })}
                    tint="linear-gradient(135deg, #059669, #34d399)"
                    title="Audit report clicked → follow up next morning"
                    hint="Strongest buying signal. The next follow-up goes out the next morning at the start of business hours instead of waiting its usual days. Another click moves the one after it to the following morning."
                    icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />}
                  />
                  <TriggerCard
                    disabled={!on}
                    on={cfg.accelerate_on_opens}
                    onChange={(v) => setCfg({ ...cfg, accelerate_on_opens: v })}
                    tint="linear-gradient(135deg, #ea580c, #fb923c)"
                    title={`Opened ${cfg.accelerate_opens_threshold} or more times → follow up next morning`}
                    hint="Curious but quiet. Only real re-opens count (at least 15 minutes apart). The next follow-up goes out the next morning at the start of business hours instead of waiting its usual days."
                    icon={<><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>}
                  />
                  <TriggerCard
                    disabled={!on}
                    on={cfg.hot_lead_flag}
                    onChange={(v) => setCfg({ ...cfg, hot_lead_flag: v })}
                    tint="linear-gradient(135deg, #dc2626, #f97316)"
                    title="Flag hot leads 🔥"
                    hint="Display only — no email is sent. Leads who open or click this many times get a 🔥 badge so you can call them first."
                    icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />}
                  >
                    <div className="flex items-center gap-2 mt-2.5">
                      <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.55)" }}>Threshold</span>
                      <div className="inline-flex items-center rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
                        <button type="button" disabled={!on || !cfg.hot_lead_flag} onClick={() => setThreshold(cfg.hot_lead_opens_threshold - 1)} className="w-7 h-7 text-white/80 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent">−</button>
                        <span className="w-8 text-center text-sm font-bold text-white">{cfg.hot_lead_opens_threshold}</span>
                        <button type="button" disabled={!on || !cfg.hot_lead_flag} onClick={() => setThreshold(cfg.hot_lead_opens_threshold + 1)} className="w-7 h-7 text-white/80 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent">+</button>
                      </div>
                      <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.55)" }}>opens or clicks</span>
                    </div>
                  </TriggerCard>
                </div>
              </div>

              {/* Always on */}
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.12)" }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2.5" style={{ color: "rgba(255,255,255,0.45)" }}>Always on with the Inbox connected</p>
                <ul className="space-y-1.5">
                  {[
                    ["🏖️", "Out-of-office replies pause follow-ups until the lead is back"],
                    ["🛑", "Unsubscribe replies stop all emails to that address"],
                    ["👋", "Not-interested replies cancel the remaining follow-ups"],
                  ].map(([emoji, text]) => (
                    <li key={text} className="flex items-start gap-2 text-[12px]" style={{ color: "rgba(255,255,255,0.7)" }}>
                      <span className="shrink-0">{emoji}</span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 px-6 py-4 flex items-center justify-between gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(13,10,37,0.6)" }}>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>Applies to pending and future emails</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setOpen(false)} className="px-4 py-2 text-xs font-semibold rounded-lg transition-colors hover:bg-white/10" style={{ color: "rgba(255,255,255,0.7)" }}>
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving || !dirty}
                  className="px-5 py-2 text-xs font-bold rounded-lg text-white transition-all disabled:opacity-35 disabled:cursor-not-allowed hover:brightness-110"
                  style={{ background: "linear-gradient(135deg, #7c3aed, #a78bfa)", boxShadow: dirty ? "0 6px 20px rgba(124,58,237,0.45)" : "none" }}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>,
    document.body
  ) : null;

  return (
    <>
      {chip}
      {drawer}
    </>
  );
}
