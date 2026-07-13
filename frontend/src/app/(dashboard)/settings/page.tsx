"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { SettingsAccountSkeleton } from "../Skeleton";
import PricingModal from "./PricingModal";

// ===== Toast Notification System =====
type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

let toastIdCounter = 0;

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: number) => void }) {
  if (toasts.length === 0) return null;

  const styles: Record<ToastType, string> = {
    success: "bg-green-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-gray-800 text-white",
  };

  const icons: Record<ToastType, string> = {
    success: "✓",
    error: "✕",
    info: "ℹ",
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${styles[toast.type]} px-4 py-3 rounded-lg shadow-lg flex items-start gap-3 text-sm`}
          role="alert"
        >
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
            {icons[toast.type]}
          </span>
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 text-white/70 hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

interface GmailAccount {
  id: string;
  email: string;
  is_primary: boolean;
  warmup_started_at: string;
  created_at: string;
}

interface SmtpAccount {
  id: string;
  email: string;
  display_name: string;
  host: string;
  port: number;
  is_primary: boolean;
  warmup_started_at: string;
  created_at: string;
}

interface AccountsResponse {
  accounts: GmailAccount[];
  maxInboxes: number;
  plan: string;
}

interface SmtpAccountsResponse {
  accounts: SmtpAccount[];
}

type SmtpProvider = "outlook" | "office365" | "yahoo" | "zoho" | "custom";

const SMTP_PRESETS: Record<SmtpProvider, { label: string; host: string; port: string; useTls: boolean; helpText: string }> = {
  outlook: {
    label: "Outlook / Hotmail",
    host: "smtp-mail.outlook.com",
    port: "587",
    useTls: true,
    helpText: "If you have 2FA enabled, use an App Password from account.microsoft.com/security",
  },
  office365: {
    label: "Microsoft 365 (Work/School)",
    host: "smtp.office365.com",
    port: "587",
    useTls: true,
    helpText: "Your admin may need to enable \"Authenticated SMTP\" for your account",
  },
  yahoo: {
    label: "Yahoo Mail",
    host: "smtp.mail.yahoo.com",
    port: "587",
    useTls: true,
    helpText: "Generate an App Password at login.yahoo.com → Account Security → App Passwords",
  },
  zoho: {
    label: "Zoho Mail",
    host: "smtp.zoho.com",
    port: "587",
    useTls: true,
    helpText: "Use an App Password if 2FA is enabled. Find it in Zoho Accounts → Security",
  },
  custom: {
    label: "Custom SMTP",
    host: "",
    port: "587",
    useTls: true,
    helpText: "Enter your SMTP server details manually",
  },
};

export default function SettingsPage() {
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccount[]>([]);
  const [smtpAccounts, setSmtpAccounts] = useState<SmtpAccount[]>([]);
  const [maxInboxes, setMaxInboxes] = useState(1);
  const [plan, setPlan] = useState("starter");
  const [hasPlan, setHasPlan] = useState(true);
  const [isExpired, setIsExpired] = useState(false);
  const [isTrialExpired, setIsTrialExpired] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isPastDue, setIsPastDue] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [periodEndDate, setPeriodEndDate] = useState<string | null>(null);
  const [periodStartDate, setPeriodStartDate] = useState<string | null>(null);
  const [isOnTrial, setIsOnTrial] = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  // SMTP form state
  const [showSmtpForm, setShowSmtpForm] = useState(false);
  const [smtpProvider, setSmtpProvider] = useState<SmtpProvider | "">("");
  const [smtpForm, setSmtpForm] = useState({
    email: "",
    displayName: "",
    host: "",
    port: "587",
    username: "",
    password: "",
    useTls: true,
  });
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpError, setSmtpError] = useState("");
  const [smtpSuccess, setSmtpSuccess] = useState("");

  // Profile state
  const [profileName, setProfileName] = useState("");
  const [profileCompany, setProfileCompany] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [memberSince, setMemberSince] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password change state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Service type state
  const [serviceType, setServiceType] = useState("");
  const [savedServiceType, setSavedServiceType] = useState("");
  const [serviceTypeSaving, setServiceTypeSaving] = useState(false);
  const [serviceTypeLoading, setServiceTypeLoading] = useState(true);
  const [billingError, setBillingError] = useState(false);
  const toast = useToast();

  const totalInboxes = gmailAccounts.length + smtpAccounts.length;

  const fetchAccounts = useCallback(async () => {
    try {
      const [gmailData, smtpData] = await Promise.all([
        apiGet<AccountsResponse>("/gmail/accounts"),
        apiGet<SmtpAccountsResponse>("/smtp/accounts"),
      ]);
      setGmailAccounts(gmailData.accounts);
      setSmtpAccounts(smtpData.accounts);
      setMaxInboxes(gmailData.maxInboxes);
      setPlan(gmailData.plan);
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    // Load current name from Supabase user metadata
    const loadProfile = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setProfileName(user?.user_metadata?.full_name || "");
      setProfileCompany(user?.user_metadata?.company_name || "");
      setProfileAddress(user?.user_metadata?.business_address || "");
      setProfileAvatarUrl(user?.user_metadata?.avatar_url || "");
      setProfileEmail(user?.email || "");
      if (user?.created_at) {
        setMemberSince(new Date(user.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" }));
      }
      if (!user?.user_metadata?.full_name || !user?.user_metadata?.business_address) setProfileEditing(true);
    };
    loadProfile();
    // Load service type and subscription status from stats
    apiGet<{ serviceType?: string; subscriptionStatus?: string; isOnTrial?: boolean; trialDaysLeft?: number; currentPeriodEnd?: string; currentPeriodStart?: string }>("/stats").then((data) => {
      if (data.serviceType) {
        // Migrate deprecated social_media to digital_marketing
        const mapped = data.serviceType === "social_media" ? "digital_marketing" : data.serviceType;
        setServiceType(mapped);
        setSavedServiceType(mapped);
      } else {
        setServiceType("web_dev");
        setSavedServiceType("web_dev");
      }
      // Set plan/trial status
      setIsOnTrial(data.isOnTrial || false);
      setTrialDaysLeft(data.trialDaysLeft ?? null);
      setPeriodEndDate(data.currentPeriodEnd || null);
      setPeriodStartDate(data.currentPeriodStart || null);

      if (data.subscriptionStatus === "cancelled" && data.currentPeriodEnd && new Date(data.currentPeriodEnd) > new Date()) {
        // Cancelled but still has access until period ends
        setHasPlan(true);
        setIsExpired(false);
        setIsTrialExpired(false);
        setIsCancelling(true);
        setIsPastDue(false);
        setIsPaused(false);
      } else if (data.subscriptionStatus === "past_due") {
        // Payment failed — show warning, still has access during grace period
        setHasPlan(true);
        setIsExpired(false);
        setIsTrialExpired(false);
        setIsCancelling(false);
        setIsPastDue(true);
        setIsPaused(false);
      } else if (data.subscriptionStatus === "paused") {
        // Subscription paused — no access
        setHasPlan(false);
        setIsExpired(false);
        setIsTrialExpired(false);
        setIsCancelling(false);
        setIsPastDue(false);
        setIsPaused(true);
      } else if (data.subscriptionStatus === "trialing" && !data.isOnTrial) {
        // Free trial ended without payment — status stays "trialing" but the trial date has passed.
        // Show the locked "choose a plan" state (trial-flavored copy).
        setHasPlan(false);
        setIsExpired(true);
        setIsTrialExpired(true);
        setIsCancelling(false);
        setIsPastDue(false);
        setIsPaused(false);
      } else if (data.subscriptionStatus === "expired" || data.subscriptionStatus === "cancelled" || data.subscriptionStatus === "none") {
        // Fully expired, cancelled (period over), or no subscription
        setHasPlan(false);
        setIsExpired(true);
        setIsTrialExpired(false);
        setIsCancelling(false);
        setIsPastDue(false);
        setIsPaused(false);
      } else {
        // "trialing" (active) and "active" — show active plan / trial card
        setHasPlan(true);
        setIsExpired(false);
        setIsTrialExpired(false);
        setIsCancelling(false);
        setIsPastDue(false);
        setIsPaused(false);
      }
    }).catch(() => {
      // /stats failed (network / rate-limit 429 / server error). Do NOT fall back to the default
      // plan state — that would render a misleading "Starter · Active" card. Flag an error so the
      // billing card shows a retry state instead of fabricated data.
      setServiceType("web_dev");
      setSavedServiceType("web_dev");
      setBillingError(true);
    }).finally(() => {
      setServiceTypeLoading(false);
    });
  }, [fetchAccounts]);

  const saveProfile = async () => {
    if (!profileAddress.trim()) {
      setProfileMsg({ type: "error", text: "Business address is required (CAN-SPAM compliance)." });
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: profileName.trim(),
          company_name: profileCompany.trim(),
          business_address: profileAddress.trim(),
          avatar_url: profileAvatarUrl,
        },
      });
      if (error) throw error;
      setProfileMsg({ type: "success", text: "Profile updated!" });
      setProfileEditing(false);
      setTimeout(() => setProfileMsg(null), 3000);
    } catch {
      setProfileMsg({ type: "error", text: "Failed to update profile." });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setProfileMsg({ type: "error", text: "Please select an image file." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileMsg({ type: "error", text: "Image must be under 2MB." });
      return;
    }

    setAvatarUploading(true);
    setProfileMsg(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const ext = file.name.split(".").pop();
      const filePath = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      const url = `${publicUrl}?t=${Date.now()}`;
      setProfileAvatarUrl(url);

      await supabase.auth.updateUser({ data: { avatar_url: url } });
      setProfileMsg({ type: "success", text: "Avatar uploaded!" });
    } catch {
      setProfileMsg({ type: "error", text: "Failed to upload avatar." });
    } finally {
      setAvatarUploading(false);
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 6) {
      setPasswordMsg({ type: "error", text: "Password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match." });
      return;
    }
    setPasswordSaving(true);
    setPasswordMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordMsg({ type: "success", text: "Password changed!" });
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordMsg({ type: "error", text: "Failed to change password." });
    } finally {
      setPasswordSaving(false);
    }
  };

  // Handle OAuth callback code from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const gmailStatus = params.get("gmail");

    // Backend GET /gmail/callback redirects here with ?gmail=connected|error after connecting.
    if (gmailStatus === "connected") {
      fetchAccounts();
      toast.addToast("Gmail connected successfully!", "success");
      window.history.replaceState({}, "", "/settings");
      return;
    }
    if (gmailStatus === "error") {
      toast.addToast("Failed to connect Gmail. Please try again.", "error");
      window.history.replaceState({}, "", "/settings");
      return;
    }

    if (code) {
      (async () => {
        try {
          setLoading(true);
          await apiPost("/gmail/callback", { code });
          await fetchAccounts();
        } catch (err) {
          console.error("Failed to connect Gmail:", err);
          alert("Failed to connect Gmail. Please try again.");
        } finally {
          setLoading(false);
        }
      })();
      window.history.replaceState({}, "", "/settings");
    }
  }, [fetchAccounts]);

  const addGmailInbox = async () => {
    try {
      const { url } = await apiGet<{ url: string }>("/gmail/auth-url");
      window.location.href = url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start Gmail connection.";
      alert(msg);
    }
  };

  const removeGmailInbox = async (accountId: string) => {
    if (!confirm("Remove this Gmail account? Pending emails assigned to it will be reassigned to your primary inbox.")) return;
    try {
      setRemoving(accountId);
      await apiDelete(`/gmail/accounts/${accountId}`);
      await fetchAccounts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove account.";
      alert(msg);
    } finally {
      setRemoving(null);
    }
  };

  const reconnectGmail = async (accountId: string) => {
    try {
      setRemoving(accountId);
      await apiDelete(`/gmail/accounts/${accountId}`);
      const data = await apiGet<{ url: string }>("/gmail/auth-url");
      window.location.href = data.url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reconnect. Try removing and adding again.";
      toast.addToast(msg, "error");
      setRemoving(null);
      await fetchAccounts();
    }
  };

  const removeSmtpInbox = async (accountId: string) => {
    if (!confirm("Remove this SMTP account? Pending emails assigned to it will be reassigned.")) return;
    try {
      setRemoving(accountId);
      await apiDelete(`/smtp/accounts/${accountId}`);
      await fetchAccounts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove SMTP account.";
      alert(msg);
    } finally {
      setRemoving(null);
    }
  };

  const selectProvider = (provider: SmtpProvider) => {
    const preset = SMTP_PRESETS[provider];
    setSmtpProvider(provider);
    setSmtpForm((prev) => ({
      ...prev,
      host: preset.host,
      port: preset.port,
      useTls: preset.useTls,
    }));
    setSmtpError("");
    setSmtpSuccess("");
  };

  const testSmtpConnection = async () => {
    setSmtpError("");
    setSmtpSuccess("");
    setSmtpTesting(true);
    try {
      const username = smtpForm.username || smtpForm.email;
      await apiPost("/smtp/test", {
        email: smtpForm.email,
        host: smtpForm.host,
        port: parseInt(smtpForm.port),
        username,
        password: smtpForm.password,
        useTls: smtpForm.useTls,
      });
      setSmtpSuccess("Connection successful! You can now save this account.");
    } catch (err) {
      setSmtpError(err instanceof Error ? err.message : "Connection test failed.");
    } finally {
      setSmtpTesting(false);
    }
  };

  const saveSmtpAccount = async () => {
    setSmtpError("");
    setSmtpSuccess("");
    setSmtpSaving(true);
    try {
      const username = smtpForm.username || smtpForm.email;
      await apiPost("/smtp/accounts", {
        email: smtpForm.email,
        displayName: smtpForm.displayName,
        host: smtpForm.host,
        port: parseInt(smtpForm.port),
        username,
        password: smtpForm.password,
        useTls: smtpForm.useTls,
      });
      setShowSmtpForm(false);
      setSmtpProvider("");
      setSmtpForm({ email: "", displayName: "", host: "", port: "587", username: "", password: "", useTls: true });
      await fetchAccounts();
    } catch (err) {
      setSmtpError(err instanceof Error ? err.message : "Failed to add SMTP account.");
    } finally {
      setSmtpSaving(false);
    }
  };

  function getWarmupStatus(warmupStartedAt: string): { label: string; color: string } {
    const days = Math.floor((Date.now() - new Date(warmupStartedAt).getTime()) / 86400000) + 1;
    if (days > 21) return { label: "Warmed up", color: "green" };
    const week = Math.ceil(days / 7);
    return { label: `Warmup Week ${week} (Day ${days}/21)`, color: "yellow" };
  }

  // Effective plan expiry: use the real billing period end when available,
  // otherwise derive it as purchase date + 30 days (one billing cycle).
  const effectivePeriodEnd: Date | null = periodEndDate
    ? new Date(periodEndDate)
    : periodStartDate
      ? new Date(new Date(periodStartDate).getTime() + 30 * 24 * 60 * 60 * 1000)
      : null;

  return (
    <div>
      {/* Toast Notifications */}
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />

      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl p-8 md:p-10 mb-8" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #0d0a25 100%)" }}>
        <div className="absolute inset-0">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full" style={{ background: "radial-gradient(circle, rgba(105,98,196,0.15) 0%, transparent 70%)" }} />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full" style={{ background: "radial-gradient(circle, rgba(61,53,128,0.12) 0%, transparent 70%)" }} />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Left: Avatar + Info */}
          <div className="flex items-center gap-6">
            {/* Avatar */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-2xl cursor-pointer group flex-shrink-0"
            >
              <div className="w-20 h-20 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px rgba(105,98,196,0.4), 0 0 0 4px #0d0a25" }}>
                {profileAvatarUrl ? (
                  <img src={profileAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-white" style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}>
                    {(profileName?.[0] || "U").toUpperCase()}
                  </div>
                )}
              </div>
              <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              {avatarUploading && (
                <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </div>
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-3" style={{ background: "rgba(105,98,196,0.15)", border: "1px solid rgba(105,98,196,0.3)" }}>
                <svg className="w-3.5 h-3.5" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>Account Settings</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">{profileName || "Your Profile"}</h1>
              <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>Manage your profile, security, and email integrations</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "rgba(105,98,196,0.2)", color: "#c4b5fd", boxShadow: "inset 0 0 0 1px rgba(105,98,196,0.4)" }}>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                  {plan.charAt(0).toUpperCase() + plan.slice(1)} Plan
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)" }}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  {totalInboxes}/{maxInboxes} inboxes
                </span>
              </div>
            </div>
          </div>

          {/* Right: Service Type Selector */}
          <div className="flex-shrink-0 rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex items-center justify-between mb-4 gap-6">
              <div>
                <span className="text-sm font-bold text-white">Your Service</span>
                <p className="text-[10px] text-white/50 mt-0.5">Controls audit & email style</p>
              </div>
              <button
                onClick={async () => {
                  if (serviceType === savedServiceType) return;
                  setServiceTypeSaving(true);
                  try {
                    await apiPut("/stats/service-type", { serviceType });
                    setSavedServiceType(serviceType);
                    const supabase = createClient();
                    await supabase.auth.updateUser({ data: { service_type_set: true } });
                    toast.addToast("Service type updated", "success");
                  } catch {
                    setServiceType(savedServiceType);
                    toast.addToast("Failed to update service type", "error");
                  } finally {
                    setServiceTypeSaving(false);
                  }
                }}
                disabled={serviceTypeSaving || serviceType === savedServiceType}
                className="px-4 py-1.5 text-[11px] font-bold rounded-lg transition-all disabled:scale-95 disabled:opacity-0"
                style={{ background: "#c4b5fd", color: "#1a1540", boxShadow: "0 2px 12px rgba(196,181,253,0.3)" }}
              >
                {serviceTypeSaving ? "..." : "Save"}
              </button>
            </div>
            {serviceTypeLoading ? (
              <div className="flex gap-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-[115px] h-[78px] rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                ))}
              </div>
            ) : (
              <div className="flex gap-3">
                {([
                  { value: "web_dev", label: "Web Dev", iconPath: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" },
                  { value: "digital_marketing", label: "Marketing", iconPath: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" },
                  { value: "seo", label: "SEO", iconPath: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
                ] as const).map((opt) => {
                  const isSelected = serviceType === opt.value;
                  const isSaved = savedServiceType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setServiceType(opt.value)}
                      disabled={serviceTypeSaving}
                      className="relative flex flex-col items-center justify-center gap-2 w-[115px] py-4 rounded-xl text-center transition-all"
                      style={{
                        background: isSelected ? "rgba(196,181,253,0.12)" : "rgba(255,255,255,0.03)",
                        border: isSelected ? "2px solid #c4b5fd" : "2px solid rgba(255,255,255,0.1)",
                        boxShadow: isSelected ? "0 4px 20px rgba(196,181,253,0.2), inset 0 1px 0 rgba(255,255,255,0.1)" : "inset 0 1px 0 rgba(255,255,255,0.05)",
                      }}
                    >
                      {isSelected && isSaved && (
                        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center shadow-md" style={{ background: "#c4b5fd" }}>
                          <svg className="w-3 h-3" style={{ color: "#1a1540" }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        </div>
                      )}
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
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Card */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
          <div className="px-6 py-4 border-b" style={{ background: "#2f276c", borderColor: "#2f276c" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Personal Information</h2>
                  <p className="text-xs text-white/60">Update your name, company and address</p>
                </div>
              </div>
              {!profileEditing && profileName && (
                <button
                  onClick={() => { setProfileEditing(true); setProfileMsg(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg hover:opacity-80 transition-all"
                  style={{ color: "#ffffff", background: "rgba(255,255,255,0.15)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.3)" }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  Edit
                </button>
              )}
            </div>
          </div>
          <div className="p-6">
            {profileEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => { setProfileName(e.target.value); setProfileMsg(null); }}
                    placeholder="Enter your full name"
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(105,98,196,0.3)] focus:border-[#6962c4] focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Company Name <span className="text-gray-400 normal-case font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={profileCompany}
                    onChange={(e) => { setProfileCompany(e.target.value); setProfileMsg(null); }}
                    placeholder="e.g. Inertia Leads"
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(105,98,196,0.3)] focus:border-[#6962c4] focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Business Address <span className="text-red-500">*</span></label>
                  <textarea
                    value={profileAddress}
                    onChange={(e) => { setProfileAddress(e.target.value); setProfileMsg(null); }}
                    placeholder="e.g. 123 Example Street, Suite 400, Austin, TX 78701"
                    rows={2}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(105,98,196,0.3)] focus:border-[#6962c4] focus:bg-white transition-all resize-none"
                  />
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={saveProfile}
                    disabled={profileSaving || !profileName.trim() || !profileAddress.trim()}
                    className="px-5 py-2.5 text-sm font-medium text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all hover:opacity-90"
                    style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)", boxShadow: "0 2px 8px rgba(105,98,196,0.3)" }}
                  >
                    {profileSaving ? "Saving..." : "Save Profile"}
                  </button>
                  {profileName.trim() && profileAddress.trim() && (
                    <button
                      onClick={() => { setProfileEditing(false); setProfileMsg(null); }}
                      className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  {profileMsg && (
                    <span className={`text-sm font-medium ${profileMsg.type === "success" ? "text-emerald-600" : "text-red-500"}`}>
                      {profileMsg.type === "success" ? "✓ " : ""}{profileMsg.text}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              (() => {
                // Inbox completion is proportional to how many of the plan's
                // inbox slots are connected (e.g. 1/4 = 25%, not "done"), so the
                // overall % only reaches 100 when every slot is filled — not on
                // the very first inbox.
                const inboxFraction = maxInboxes > 0 ? Math.min(1, totalInboxes / maxInboxes) : (totalInboxes > 0 ? 1 : 0);
                const checks = [
                  { label: "Name", done: !!profileName.trim() },
                  { label: "Address", done: !!profileAddress.trim() },
                  { label: "Avatar", done: !!profileAvatarUrl },
                  { label: `Inbox (${totalInboxes}/${maxInboxes})`, done: maxInboxes > 0 && totalInboxes >= maxInboxes },
                ];
                // Name/Address/Avatar are binary; Inbox contributes its fraction.
                const binaryDone = checks.slice(0, 3).filter(c => c.done).length;
                const pct = Math.round(((binaryDone + inboxFraction) / checks.length) * 100);
                return (
                  <div className="flex gap-5">
                    {/* Left: profile info */}
                    <div className="flex-1 space-y-4 min-w-0">
                      <div>
                        <p className="text-lg font-bold text-gray-900">{profileName}</p>
                        {profileCompany && (
                          <p className="text-sm font-medium text-gray-700 mt-0.5">{profileCompany}</p>
                        )}
                      </div>
                      <div className="border-t pt-3 grid grid-cols-1 gap-2.5" style={{ borderColor: "rgba(105,98,196,0.12)" }}>
                        {profileAddress && (
                          <div className="flex items-center gap-2.5 text-sm">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(105,98,196,0.1)" }}>
                              <svg className="w-4 h-4" style={{ color: "#6962c4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </div>
                            <span className="text-gray-600">{profileAddress}</span>
                          </div>
                        )}
                        {profileEmail && (
                          <div className="flex items-center gap-2.5 text-sm">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(105,98,196,0.1)" }}>
                              <svg className="w-4 h-4" style={{ color: "#6962c4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <span className="text-gray-600 truncate">{profileEmail}</span>
                          </div>
                        )}
                        {memberSince && (
                          <div className="flex items-center gap-2.5 text-sm">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(105,98,196,0.1)" }}>
                              <svg className="w-4 h-4" style={{ color: "#6962c4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <span className="text-gray-600">Member since {memberSince}</span>
                          </div>
                        )}
                      </div>
                      {profileMsg && (
                        <span className={`text-sm font-medium ${profileMsg.type === "success" ? "text-emerald-600" : "text-red-500"}`}>
                          {profileMsg.type === "success" ? "✓ " : ""}{profileMsg.text}
                        </span>
                      )}
                    </div>

                    {/* Right: vertical progress bar with checklist on left */}
                    <div className="flex items-stretch gap-3 pl-4 border-l" style={{ borderColor: "rgba(105,98,196,0.12)" }}>
                      <div className="flex flex-col justify-center gap-3">
                        {checks.map(c => (
                          <div key={c.label} className="flex items-center gap-1.5" title={c.label}>
                            {c.done ? (
                              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                            ) : (
                              <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />
                            )}
                            <span className={`text-[11px] ${c.done ? "text-gray-600" : "text-gray-400"}`}>{c.label}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-sm font-bold" style={{ color: pct === 100 ? "#10b981" : "#6962c4" }}>{pct}%</span>
                        <div className="relative w-3 flex-1 min-h-[100px] rounded-full bg-gray-200 overflow-hidden">
                          <div
                            className="absolute bottom-0 w-full rounded-full transition-all duration-700"
                            style={{ height: `${pct}%`, background: pct === 100 ? "linear-gradient(to top, #10b981, #34d399)" : "linear-gradient(to top, #3d3580, #6962c4, #a78bfa)" }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>

        {/* Change Password Card */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
          <div className="px-6 py-4 border-b" style={{ background: "#2f276c", borderColor: "#2f276c" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Security</h2>
                <p className="text-xs text-white/60">Update your password</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPasswordMsg(null); }}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(105,98,196,0.3)] focus:border-[#6962c4] focus:bg-white transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setPasswordMsg(null); }}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(105,98,196,0.3)] focus:border-[#6962c4] focus:bg-white transition-all"
              />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={changePassword}
                disabled={passwordSaving || !newPassword || !confirmPassword}
                className="px-5 py-2.5 text-sm font-medium text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)", boxShadow: "0 2px 8px rgba(105,98,196,0.3)" }}
              >
                {passwordSaving ? "Changing..." : "Change Password"}
              </button>
              {passwordMsg && (
                <span className={`text-sm font-medium ${passwordMsg.type === "success" ? "text-emerald-600" : "text-red-500"}`}>
                  {passwordMsg.type === "success" ? "✓ " : ""}{passwordMsg.text}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Billing & Plans Card */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
          <div className="px-6 py-4 border-b" style={{ background: "#2f276c", borderColor: "#2f276c" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Billing & Plans</h2>
                <p className="text-xs text-white/60">Manage your subscription</p>
              </div>
            </div>
          </div>
          <div className="p-6 flex flex-col justify-between" style={{ minHeight: "240px" }}>
            {serviceTypeLoading ? (
              /* Loading skeleton while subscription status is fetched */
              <div className="flex flex-col h-full justify-between animate-pulse">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-7 w-28 rounded-full bg-gray-200" />
                    <div className="h-6 w-16 rounded-full bg-gray-200" />
                  </div>
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                    <div className="h-8 w-20 rounded bg-gray-200" />
                    <div className="h-4 w-24 rounded bg-gray-200" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="h-16 rounded-xl bg-gray-100" />
                    <div className="h-16 rounded-xl bg-gray-100" />
                    <div className="h-16 rounded-xl bg-gray-100" />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <div className="flex-1 h-10 rounded-lg bg-gray-200" />
                  <div className="flex-1 h-10 rounded-lg bg-gray-200" />
                </div>
              </div>
            ) : billingError ? (
              /* Couldn't load subscription — show a retry, NOT fabricated default plan data */
              <div className="flex flex-col h-full items-center justify-center text-center py-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(239,68,68,0.08)" }}>
                  <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                </div>
                <p className="text-sm font-semibold text-gray-800">Couldn&apos;t load your plan</p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs">We couldn&apos;t reach the server (it may be busy). Your plan is safe — this is just a display issue.</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-4 px-5 py-2 text-xs font-bold rounded-lg text-white transition-all hover:scale-[1.02]"
                  style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}
                >
                  Retry
                </button>
              </div>
            ) : !hasPlan && !isExpired && !isPaused ? (
              /* New user - no plan selected */
              <div className="flex flex-col h-full justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="px-2.5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 flex items-center justify-center leading-none">
                      No Active Plan
                    </div>
                    <div className="flex items-center gap-1">
                      <svg className="w-3 h-3 text-amber-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                      <span className="text-[10px] text-amber-600 font-medium">Action needed</span>
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-gray-900 mb-1">Get started with a plan</h3>
                  <p className="text-[11px] text-gray-400 mb-3">Unlock AI lead generation with a <span className="text-emerald-600 font-bold">7-day free trial</span> — no charges until day 8.</p>

                  {/* Trial timeline */}
                  <div className="rounded-lg p-3 border border-[#e8e6f5] relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(105,98,196,0.04) 0%, rgba(61,53,128,0.06) 100%)" }}>
                    <div className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-30" style={{ background: "radial-gradient(circle, rgba(105,98,196,0.3) 0%, transparent 70%)", transform: "translate(30%, -30%)" }} />
                    <p className="text-[10px] font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                      <svg className="w-3 h-3" style={{ color: "#6962c4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      How your trial works
                    </p>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0" style={{ background: "#6962c4" }}>1</div>
                        <p className="text-[10px] text-gray-600"><span className="font-semibold text-gray-800">Day 1–7:</span> Full access, zero charges</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0" style={{ background: "#6962c4" }}>2</div>
                        <p className="text-[10px] text-gray-600"><span className="font-semibold text-gray-800">Day 8:</span> First payment from your card</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0" style={{ background: "#6962c4" }}>3</div>
                        <p className="text-[10px] text-gray-600"><span className="font-semibold text-gray-800">Monthly:</span> Auto-renews, cancel anytime</p>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowPricingModal(true)}
                  className="w-full py-2.5 text-sm font-bold rounded-lg text-white transition-all hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] mt-3"
                  style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 50%, #8b7fd4 100%)" }}
                >
                  Select a Plan & Start Free Trial
                </button>
              </div>
            ) : isExpired ? (
              /* Expired plan - needs renewal */
              <div className="flex flex-col h-full justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="px-2.5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-50 border border-red-200 flex items-center justify-center leading-none">
                      {isTrialExpired ? "Trial Ended" : "Plan Expired"}
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-[10px] font-semibold text-red-700">Inactive</span>
                    </div>
                  </div>

                  {/* Previous plan info */}
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
                    <div>
                      <p className="text-[10px] text-gray-400 mb-0.5">{isTrialExpired ? "Trial plan" : "Previous plan"}</p>
                      <span className="text-sm font-bold text-gray-900 capitalize">{plan}</span>
                      <span className="text-xs text-gray-400 ml-1.5">
                        {plan === "starter" ? "$39" : plan === "growth" ? "$79" : "$129"}/mo
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-gray-400">{isTrialExpired ? "Trial ended" : "Expired on"}</p>
                      <p className="text-xs font-semibold text-red-600">{effectivePeriodEnd ? effectivePeriodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
                    </div>
                  </div>

                  {/* Warning box */}
                  <div className="rounded-lg p-3 border border-red-100 relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.04) 0%, rgba(185,28,28,0.06) 100%)" }}>
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <div>
                        <p className="text-[11px] font-bold text-gray-800 mb-1">{isTrialExpired ? "Your free trial has ended" : "Your access has been paused"}</p>
                        <p className="text-[10px] text-gray-500 leading-relaxed">{isTrialExpired ? "Lead generation, email campaigns, and AI features are locked. Choose a plan to unlock everything and pick up where you left off." : "Lead generation, email campaigns, and AI features are disabled. Renew now to resume where you left off."}</p>
                      </div>
                    </div>
                  </div>

                  {/* What you lose */}
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                      <span className="text-[10px] text-gray-500">Leads</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                      <span className="text-[10px] text-gray-500">Emails</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                      <span className="text-[10px] text-gray-500">AI</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                      <span className="text-[10px] text-gray-500">Campaigns</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowPricingModal(true)}
                  className="w-full py-2.5 text-sm font-bold rounded-lg text-white transition-all hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] mt-3"
                  style={{ background: "linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #f87171 100%)" }}
                >
                  {isTrialExpired ? "Choose Your Plan" : "Renew Plan"}
                </button>
              </div>
            ) : isPaused ? (
              /* Paused subscription */
              <div className="flex flex-col h-full justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="px-2.5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-200 flex items-center justify-center leading-none">
                      Plan Paused
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-[10px] font-semibold text-blue-700">Paused</span>
                    </div>
                  </div>

                  {/* Paused info */}
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
                    <div>
                      <p className="text-[10px] text-gray-400 mb-0.5">Current plan</p>
                      <span className="text-sm font-bold text-gray-900 capitalize">{plan}</span>
                      <span className="text-xs text-gray-400 ml-1.5">
                        {plan === "starter" ? "$39" : plan === "growth" ? "$79" : "$129"}/mo
                      </span>
                    </div>
                  </div>

                  {/* Warning box */}
                  <div className="rounded-lg p-3 border border-blue-100 relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.04) 0%, rgba(37,99,235,0.06) 100%)" }}>
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="text-[11px] font-bold text-gray-800 mb-1">Your subscription is paused</p>
                        <p className="text-[10px] text-gray-500 leading-relaxed">All features are disabled while paused. Resume your plan to continue using leads, emails, and AI.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowPricingModal(true)}
                  className="w-full py-2.5 text-sm font-bold rounded-lg text-white transition-all hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] mt-3"
                  style={{ background: "linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)" }}
                >
                  Resume Plan
                </button>
              </div>
            ) : (
              /* Existing user - active plan or cancelling */
              <div className="flex flex-col h-full justify-between">
                <div>
                  {/* Plan name & badge */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="px-3 py-1.5 rounded-full text-xs font-bold text-white uppercase tracking-wider" style={{ background: plan === "starter" ? "#6962c4" : plan === "growth" ? "#059669" : "#d97706" }}>
                      {plan} Plan
                    </div>
                    {isCancelling ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-50 border border-orange-200">
                        <div className="w-2 h-2 rounded-full bg-orange-500" />
                        <span className="text-xs font-semibold text-orange-700">Cancelling</span>
                      </div>
                    ) : isPastDue ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-xs font-semibold text-red-700">Past Due</span>
                      </div>
                    ) : isOnTrial ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200">
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        <span className="text-xs font-semibold text-amber-700">Trial{trialDaysLeft !== null ? ` · ${trialDaysLeft}d left` : ""}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-xs font-semibold text-emerald-700">Active</span>
                      </div>
                    )}
                  </div>

                  {/* Cancelling warning banner */}
                  {isCancelling && periodEndDate && (
                    <div className="rounded-lg p-3 mb-3 border border-orange-200" style={{ background: "linear-gradient(135deg, rgba(251,146,60,0.06) 0%, rgba(234,88,12,0.08) 100%)" }}>
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="text-[11px] font-bold text-gray-800">Your plan ends on {new Date(periodEndDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">You still have full access until then. Reactivate to keep your plan.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Past due warning banner */}
                  {isPastDue && (
                    <div className="rounded-lg p-3 mb-3 border border-red-200" style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.04) 0%, rgba(185,28,28,0.06) 100%)" }}>
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <div>
                          <p className="text-[11px] font-bold text-gray-800">Payment failed</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">Please update your payment method within 3 days to avoid losing access.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Price & dates */}
                  {isOnTrial ? (
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                      <div>
                        <span className="text-2xl font-extrabold text-gray-900">Free Trial</span>
                        <span className="text-xs text-gray-400 ml-1">Growth features</span>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-gray-400">Days left: <span className="text-amber-600 font-semibold">{trialDaysLeft ?? "—"}</span></p>
                        <p className="text-[10px] text-gray-400">Then <span className="text-gray-600 font-medium">$79/mo</span> when you choose a plan</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                      <div>
                        <span className="text-2xl font-extrabold text-gray-900">
                          {plan === "starter" ? "$39" : plan === "growth" ? "$79" : "$129"}
                        </span>
                        <span className="text-xs text-gray-400 ml-1">per month</span>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-gray-400">Purchased: <span className="text-gray-600 font-medium">{periodStartDate ? new Date(periodStartDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</span></p>
                        <p className="text-[10px] text-gray-400">{isCancelling ? "Ends" : "Expires"}: <span className={`font-medium ${isCancelling ? "text-orange-600" : "text-gray-600"}`}>{effectivePeriodEnd ? effectivePeriodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</span></p>
                      </div>
                    </div>
                  )}

                  {/* Limits boxes */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl p-3 text-center border-2 border-[#e8e6f5]" style={{ background: "rgba(105,98,196,0.06)" }}>
                      <p className="text-lg font-bold" style={{ color: "#3d3580" }}>
                        {isOnTrial ? "20" : plan === "starter" ? "50" : plan === "growth" ? "100" : "200"}
                      </p>
                      <p className="text-[10px] text-gray-500 font-medium mt-0.5">Leads/day</p>
                    </div>
                    <div className="rounded-xl p-3 text-center border-2 border-[#e8e6f5]" style={{ background: "rgba(105,98,196,0.06)" }}>
                      <p className="text-lg font-bold" style={{ color: "#3d3580" }}>
                        {plan === "starter" ? "1" : plan === "growth" ? "3" : "5"}
                      </p>
                      <p className="text-[10px] text-gray-500 font-medium mt-0.5">Inboxes</p>
                    </div>
                    <div className="rounded-xl p-3 text-center border-2 border-[#e8e6f5]" style={{ background: "rgba(105,98,196,0.06)" }}>
                      <p className="text-lg font-bold" style={{ color: "#3d3580" }}>
                        {isOnTrial ? "20" : plan === "starter" ? "50" : plan === "growth" ? "100" : "200"}
                      </p>
                      <p className="text-[10px] text-gray-500 font-medium mt-0.5">Emails/day</p>
                    </div>
                  </div>
                </div>

                {isCancelling ? (
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={async () => {
                        setReactivating(true);
                        try {
                          await apiPost("/billing/reactivate", {});
                          setIsCancelling(false);
                          toast.addToast("Plan reactivated! Your subscription will continue.", "success");
                        } catch {
                          toast.addToast("Failed to reactivate. Please try again.", "error");
                        } finally {
                          setReactivating(false);
                        }
                      }}
                      disabled={reactivating}
                      className="flex-1 py-2.5 text-xs font-semibold rounded-lg text-white transition-all hover:opacity-90 hover:shadow-md disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #059669 0%, #10b981 100%)" }}
                    >
                      {reactivating ? "Reactivating..." : "Reactivate Plan"}
                    </button>
                    <button
                      onClick={() => setShowPricingModal(true)}
                      className="flex-1 py-2.5 text-xs font-semibold rounded-lg text-gray-600 border border-gray-200 hover:bg-gray-50 transition-all"
                    >
                      Change Plan
                    </button>
                  </div>
                ) : isOnTrial ? (
                  /* Free trial — single upgrade CTA, always enabled. No "cancel" (there's no card/subscription yet). */
                  <div className="mt-4">
                    <button
                      onClick={() => setShowPricingModal(true)}
                      className="w-full py-2.5 text-sm font-bold rounded-lg text-white transition-all hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]"
                      style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 50%, #8b7fd4 100%)" }}
                    >
                      See Plans — Upgrade Anytime
                    </button>
                    <p className="text-[10px] text-gray-400 text-center mt-2">You&apos;re only charged when you choose a plan. Cancel anytime.</p>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => setShowPricingModal(true)}
                      className="flex-1 py-2.5 text-xs font-semibold rounded-lg text-white transition-all hover:opacity-90 hover:shadow-md"
                      style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}
                    >
                      {plan === "starter" ? "Upgrade Plan" : "Manage Subscription"}
                    </button>

                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="flex-1 py-2.5 text-xs font-semibold rounded-lg text-red-500 border border-red-200 hover:bg-red-50 transition-all"
                    >
                      Cancel Plan
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Pricing Modal */}
        {showPricingModal && (
          <PricingModal plan={plan} hasPlan={hasPlan} isExpired={isExpired} isPastDue={isPastDue} isOnTrial={isOnTrial} onClose={() => setShowPricingModal(false)} onToast={toast.addToast} />
        )}

        {/* Cancel Plan Modal */}
        {showCancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !cancelling && setShowCancelModal(false)} />
            <div className="relative z-10 w-full max-w-md rounded-2xl p-6" style={{ background: "linear-gradient(135deg, #1a1540 0%, #0d0a25 100%)", border: "1px solid rgba(105,98,196,0.3)", boxShadow: "0 20px 60px rgba(13,10,37,0.6)" }}>
              {/* Warning icon */}
              <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(239,68,68,0.12)" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>

              <h3 className="text-lg font-bold text-white text-center mb-2">Cancel Your Plan?</h3>
              <p className="text-sm text-gray-400 text-center mb-5">
                You&apos;ll lose access to these features at the end of your billing period:
              </p>

              {/* Features they'll lose */}
              <div className="rounded-xl p-3 mb-5" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                <div className="space-y-2">
                  {["Auto Lead Finder", "Email Campaigns", "Hot Lead Tracking", "CSV Upload", "Audit Reports"].map((feature) => (
                    <div key={feature} className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      <span className="text-xs text-gray-300">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Reason selection */}
              <div className="mb-5">
                <label className="text-xs font-medium text-gray-400 mb-2 block">Why are you cancelling? <span className="text-red-400">*</span></label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-xs border focus:outline-none focus:border-[#6962c4] transition-colors appearance-none"
                  style={{ background: "#0d0a25", borderColor: "rgba(105,98,196,0.4)", color: cancelReason ? "#ffffff" : "#9ca3af", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                >
                  <option value="" style={{ background: "#0d0a25", color: "#9ca3af" }}>Select a reason...</option>
                  <option value="too_expensive" style={{ background: "#0d0a25", color: "#ffffff" }}>Too expensive</option>
                  <option value="not_using" style={{ background: "#0d0a25", color: "#ffffff" }}>Not using it enough</option>
                  <option value="missing_features" style={{ background: "#0d0a25", color: "#ffffff" }}>Missing features I need</option>
                  <option value="switching" style={{ background: "#0d0a25", color: "#ffffff" }}>Switching to another tool</option>
                  <option value="temporary" style={{ background: "#0d0a25", color: "#ffffff" }}>Just need a break</option>
                  <option value="other" style={{ background: "#0d0a25", color: "#ffffff" }}>Other</option>
                </select>
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowCancelModal(false); setCancelReason(""); }}
                  disabled={cancelling}
                  className="flex-1 py-2.5 text-xs font-semibold rounded-xl text-white transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #6962c4 0%, #3d3580 100%)" }}
                >
                  Keep My Plan
                </button>
                <button
                  onClick={async () => {
                    if (!cancelReason) {
                      toast.addToast("Please select a reason for cancelling.", "error");
                      return;
                    }
                    setCancelling(true);
                    try {
                      await apiPost("/billing/cancel", { reason: cancelReason });
                      toast.addToast("Plan cancelled. You'll keep access until your billing period ends.", "success");
                      setShowCancelModal(false);
                      setCancelReason("");
                      setTimeout(() => window.location.reload(), 1500);
                    } catch {
                      toast.addToast("Failed to cancel plan. Please try again.", "error");
                    } finally {
                      setCancelling(false);
                    }
                  }}
                  disabled={cancelling || !cancelReason}
                  className="flex-1 py-2.5 text-xs font-semibold rounded-xl text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cancelling ? "Cancelling..." : "Cancel Plan"}
                </button>
              </div>

              <p className="text-[10px] text-gray-500 text-center mt-4">
                You&apos;ll keep full access until the end of your current billing period.
              </p>
            </div>
          </div>
        )}

        {/* Gmail Card */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
          <div className="px-6 py-4 border-b" style={{ background: "#2f276c", borderColor: "#2f276c" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 18h-2V9.25L12 13 6 9.25V18H4V6h1.2l6.8 4.25L18.8 6H20m0-2H4c-1.11 0-2 .89-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Gmail</h2>
                  <p className="text-xs text-white/60">{gmailAccounts.length} connected</p>
                </div>
              </div>
              {totalInboxes < maxInboxes && (
                <button
                  onClick={addGmailInbox}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all shadow-sm"
                  style={{ color: "#ffffff", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)" }}
                >
                  + Connect
                </button>
              )}
            </div>
          </div>
          <div className="p-6" style={{ minHeight: "240px" }}>
            {loading ? (
              <SettingsAccountSkeleton />
            ) : gmailAccounts.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(105,98,196,0.08)" }}>
                  <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">No Gmail accounts connected</p>
                <p className="text-xs text-gray-400 mt-1">Connect one to start sending emails</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {gmailAccounts.map((account) => {
                  const warmup = getWarmupStatus(account.warmup_started_at);
                  return (
                    <div key={account.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100 hover:border-gray-200 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}>
                          <span className="text-white text-xs font-bold">{account.email[0].toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 truncate">{account.email}</span>
                            {account.is_primary && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "#3d3580", color: "#ffffff" }}>PRIMARY</span>
                            )}
                          </div>
                          <span className={`text-xs ${warmup.color === "green" ? "text-emerald-600" : "text-amber-600"}`}>
                            {warmup.color === "green" ? "✓ " : "⏳ "}{warmup.label}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!account.is_primary && (
                          <button
                            onClick={() => removeGmailInbox(account.id)}
                            disabled={removing === account.id}
                            className="text-xs text-gray-400 hover:text-red-500 font-medium disabled:opacity-50 transition-colors"
                          >
                            {removing === account.id ? "..." : "Remove"}
                          </button>
                        )}
                        {account.is_primary && (
                          <button
                            onClick={() => reconnectGmail(account.id)}
                            disabled={removing === account.id}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 transition-all hover:opacity-80"
                            style={{ color: "#3d3580", background: "rgba(105,98,196,0.1)", border: "1px solid rgba(105,98,196,0.25)" }}
                          >
                            {removing === account.id ? "Reconnecting..." : "↻ Reconnect"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* SMTP Card */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid rgba(47,39,108,0.4)" }}>
          <div className="px-6 py-4 border-b" style={{ background: "#2f276c", borderColor: "#2f276c" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">SMTP / Other</h2>
                  <p className="text-xs text-white/60">{smtpAccounts.length} connected</p>
                </div>
              </div>
              {!showSmtpForm && totalInboxes < maxInboxes && (
                <button
                  onClick={() => { setShowSmtpForm(true); setSmtpProvider(""); setSmtpError(""); setSmtpSuccess(""); }}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all shadow-sm"
                  style={{ color: "#ffffff", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)" }}
                >
                  + Connect
                </button>
              )}
            </div>
          </div>
          <div className="p-6">
            {loading ? (
              <SettingsAccountSkeleton />
            ) : showSmtpForm ? (
              <div className="space-y-3">
                {!smtpProvider ? (
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Select provider</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.entries(SMTP_PRESETS) as [SmtpProvider, typeof SMTP_PRESETS[SmtpProvider]][]).map(([key, preset]) => (
                        <button
                          key={key}
                          onClick={() => selectProvider(key)}
                          className={`p-3 text-left text-sm font-medium rounded-xl border-2 transition-all hover:shadow-sm ${
                            key === "custom"
                              ? "col-span-2 border-dashed border-gray-200 bg-gray-50 text-gray-600"
                              : "border-gray-100 bg-white text-gray-800"
                          }`}
                          style={{ ...(key !== "custom" ? {} : {})} }
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(105,98,196,0.4)"; e.currentTarget.style.background = "rgba(105,98,196,0.04)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.background = ""; }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => { setShowSmtpForm(false); setSmtpError(""); setSmtpSuccess(""); }}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ background: "rgba(105,98,196,0.12)", color: "#3d3580" }}>
                        {SMTP_PRESETS[smtpProvider].label}
                      </span>
                      <button
                        onClick={() => { setSmtpProvider(""); setSmtpForm({ ...smtpForm, host: "", port: "587", useTls: true }); }}
                        className="text-xs font-medium transition-colors" style={{ color: "#6962c4" }}
                      >
                        Change
                      </button>
                    </div>
                    <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-100">
                      💡 {SMTP_PRESETS[smtpProvider].helpText}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
                        <input
                          type="email"
                          value={smtpForm.email}
                          onChange={(e) => setSmtpForm({ ...smtpForm, email: e.target.value, username: e.target.value })}
                          placeholder="you@example.com"
                          className="w-full px-3.5 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 focus:bg-white transition-all"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                          {smtpProvider === "custom" ? "Password" : "App Password"}
                        </label>
                        <input
                          type="password"
                          value={smtpForm.password}
                          onChange={(e) => setSmtpForm({ ...smtpForm, password: e.target.value })}
                          placeholder="••••••••"
                          className="w-full px-3.5 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 focus:bg-white transition-all"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Display Name</label>
                        <input
                          type="text"
                          value={smtpForm.displayName}
                          onChange={(e) => setSmtpForm({ ...smtpForm, displayName: e.target.value })}
                          placeholder="John Smith (optional)"
                          className="w-full px-3.5 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 focus:bg-white transition-all"
                        />
                      </div>
                      {smtpProvider === "custom" && (
                        <>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">SMTP Host</label>
                            <input
                              type="text"
                              value={smtpForm.host}
                              onChange={(e) => setSmtpForm({ ...smtpForm, host: e.target.value })}
                              placeholder="smtp.yourdomain.com"
                              className="w-full px-3.5 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 focus:bg-white transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Port</label>
                            <input
                              type="number"
                              value={smtpForm.port}
                              onChange={(e) => setSmtpForm({ ...smtpForm, port: e.target.value })}
                              placeholder="587"
                              className="w-full px-3.5 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 focus:bg-white transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Username</label>
                            <input
                              type="text"
                              value={smtpForm.username}
                              onChange={(e) => setSmtpForm({ ...smtpForm, username: e.target.value })}
                              placeholder="you@yourdomain.com"
                              className="w-full px-3.5 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 focus:bg-white transition-all"
                            />
                          </div>
                          <div className="flex items-end">
                            <label className="flex items-center gap-2 pb-2.5">
                              <input
                                type="checkbox"
                                checked={smtpForm.useTls}
                                onChange={(e) => setSmtpForm({ ...smtpForm, useTls: e.target.checked })}
                                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                              />
                              <span className="text-xs text-gray-600">Use TLS/SSL</span>
                            </label>
                          </div>
                        </>
                      )}
                    </div>
                    {smtpError && (
                      <div className="text-xs text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">{smtpError}</div>
                    )}
                    {smtpSuccess && (
                      <div className="text-xs text-emerald-600 bg-emerald-50 p-3 rounded-xl border border-emerald-100">✓ {smtpSuccess}</div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={testSmtpConnection}
                        disabled={smtpTesting || !smtpForm.email || !smtpForm.host || !smtpForm.password}
                        className="px-4 py-2 text-xs font-medium rounded-xl transition-colors disabled:opacity-50"
                        style={{ color: "#3d3580", background: "rgba(105,98,196,0.08)", border: "1px solid rgba(105,98,196,0.25)" }}
                      >
                        {smtpTesting ? "Testing..." : "Test Connection"}
                      </button>
                      <button
                        onClick={saveSmtpAccount}
                        disabled={smtpSaving || !smtpForm.email || !smtpForm.host || !smtpForm.password}
                        className="px-4 py-2 text-xs font-medium text-white rounded-xl transition-all disabled:opacity-50 shadow-sm"
                        style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}
                      >
                        {smtpSaving ? "Saving..." : "Save Account"}
                      </button>
                      <button
                        onClick={() => { setShowSmtpForm(false); setSmtpProvider(""); setSmtpError(""); setSmtpSuccess(""); }}
                        className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : smtpAccounts.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(105,98,196,0.08)" }}>
                  <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">No SMTP accounts connected</p>
                <p className="text-xs text-gray-400 mt-1">Outlook, Yahoo, Zoho, or custom SMTP</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {smtpAccounts.map((account) => {
                  const warmup = getWarmupStatus(account.warmup_started_at);
                  return (
                    <div key={account.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100 hover:border-gray-200 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}>
                          <span className="text-white text-xs font-bold">{account.email[0].toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 truncate">{account.email}</span>
                            {account.is_primary && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "#3d3580", color: "#ffffff" }}>PRIMARY</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-400">{account.host}:{account.port}</span>
                            <span className="text-gray-300">·</span>
                            <span className={`text-xs ${warmup.color === "green" ? "text-emerald-600" : "text-amber-600"}`}>
                              {warmup.color === "green" ? "✓ " : "⏳ "}{warmup.label}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeSmtpInbox(account.id)}
                        disabled={removing === account.id}
                        className="text-xs text-gray-400 hover:text-red-500 font-medium disabled:opacity-50 transition-colors"
                      >
                        {removing === account.id ? "..." : "Remove"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {totalInboxes >= maxInboxes && maxInboxes < 4 && (
              <p className="mt-4 text-xs text-gray-400 text-center">
                Upgrade your plan to connect more inboxes
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
