"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { usePlan } from "../PlanContext";
import { SettingsAccountSkeleton } from "../Skeleton";

// =============================================
// Settings → "Inbox Connection" (IMAP, app passwords)
// =============================================
// One card listing every sending account (Gmail + SMTP) with its inbox status, plus a
// connect form pre-filled from /api/imap/detect. Users only need to paste an App Password.

interface SendingAccount { id: string; email: string; type: "gmail" | "smtp" }
interface ImapAccount {
  id: string; email: string; imap_host: string; imap_port: number; is_active: boolean;
  last_fetched_at: string | null; last_error: string | null; created_at: string;
}
interface Detect { email: string; host: string; port: number; provider: string; note?: string; guessed: boolean; unsupported?: boolean }

const PROVIDER_HELP: Record<string, { title: string; steps: string[] }> = {
  gmail: {
    title: "Gmail / Google Workspace app password",
    steps: [
      "Open myaccount.google.com → Security.",
      "Turn on 2-Step Verification (app passwords require it).",
      "Search “App passwords”, create one named “Inertia Leads”.",
      "Paste the 16-character password below. IMAP is on by default in Gmail.",
    ],
  },
  outlook: {
    title: "Outlook / Microsoft 365",
    steps: [
      "Microsoft has switched off password-based inbox access, so app passwords no longer work here.",
      "Sending from this account is unaffected. Reply sync for Outlook will arrive with Microsoft sign-in support.",
    ],
  },
  yahoo: { title: "Yahoo app password", steps: ["Yahoo Account Security → Generate app password → “Other app”.", "Paste the password below."] },
  zoho: { title: "Zoho Mail app password", steps: ["Zoho Accounts → Security → App Passwords → Generate.", "Make sure IMAP access is enabled in Zoho Mail settings."] },
  icloud: { title: "iCloud app-specific password", steps: ["appleid.apple.com → Sign-In and Security → App-Specific Passwords.", "Paste it below."] },
  custom: { title: "App or mailbox password", steps: ["Use the IMAP password from your email provider (often an app password if two-factor is enabled).", "Check the host and port below if the connection fails."] },
};

