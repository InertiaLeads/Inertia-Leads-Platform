"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { usePlan } from "../PlanContext";
import FeatureGate from "../FeatureGate";
import LockedFeatureModal from "../LockedFeatureModal";
import { DashboardSkeleton } from "../Skeleton";

// =============================================
// Unified Inbox — replies to outreach, read + answered without leaving the app
// =============================================

type Classification = "interested" | "not_interested" | "out_of_office" | "unsubscribe" | "question" | "bounce";

interface ReplyListItem {
  id: string;
  email_id: string;
  lead_id: string;
  campaign_id: string;
  from_email: string;
  subject: string;
  preview: string;
  received_at: string;
  is_read: boolean;
  is_archived: boolean;
  classification: Classification | null;
  classification_confidence: number | null;
  classified_by: "ai" | "heuristic" | "user" | null;
  ooo_return_date: string | null;
  lead: { id: string; name: string; company: string; email: string; phone?: string; website?: string; score?: number } | null;
  campaign: { id: string; name: string } | null;
}

interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  from_email: string;
  to_email: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  received_at: string;
  classification: Classification | null;
  classification_confidence: number | null;
  classified_by: string | null;
  classification_reason: string | null;
  ooo_return_date: string | null;
}

interface SentEmail {
  id: string;
  subject: string;
  body: string;
  sequence_step: number;
  sent_at: string | null;
  open_count: number;
  click_count: number;
  is_resend: boolean;
}

interface Thread {
  reply: { id: string; email_id: string; is_read: boolean; is_archived: boolean; classification: Classification | null; ooo_return_date?: string | null };
  lead: { id: string; name: string; company: string; email: string; phone?: string; website?: string; industry?: string; score?: number; audit_token?: string | null; summary?: string | null } | null;
  campaign: { id: string; name: string; status: string } | null;
  sentEmails: SentEmail[];
  messages: ThreadMessage[];
  pendingFollowUps?: number;
}

