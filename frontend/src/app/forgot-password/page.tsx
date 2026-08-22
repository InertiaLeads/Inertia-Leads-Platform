"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    setSent(true);
  };

  if (sent) {
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #0d0a25 100%)" }}>
        <div className="absolute inset-0 opacity-[0.06]">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="dots1" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="1" fill="white" /></pattern></defs><rect width="100%" height="100%" fill="url(#dots1)" /></svg>
        </div>
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl" style={{ background: "rgba(105, 98, 196, 0.12)" }} />
        <div className="absolute bottom-0 right-0 w-72 h-72 rounded-full blur-3xl" style={{ background: "rgba(61, 53, 128, 0.10)" }} />
        <div className="relative z-10 max-w-md w-full p-8 rounded-2xl border text-center" style={{ background: "rgba(26, 21, 64, 0.6)", borderColor: "rgba(255,255,255,0.08)", backdropFilter: "blur(20px)" }}>
          <div className="text-5xl mb-4">📧</div>
          <h2 className="text-2xl font-bold text-white">Check your email</h2>
          <p className="mt-3 text-white/60 text-sm">
            We sent a password reset link to <span className="font-medium text-white">{email}</span>.
            Click the link in your email to set a new password.
          </p>
          <p className="mt-4 text-xs text-white/40">
            Didn&apos;t receive the email? Check your spam folder.
          </p>
          <div className="mt-6 flex gap-3 justify-center">
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              className="px-4 py-2 text-sm font-medium text-white/70 border rounded-lg hover:text-white hover:border-white/30 transition-colors" style={{ borderColor: "rgba(255,255,255,0.15)" }}
            >
              Try a different email
            </button>
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #0d0a25 100%)" }}>
      <div className="absolute inset-0 opacity-[0.06]">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="dots2" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="1" fill="white" /></pattern></defs><rect width="100%" height="100%" fill="url(#dots2)" /></svg>
      </div>
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl" style={{ background: "rgba(105, 98, 196, 0.12)" }} />
      <div className="absolute bottom-0 right-0 w-72 h-72 rounded-full blur-3xl" style={{ background: "rgba(61, 53, 128, 0.10)" }} />
      <div className="dark-inputs relative z-10 max-w-md w-full space-y-8 p-8 rounded-2xl border" style={{ background: "rgba(26, 21, 64, 0.6)", borderColor: "rgba(255,255,255,0.08)", backdropFilter: "blur(20px)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5), 0 0 40px rgba(99,102,241,0.08)" }}>
        <div>
          <h2 className="text-center text-3xl font-bold text-white">
            Reset your password
          </h2>
          <p className="mt-2 text-center text-sm text-white/60">
            Enter your email and we&apos;ll send you a reset link
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="border text-sm px-4 py-3 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)", color: "#fca5a5" }}>
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-white/70">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-colors"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#ffffff" }}
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>

          <p className="text-center text-sm text-white/50">
            Remember your password?{" "}
            <Link href="/login" className="font-medium text-violet-400 hover:text-violet-300 transition-colors">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