export default function InboxConnectionCard({
  sendingAccounts,
  onToast,
}: {
  sendingAccounts: SendingAccount[];
  onToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const plan = usePlan();
  const enabled = plan.loaded && plan.canAccessFeatures && plan.features.unifiedInbox;

  const [imapAccounts, setImapAccounts] = useState<ImapAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [formEmail, setFormEmail] = useState<string | null>(null); // which account's form is open
  const [detect, setDetect] = useState<Detect | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    try {
      const d = await apiGet<{ accounts: ImapAccount[] }>("/imap/accounts");
      setImapAccounts(d.accounts);
    } catch { /* gate or network — leave empty */ }
    finally { setLoading(false); }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  const openForm = async (email: string) => {
    setFormEmail(email);
    setError(""); setSuccess(""); setPassword(""); setShowAdvanced(false);
    setUsername(email);
    setDetecting(true);
    try {
      const d = await apiGet<Detect>(`/imap/detect?email=${encodeURIComponent(email)}`);
      setDetect(d);
      setHost(d.host);
      setPort(String(d.port));
      if (d.guessed || d.note) setShowAdvanced(true);
    } catch {
      setDetect({ email, host: "", port: 993, provider: "custom", guessed: true });
      setHost(""); setPort("993"); setShowAdvanced(true);
    } finally {
      setDetecting(false);
    }
  };

  const payload = () => ({ email: formEmail!, host: host.trim(), port: parseInt(port, 10) || 993, username: username.trim() || formEmail!, password, useTls: true });

  const test = async () => {
    setTesting(true); setError(""); setSuccess("");
    try {
      await apiPost("/imap/test", payload());
      setSuccess("Connection works. Save to start syncing replies.");
    } catch (err) { setError(err instanceof Error ? err.message : "Connection failed"); }
    finally { setTesting(false); }
  };

  const save = async () => {
    setSaving(true); setError(""); setSuccess("");
    try {
      await apiPost("/imap/accounts", payload());
      onToast("Inbox connected — replies will appear within a few minutes", "success");
      setFormEmail(null); setPassword("");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to connect inbox"); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      await apiDelete(`/imap/accounts/${id}`);
      onToast("Inbox disconnected", "info");
      await load();
    } catch (err) { onToast(err instanceof Error ? err.message : "Failed to disconnect", "error"); }
    finally { setRemoving(null); }
  };

  const imapFor = (email: string) => imapAccounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
  const help = PROVIDER_HELP[detect?.provider || "custom"] || PROVIDER_HELP.custom;

  return (
    <div id="inbox-connection" className="bg-white rounded-2xl shadow-sm overflow-hidden scroll-mt-24" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
      <div className="px-6 py-4 border-b" style={{ background: "#2f276c", borderColor: "#2f276c" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
              <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-3.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 007.586 13H4" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Inbox Connection</h2>
              <p className="text-xs text-white/60">
                {enabled ? `${imapAccounts.filter(a => a.is_active).length} of ${sendingAccounts.length} inbox${sendingAccounts.length === 1 ? "" : "es"} syncing replies` : "Growth & Agency plans"}
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider" style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}>Unified Inbox</span>
        </div>
      </div>

      <div className="p-6">
        {!plan.loaded || loading ? (
          <SettingsAccountSkeleton />
        ) : !enabled ? (
          <div className="text-center py-6">
            <p className="text-sm text-gray-600 font-medium">Read and answer replies inside Inertia Leads</p>
            <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">Connect your mailbox and every reply to a campaign is pulled in, matched to the lead and sorted by AI. Available on Growth and Agency.</p>
          </div>
        ) : sendingAccounts.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500">Connect a Gmail or SMTP sending account first</p>
            <p className="text-xs text-gray-400 mt-1">Then link its inbox here so replies flow into the app.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-gray-500 leading-relaxed mb-3">
              Replies are read over IMAP with an <span className="font-semibold text-gray-700">app password</span> — we never see your real password, and sending is unaffected. Only messages that answer one of your campaign emails are imported.
            </p>
            {sendingAccounts.map((acc) => {
              const imap = imapFor(acc.email);
              const isOpen = formEmail === acc.email;
              return (
                <div key={`${acc.type}-${acc.id}`} className="rounded-xl bg-gray-50 border border-gray-100">
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}>
                        <span className="text-white text-xs font-bold">{acc.email[0].toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{acc.email}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase" style={{ background: "rgba(105,98,196,0.1)", color: "#3d3580" }}>{acc.type}</span>
                        </div>
                        {imap ? (
                          imap.is_active ? (
                            <span className="text-xs text-emerald-600">✓ Inbox connected{imap.last_fetched_at ? ` · checked ${new Date(imap.last_fetched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " · first check within 2 minutes"}</span>
                          ) : (
                            <span className="text-xs text-red-600">⚠ {imap.last_error || "Inbox disconnected — reconnect"}</span>
                          )
                        ) : (
                          <span className="text-xs text-gray-400">Inbox not connected — replies stay in your mail app</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {imap && (
                        <button onClick={() => remove(imap.id)} disabled={removing === imap.id} className="text-xs text-gray-400 hover:text-red-500 font-medium disabled:opacity-50 transition-colors">
                          {removing === imap.id ? "..." : "Disconnect"}
                        </button>
                      )}
                      {!isOpen && (
                        <button
                          onClick={() => openForm(acc.email)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all hover:opacity-80"
                          style={{ color: "#3d3580", background: "rgba(105,98,196,0.1)", border: "1px solid rgba(105,98,196,0.25)" }}
                        >
                          {imap ? "↻ Reconnect" : "Connect Inbox"}
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-200 p-4 space-y-3 bg-white rounded-b-xl">
                      {detecting ? (
                        <p className="text-xs text-gray-400">Detecting mail server…</p>
                      ) : detect?.unsupported ? (
                        <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)" }}>
                          <p className="font-semibold text-amber-800 mb-1">Reply sync isn&apos;t available for {detect.provider === "outlook" ? "Outlook / Microsoft 365" : "this provider"} yet</p>
                          <p className="text-amber-800 leading-relaxed">{detect.note}</p>
                          <button onClick={() => { setFormEmail(null); setError(""); setSuccess(""); }} className="mt-3 text-xs font-semibold" style={{ color: "#6962c4" }}>Close</button>
                        </div>
                      ) : (
                        <>
                          <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(105,98,196,0.06)", border: "1px solid rgba(105,98,196,0.15)" }}>
                            <p className="font-semibold text-gray-800 mb-1.5">💡 {help.title}</p>
                            <ol className="list-decimal pl-4 space-y-0.5 text-gray-600">
                              {help.steps.map((s, i) => <li key={i}>{s}</li>)}
                            </ol>
                            {detect?.note && <p className="mt-2 text-amber-700">{detect.note}</p>}
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">App Password</label>
                              <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Paste app password"
                                autoComplete="new-password"
                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#6962c4]/30"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Mail server</label>
                              <div className="flex items-center justify-between px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-700">
                                <span className="truncate">{host || "—"}:{port}</span>
                                <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-xs font-medium ml-2" style={{ color: "#6962c4" }}>{showAdvanced ? "hide" : "edit"}</button>
                              </div>
                            </div>
                          </div>
                          {showAdvanced && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="sm:col-span-1">
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">IMAP Host</label>
                                <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.yourdomain.com" className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#6962c4]/30" />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Port</label>
                                <input type="text" value={port} onChange={(e) => setPort(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#6962c4]/30" />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Username</label>
                                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#6962c4]/30" />
                              </div>
                            </div>
                          )}
                          {error && <div className="text-xs text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">{error}</div>}
                          {success && <div className="text-xs text-emerald-600 bg-emerald-50 p-3 rounded-xl border border-emerald-100">✓ {success}</div>}
                          <div className="flex items-center gap-2">
                            <button onClick={test} disabled={testing || saving || !password || !host} className="px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50 transition-all" style={{ color: "#3d3580", background: "rgba(105,98,196,0.1)", border: "1px solid rgba(105,98,196,0.25)" }}>
                              {testing ? "Testing…" : "Test Connection"}
                            </button>
                            <button onClick={save} disabled={saving || testing || !password || !host} className="px-4 py-2 text-xs font-semibold rounded-lg text-white disabled:opacity-50 transition-all" style={{ background: "linear-gradient(135deg, #6962c4, #8b5cf6)" }}>
                              {saving ? "Connecting…" : "Save & Connect"}
                            </button>
                            <button onClick={() => { setFormEmail(null); setError(""); setSuccess(""); }} className="ml-auto text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