const CLASS_META: Record<Classification | "unclassified", { label: string; color: string; bg: string; ring: string; dot: string }> = {
  interested:     { label: "Interested",     color: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200", dot: "#10b981" },
  question:       { label: "Question",       color: "text-blue-700",    bg: "bg-blue-50",    ring: "ring-blue-200",    dot: "#3b82f6" },
  out_of_office:  { label: "Out of Office",  color: "text-amber-700",   bg: "bg-amber-50",   ring: "ring-amber-200",   dot: "#f59e0b" },
  not_interested: { label: "Not Interested", color: "text-gray-600",    bg: "bg-gray-100",   ring: "ring-gray-200",    dot: "#9ca3af" },
  unsubscribe:    { label: "Unsubscribe",    color: "text-red-700",     bg: "bg-red-50",     ring: "ring-red-200",     dot: "#ef4444" },
  bounce:         { label: "Bounce",         color: "text-red-900",     bg: "bg-red-100",    ring: "ring-red-300",     dot: "#991b1b" },
  unclassified:   { label: "Unclassified",   color: "text-gray-500",    bg: "bg-gray-50",    ring: "ring-gray-200",    dot: "#d1d5db" },
};
const CLASS_ORDER: Classification[] = ["interested", "question", "out_of_office", "not_interested", "unsubscribe", "bounce"];

function ClassBadge({ c, small = false }: { c: Classification | null; small?: boolean }) {
  const m = CLASS_META[c || "unclassified"];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md font-semibold ring-1 ${m.bg} ${m.color} ${m.ring} ${small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Split a plain-text reply into the part the lead actually wrote and the quoted history
// ("On … wrote:" blocks, lines starting with ">"). Mirrors stripQuotedText on the backend.
function splitQuoted(text: string): { visible: string; quoted: string } {
  const t = (text || "").replace(/\r\n/g, "\n");
  const markers = [
    /^On .{5,160} wrote:\s*$/m,
    /^-{2,}\s*Original Message\s*-{2,}\s*$/mi,
    /^From:\s.+\nSent:\s.+$/m,
    /^_{10,}\s*$/m,
    /^Le .{5,160} a écrit\s*:\s*$/m,
    /^Am .{5,160} schrieb .+:\s*$/m,
    /^El .{5,160} escribió:\s*$/m,
    /^>/m,
  ];
  let cut = t.length;
  for (const m of markers) {
    const idx = t.search(m);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  const visible = t.slice(0, cut).trim();
  const quoted = t.slice(cut).trim();
  // If the split would hide everything (reply is only quoted text), show it all.
  if (!visible) return { visible: t.trim(), quoted: "" };
  return { visible, quoted };
}

function notifySidebar() {
  try { window.dispatchEvent(new Event("inbox:changed")); } catch { /* ignore */ }
}

const PAGE_SIZE = 25;

export default function InboxPage() {
  const plan = usePlan();
  const searchParams = useSearchParams();
  const deepLinkReply = searchParams.get("reply");

  const [replies, setReplies] = useState<ReplyListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<"all" | "unread" | "archived">("all");
  const [classFilter, setClassFilter] = useState<Classification | "unclassified" | "">("");
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showHtml, setShowHtml] = useState<Record<string, boolean>>({});
  const [showQuoted, setShowQuoted] = useState<Record<string, boolean>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const canUse = plan.loaded && plan.canAccessFeatures && plan.features.unifiedInbox;

  // Is at least one IMAP inbox connected? Decides whether the empty state says
  // "connect your inbox" or "waiting for replies".
  const [inboxConnected, setInboxConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!canUse) return;
    apiGet<{ accounts: Array<{ is_active: boolean }> }>("/imap/accounts")
      .then((d) => setInboxConnected(d.accounts.some((a) => a.is_active)))
      .catch(() => setInboxConnected(false));
  }, [canUse]);

  const loadCounts = useCallback(() => {
    apiGet<{ counts: Record<string, number> }>("/inbox/counts").then((d) => setCounts(d.counts)).catch(() => {});
  }, []);

  const loadList = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingList(true);
    try {
      const params = new URLSearchParams({ filter, page: String(page), limit: String(PAGE_SIZE) });
      if (classFilter) params.set("classification", classFilter);
      if (search.trim()) params.set("q", search.trim());
      const data = await apiGet<{ replies: ReplyListItem[]; total: number }>(`/inbox?${params.toString()}`);
      setReplies(data.replies);
      setTotal(data.total);
    } catch (err) {
      if (!opts?.silent) showToast("error", err instanceof Error ? err.message : "Failed to load inbox");
    } finally {
      setLoadingList(false);
    }
  }, [filter, page, classFilter, search]);

  useEffect(() => {
    if (!canUse) return;
    loadList();
    loadCounts();
  }, [canUse, loadList, loadCounts]);

  // Background refresh every 30s (new replies arrive from the fetcher job every ~2 min)
  useEffect(() => {
    if (!canUse) return;
    const id = setInterval(() => { loadList({ silent: true }); loadCounts(); }, 30000);
    return () => clearInterval(id);
  }, [canUse, loadList, loadCounts]);

  useEffect(() => { setPage(1); }, [filter, classFilter, search]);

  const openThread = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoadingThread(true);
    setReplyText("");
    try {
      const t = await apiGet<Thread>(`/inbox/${id}/thread`);
      setThread(t);
      if (!t.reply.is_read) {
        apiPost(`/inbox/${id}/read`, {}).then(() => {
          setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, is_read: true } : r)));
          loadCounts();
          notifySidebar();
        }).catch(() => {});
      }
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to load conversation");
      setThread(null);
    } finally {
      setLoadingThread(false);
    }
  }, [loadCounts]);

  // Deep link from the dashboard "Today" panel: /inbox?reply=<id> opens that conversation.
  const deepLinked = useRef<string | null>(null);
  useEffect(() => {
    if (!canUse || !deepLinkReply || deepLinked.current === deepLinkReply) return;
    deepLinked.current = deepLinkReply;
    openThread(deepLinkReply);
  }, [canUse, deepLinkReply, openThread]);

  const changeClassification = async (id: string, classification: Classification) => {
    try {
      const res = await apiPut<{ pendingFollowUps?: number }>(`/inbox/${id}/classification`, { classification });
      setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, classification, classified_by: "user" } : r)));
      if (thread && thread.reply.id === id) {
        setThread({
          ...thread,
          pendingFollowUps: res?.pendingFollowUps ?? thread.pendingFollowUps,
          reply: { ...thread.reply, classification },
          messages: thread.messages.map((m) => (m.id === id ? { ...m, classification, classified_by: "user", classification_reason: "Set manually" } : m)),
        });
      }
      loadCounts();
      showToast("success", `Marked as ${CLASS_META[classification].label}`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to update");
    }
  };

  // Out-of-office: user overrides the day the lead is back; follow-ups resume on that day.
  const [savingResume, setSavingResume] = useState(false);
  const setResumeDate = async (date: string) => {
    if (!thread || !date) return;
    setSavingResume(true);
    try {
      const r = await apiPut<{ returnDate: string; moved: number }>(`/inbox/${thread.reply.id}/resume-date`, { returnDate: date });
      setThread({ ...thread, reply: { ...thread.reply, ooo_return_date: r.returnDate }, messages: thread.messages.map((m) => (m.id === thread.reply.id ? { ...m, ooo_return_date: r.returnDate } : m)) });
      setReplies((prev) => prev.map((x) => (x.id === thread.reply.id ? { ...x, ooo_return_date: r.returnDate } : x)));
      const resume = new Date(`${r.returnDate}T00:00:00`);
      showToast("success", `Follow-ups resume ${resume.toLocaleDateString("en-US", { month: "short", day: "numeric" })}${r.moved ? "" : " (no pending follow-ups to move)"}`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to update resume date");
    } finally {
      setSavingResume(false);
    }
  };

  const sendReply = async () => {
    if (!thread || !selectedId || replyText.trim().length < 2) return;
    setSending(true);
    try {
      const res = await apiPost<{ sent: { id: string; subject: string; body: string; to: string; received_at: string } }>(`/inbox/${selectedId}/reply`, { body: replyText.trim() });
      setThread({
        ...thread,
        messages: [
          ...thread.messages,
          {
            id: res.sent.id || `tmp-${Date.now()}`,
            direction: "outbound",
            from_email: "",
            to_email: res.sent.to,
            subject: res.sent.subject,
            body_text: res.sent.body,
            body_html: null,
            received_at: res.sent.received_at || new Date().toISOString(),
            classification: null, classification_confidence: null, classified_by: null, classification_reason: null, ooo_return_date: null,
          },
        ],
      });
      setReplyText("");
      showToast("success", "Reply sent");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  // ---------- gating ----------
  if (!plan.loaded) return <DashboardSkeleton />;
  if (!plan.canAccessFeatures) return <LockedFeatureModal />;
  if (!plan.features.unifiedInbox) {
    return <FeatureGate featureName="Unified Inbox" description="Read and reply to every lead response inside Inertia Leads. Replies are pulled from your mailbox, matched to your campaigns and sorted by AI." requiredPlan="Growth" />;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 120px)" }}>
      {toast && (
        <div className={`fixed top-24 right-8 z-50 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium text-white ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"}`}>
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl px-8 py-4 mb-4 shrink-0" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #2a2158 100%)" }}>
        <div className="absolute inset-0">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl" style={{ background: "rgba(105,98,196,0.12)" }} />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <svg className="w-5 h-5" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-3.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 007.586 13H4" />
                </svg>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">Inbox</h1>
            </div>
            <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Replies from your leads, matched to their campaign and sorted by AI. New replies appear within a few minutes.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${filter === f ? "text-white" : "text-white/60 hover:text-white"}`}
                style={filter === f ? { background: "linear-gradient(135deg, #6962c4, #a78bfa)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {f === "all" ? `All${counts.all !== undefined ? ` (${counts.all})` : ""}` : `Unread${counts.unread ? ` (${counts.unread})` : ""}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Classification tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap shrink-0">
        <button
          onClick={() => setClassFilter("")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg ring-1 transition-all ${classFilter === "" ? "text-white ring-transparent" : "bg-white text-gray-600 ring-gray-200 hover:ring-gray-300"}`}
          style={classFilter === "" ? { background: "linear-gradient(135deg, #3d3580, #6962c4)" } : undefined}
        >
          Everything
        </button>
        {CLASS_ORDER.map((c) => {
          const m = CLASS_META[c];
          const active = classFilter === c;
          return (
            <button
              key={c}
              onClick={() => setClassFilter(active ? "" : c)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ring-1 transition-all ${active ? `${m.bg} ${m.color} ${m.ring} ring-2` : "bg-white text-gray-600 ring-gray-200 hover:ring-gray-300"}`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
              {m.label}
              {counts[c] ? <span className="opacity-60">{counts[c]}</span> : null}
            </button>
          );
        })}
        {counts.unclassified ? (
          <button
            onClick={() => setClassFilter(classFilter === "unclassified" ? "" : "unclassified")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg ring-1 transition-all ${classFilter === "unclassified" ? "bg-gray-100 text-gray-700 ring-gray-300 ring-2" : "bg-white text-gray-600 ring-gray-200 hover:ring-gray-300"}`}
          >
            Unclassified <span className="opacity-60">{counts.unclassified}</span>
          </button>
        ) : null}
        <div className="ml-auto relative">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="text"
            placeholder="Search replies…"
            defaultValue={search}
            onChange={(e) => {
              const v = e.target.value;
              if (searchTimer.current) clearTimeout(searchTimer.current);
              searchTimer.current = setTimeout(() => setSearch(v), 350);
            }}
            className="pl-9 pr-3 py-2 text-sm rounded-xl bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#6962c4]/30 w-64"
          />
        </div>
      </div>

      {/* Split panel */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
        {/* Left: list */}
        <div className="bg-white rounded-2xl overflow-hidden flex flex-col min-h-0" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
          <div className={`flex-1 ${loadingList ? "overflow-hidden" : "overflow-y-auto"}`} style={{ scrollbarWidth: "thin" }}>
            {loadingList ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}
              </div>
            ) : replies.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-8 py-16">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(105,98,196,0.08)" }}>
                  <svg className="w-7 h-7 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-3.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 007.586 13H4" /></svg>
                </div>
                <p className="text-sm font-semibold text-gray-700">
                  {filter === "unread" ? "No unread replies" : (classFilter || search) ? "No replies match" : inboxConnected ? "Waiting for replies" : "No replies here yet"}
                </p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  {filter === "unread"
                    ? "You're all caught up."
                    : (classFilter || search)
                    ? "Try a different filter or search term."
                    : inboxConnected
                    ? "Your inbox is connected and checked every 2 minutes. Replies to your campaign emails will appear here automatically."
                    : "Connect your inbox in Settings and replies to your campaigns will appear automatically."}
                </p>
                {filter === "all" && !classFilter && !search && inboxConnected === false && (
                  <Link href="/settings#inbox-connection" className="mt-4 px-4 py-2 text-xs font-bold rounded-lg text-white" style={{ background: "linear-gradient(135deg, #6962c4, #8b5cf6)" }}>
                    Connect inbox
                  </Link>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {replies.map((r) => {
                  const active = r.id === selectedId;
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => openThread(r.id)}
                        className={`w-full text-left px-4 py-3.5 transition-colors ${active ? "" : "hover:bg-gray-50"}`}
                        style={active ? { background: "linear-gradient(90deg, rgba(105,98,196,0.16) 0%, rgba(105,98,196,0.08) 100%)", boxShadow: "inset 4px 0 0 #6962c4, inset 0 -1px 0 rgba(105,98,196,0.25), inset 0 1px 0 rgba(105,98,196,0.25)" } : undefined}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: r.is_read ? "transparent" : "#7c3aed", boxShadow: r.is_read ? "none" : "0 0 8px rgba(124,58,237,0.6)" }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-sm truncate ${active ? "font-bold" : r.is_read ? "font-medium text-gray-700" : "font-bold text-gray-900"}`} style={active ? { color: "#3d3580" } : undefined}>
                                {r.lead?.company || r.lead?.name || r.from_email}
                              </p>
                              <span className="text-[11px] text-gray-400 shrink-0">{timeAgo(r.received_at)}</span>
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-0.5">{r.subject || "(no subject)"}</p>
                            <p className="text-xs text-gray-400 truncate mt-1">{r.preview}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <ClassBadge c={r.classification} small />
                              {r.campaign && <span className="text-[10px] text-gray-400 truncate">{r.campaign.name}</span>}
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {totalPages > 1 && (
            <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-gray-100 text-xs text-gray-500">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2.5 py-1 rounded-md hover:bg-gray-100 disabled:opacity-40">← Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-2.5 py-1 rounded-md hover:bg-gray-100 disabled:opacity-40">Next →</button>
            </div>
          )}
        </div>

        {/* Right: thread */}
        <div className="bg-white rounded-2xl overflow-hidden flex flex-col min-h-0" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
          {!selectedId ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-8">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(105,98,196,0.08)" }}>
                <svg className="w-8 h-8" style={{ color: "#a78bfa" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">Select a reply</p>
              <p className="text-xs text-gray-400 mt-1">The full conversation, lead details and a reply box will appear here.</p>
            </div>
          ) : loadingThread || !thread ? (
            <div className="p-6 space-y-4">
              <div className="h-16 rounded-xl bg-gray-100 animate-pulse" />
              <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />
              <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />
            </div>
          ) : (
            <>
              {/* Lead header */}
              <div className="shrink-0 px-6 py-4 flex items-start justify-between gap-4" style={{ background: "#2f276c" }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-bold text-white capitalize truncate">{thread.lead?.company || thread.lead?.name || "Lead"}</h2>
                    {typeof thread.lead?.score === "number" && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}>Score {thread.lead.score}</span>
                    )}
                    <ClassBadge c={thread.reply.classification} small />
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs flex-wrap" style={{ color: "rgba(255,255,255,0.65)" }}>
                    {thread.lead?.email && <span>{thread.lead.email}</span>}
                    {thread.lead?.phone && <span>· {thread.lead.phone}</span>}
                    {thread.lead?.website && <a href={thread.lead.website.startsWith("http") ? thread.lead.website : `https://${thread.lead.website}`} target="_blank" rel="noopener noreferrer" className="hover:text-white underline-offset-2 hover:underline">· {thread.lead.website.replace(/^https?:\/\//, "")}</a>}
                    {thread.campaign && <Link href={`/campaigns/${thread.campaign.id}`} className="hover:text-white">· {thread.campaign.name}</Link>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {thread.reply.classification === "out_of_office" && thread.pendingFollowUps === 0 && (
                    <span className="text-[11px] font-semibold px-2 py-1 rounded-md whitespace-nowrap" style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)" }} title="All follow-ups have been sent or stopped — nothing left to reschedule">
                      No follow-ups left
                    </span>
                  )}
                  {thread.reply.classification === "out_of_office" && thread.pendingFollowUps !== 0 && (
                    <>
                      <span className="text-[11px] font-semibold px-2 py-1 rounded-md whitespace-nowrap" style={{ background: "rgba(245,158,11,0.18)", color: "#fcd34d" }} title={thread.reply.ooo_return_date ? "Follow-ups resume on the day the lead is back" : "No return date detected — follow-ups keep their normal schedule"}>
                        {thread.reply.ooo_return_date
                          ? `Resumes ${new Date(`${thread.reply.ooo_return_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                          : "No date · normal schedule"}
                      </span>
                      <input
                        type="date"
                        value={thread.reply.ooo_return_date || ""}
                        min={new Date().toISOString().slice(0, 10)}
                        disabled={savingResume}
                        onChange={(e) => setResumeDate(e.target.value)}
                        title="Day the lead is back"
                        className="text-xs rounded-lg px-2 py-1.5 focus:outline-none cursor-pointer"
                        style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", colorScheme: "dark" }}
                      />
                    </>
                  )}
                  <select
                    value={thread.reply.classification || ""}
                    onChange={(e) => e.target.value && changeClassification(thread.reply.id, e.target.value as Classification)}
                    className="text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
                    title="Change classification"
                  >
                    <option value="" disabled style={{ color: "#333" }}>Set label…</option>
                    {CLASS_ORDER.map((c) => <option key={c} value={c} style={{ color: "#333" }}>{CLASS_META[c].label}</option>)}
                  </select>
                </div>
              </div>

              {/* Conversation */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4" style={{ scrollbarWidth: "thin" }}>
                {(() => {
                  // Merge sent emails and replies into one timeline
                  type Item = { key: string; at: string; kind: "sent" | "inbound" | "outbound"; sent?: SentEmail; msg?: ThreadMessage };
                  const items: Item[] = [
                    ...thread.sentEmails.map((e) => ({ key: `s-${e.id}`, at: e.sent_at || "", kind: "sent" as const, sent: e })),
                    ...thread.messages.map((m) => ({ key: `m-${m.id}`, at: m.received_at, kind: m.direction, msg: m })),
                  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

                  return items.map((it) => {
                    if (it.kind === "sent" && it.sent) {
                      const e = it.sent;
                      return (
                        <div key={it.key} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(105,98,196,0.45)", background: "rgba(105,98,196,0.06)", boxShadow: "0 1px 4px rgba(61,53,128,0.08)" }}>
                          <div className="flex items-center justify-between px-4 py-2.5 text-[11px]" style={{ background: "rgba(105,98,196,0.18)", borderBottom: "1px solid rgba(105,98,196,0.3)" }}>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md font-bold text-white" style={{ background: "#6962c4" }}>
                                {e.is_resend ? "Re-sent" : e.sequence_step === 1 ? "You · Initial" : `You · Follow-up ${e.sequence_step - 1}`}
                              </span>
                              <span className="font-medium" style={{ color: "#3d3580" }}>{e.open_count > 0 ? `${e.open_count} open${e.open_count === 1 ? "" : "s"}` : "not opened"}{e.click_count > 0 ? ` · ${e.click_count} click${e.click_count === 1 ? "" : "s"}` : ""}</span>
                            </div>
                            <span style={{ color: "#3d3580" }}>{e.sent_at ? new Date(e.sent_at).toLocaleString() : ""}</span>
                          </div>
                          <div className="px-4 py-3">
                            <p className="text-xs font-semibold text-gray-800 mb-2">{e.subject}</p>
                            <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">{e.body}</p>
                          </div>
                        </div>
                      );
                    }
                    const m = it.msg!;
                    const inbound = m.direction === "inbound";
                    const html = showHtml[m.id] && m.body_html;
                    return (
                      <div key={it.key} className="rounded-xl overflow-hidden" style={inbound ? { border: "1px solid rgba(16,185,129,0.3)" } : { border: "1px solid rgba(59,130,246,0.25)", background: "rgba(59,130,246,0.03)" }}>
                        <div className="flex items-center justify-between px-4 py-2.5 text-[11px]" style={{ background: inbound ? "rgba(16,185,129,0.08)" : "rgba(59,130,246,0.08)" }}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded-md font-bold text-white" style={{ background: inbound ? "#10b981" : "#3b82f6" }}>{inbound ? (m.from_email || "Lead") : "You · Reply"}</span>
                            {inbound && <ClassBadge c={m.classification} small />}
                            {inbound && m.classified_by && (
                              <span className="text-gray-400" title={m.classification_reason || ""}>
                                {m.classified_by === "user" ? "set by you" : `AI${typeof m.classification_confidence === "number" ? ` · ${Math.round(m.classification_confidence * 100)}%` : ""}`}
                              </span>
                            )}
                            {m.ooo_return_date && <span className="text-amber-700">back {new Date(m.ooo_return_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {inbound && m.body_html && (
                              <button onClick={() => setShowHtml((s) => ({ ...s, [m.id]: !s[m.id] }))} className="text-gray-400 hover:text-gray-600">{html ? "plain text" : "formatted"}</button>
                            )}
                            <span className="text-gray-400">{new Date(m.received_at).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="px-4 py-3">
                          {m.subject && <p className="text-xs font-semibold text-gray-800 mb-2">{m.subject}</p>}
                          {html ? (
                            <iframe
                              title="reply"
                              sandbox=""
                              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#374151;margin:0;padding:4px}</style></head><body>${m.body_html}</body></html>`}
                              className="w-full rounded-lg border border-gray-100"
                              style={{ minHeight: 260 }}
                            />
                          ) : (
                            (() => {
                              const { visible, quoted } = inbound ? splitQuoted(m.body_text) : { visible: m.body_text, quoted: "" };
                              return (
                                <>
                                  <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{visible || "(no text content)"}</p>
                                  {quoted && (
                                    <div className="mt-2">
                                      <button
                                        onClick={() => setShowQuoted((q) => ({ ...q, [m.id]: !q[m.id] }))}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors hover:bg-gray-100"
                                        style={{ color: "#6962c4", background: "rgba(105,98,196,0.06)" }}
                                      >
                                        <span className="tracking-widest leading-none">•••</span>
                                        {showQuoted[m.id] ? "Hide quoted text" : "Show quoted text"}
                                      </button>
                                      {showQuoted[m.id] && (
                                        <p className="mt-2 pl-3 text-xs text-gray-400 whitespace-pre-line leading-relaxed" style={{ borderLeft: "2px solid rgba(105,98,196,0.25)" }}>{quoted}</p>
                                      )}
                                    </div>
                                  )}
                                </>
                              );
                            })()
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Composer */}
              <div className="shrink-0 px-5 py-3" style={{ borderTop: "1px solid rgba(105,98,196,0.15)" }}>
                {(thread.reply.classification === "unsubscribe" || thread.reply.classification === "bounce") && (
                  <p className="text-[11px] text-red-600 mb-2">
                    {thread.reply.classification === "unsubscribe" ? "This lead asked to stop receiving emails. Their address is on your suppression list — reply only if they contacted you again." : "This was a delivery failure; the address may be invalid."}
                  </p>
                )}
                <div className="flex items-stretch gap-3">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") sendReply(); }}
                    placeholder={`Reply to ${thread.lead?.company || thread.lead?.name || "lead"}…`}
                    rows={2}
                    className="flex-1 text-sm rounded-xl px-4 py-2.5 focus:outline-none resize-y min-h-[56px] max-h-[40vh] placeholder:text-white/60"
                    style={{ background: "linear-gradient(135deg, #4a41a3 0%, #6962c4 100%)", border: "1px solid rgba(196,181,253,0.5)", color: "#ffffff", caretColor: "#ffffff", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)" }}
                  />
                  <button
                    onClick={sendReply}
                    disabled={sending || replyText.trim().length < 2}
                    title="Send reply (Ctrl+Enter)"
                    className="shrink-0 self-stretch inline-flex flex-col items-center justify-center gap-1 px-4 min-w-[92px] text-xs font-semibold rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-110"
                    style={{ background: "linear-gradient(135deg, #6962c4, #a78bfa)", boxShadow: "0 4px 16px rgba(105,98,196,0.3)" }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
