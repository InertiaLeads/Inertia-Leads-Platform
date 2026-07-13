"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const router = useRouter();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const getSupabase = () => {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  };

  const resetForm = () => {
    setError("");
    setFullName("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const switchMode = (newMode: "login" | "signup") => {
    resetForm();
    setMode(newMode);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await getSupabase().auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/");
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    const { error } = await getSupabase().auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    setEmailSent(true);
  };

  const handleGoogleAuth = async () => {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
    if (error) setError(error.message);
  };

  return (
    <div className="h-screen relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d0a25 0%, #1a1540 50%, #0d0a25 100%)" }}>
      <div className="absolute inset-0 opacity-[0.06]">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="loginDots2" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="1" fill="white" /></pattern></defs><rect width="100%" height="100%" fill="url(#loginDots2)" /></svg>
      </div>
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl" style={{ background: "rgba(105, 98, 196, 0.12)" }} />
      <div className="absolute top-1/3 right-[10%] w-72 h-72 rounded-full blur-3xl" style={{ background: "rgba(61, 53, 128, 0.10)" }} />
      <div className="absolute -bottom-20 left-1/4 w-80 h-80 rounded-full blur-3xl" style={{ background: "rgba(105, 98, 196, 0.08)" }} />
      <div className="absolute bottom-1/3 right-[30%] w-64 h-64 rounded-full blur-3xl" style={{ background: "rgba(61, 53, 128, 0.06)" }} />

      {/* Floating 3D geometric elements on page background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[1]" style={{ perspective: "1200px" }}>
        
        {/* 3D Cube - top left */}
        <div className="absolute top-[38%] left-[2%] w-16 h-16" style={{ transformStyle: "preserve-3d", animation: "slowRotate1 30s linear infinite" }}>
          <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
            {/* Front face */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(105,98,196,0.4), rgba(61,53,128,0.2))", border: "1.5px solid rgba(105,98,196,0.5)", transform: "translateZ(32px)", boxShadow: "inset 0 0 12px rgba(105,98,196,0.25), 0 0 8px rgba(105,98,196,0.15)" }} />
            {/* Back face */}
            <div className="absolute inset-0" style={{ background: "rgba(42,33,88,0.3)", border: "1px solid rgba(105,98,196,0.25)", transform: "translateZ(-32px)" }} />
            {/* Left face */}
            <div className="absolute inset-0" style={{ background: "rgba(61,53,128,0.25)", border: "1px solid rgba(105,98,196,0.3)", transform: "rotateY(-90deg) translateZ(32px)" }} />
            {/* Right face */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(105,98,196,0.3), rgba(42,33,88,0.15))", border: "1px solid rgba(105,98,196,0.35)", transform: "rotateY(90deg) translateZ(32px)" }} />
            {/* Top face */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(105,98,196,0.22))", border: "1px solid rgba(105,98,196,0.4)", transform: "rotateX(90deg) translateZ(32px)" }} />
            {/* Bottom face */}
            <div className="absolute inset-0" style={{ background: "rgba(13,10,37,0.4)", border: "1px solid rgba(105,98,196,0.15)", transform: "rotateX(-90deg) translateZ(32px)" }} />
          </div>
        </div>

        {/* 3D Sphere - top right */}
        <div className="absolute top-[12%] right-[5%] w-12 h-12" style={{ animation: "gentleFloat 8s ease-in-out infinite" }}>
          <div className="w-full h-full rounded-full" style={{ background: "radial-gradient(ellipse at 30% 25%, rgba(255,255,255,0.2), rgba(105,98,196,0.3) 40%, rgba(42,33,88,0.4) 70%, rgba(13,10,37,0.5))", boxShadow: "0 8px 24px rgba(0,0,0,0.3), inset 0 -4px 8px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.1), 0 0 16px rgba(105,98,196,0.2)", border: "1px solid rgba(105,98,196,0.25)" }} />
        </div>

        {/* 3D Cube - bottom right */}
        <div className="absolute bottom-[14%] right-[4%] w-16 h-16" style={{ transformStyle: "preserve-3d", animation: "slowRotate2 35s linear infinite" }}>
          <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
            {/* Front face */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(105,98,196,0.4), rgba(61,53,128,0.2))", border: "1.5px solid rgba(105,98,196,0.5)", transform: "translateZ(32px)", boxShadow: "inset 0 0 12px rgba(105,98,196,0.25), 0 0 8px rgba(105,98,196,0.15)" }} />
            {/* Back face */}
            <div className="absolute inset-0" style={{ background: "rgba(42,33,88,0.3)", border: "1px solid rgba(105,98,196,0.25)", transform: "translateZ(-32px)" }} />
            {/* Left face */}
            <div className="absolute inset-0" style={{ background: "rgba(61,53,128,0.25)", border: "1px solid rgba(105,98,196,0.3)", transform: "rotateY(-90deg) translateZ(32px)" }} />
            {/* Right face */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(105,98,196,0.3), rgba(42,33,88,0.15))", border: "1px solid rgba(105,98,196,0.35)", transform: "rotateY(90deg) translateZ(32px)" }} />
            {/* Top face */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(105,98,196,0.22))", border: "1px solid rgba(105,98,196,0.4)", transform: "rotateX(90deg) translateZ(32px)" }} />
            {/* Bottom face */}
            <div className="absolute inset-0" style={{ background: "rgba(13,10,37,0.4)", border: "1px solid rgba(105,98,196,0.15)", transform: "rotateX(-90deg) translateZ(32px)" }} />
          </div>
        </div>

        {/* Small sphere - bottom left */}
        <div className="absolute bottom-[22%] left-[5%] w-9 h-9" style={{ animation: "gentleFloat 9s ease-in-out infinite 1s" }}>
          <div className="w-full h-full rounded-full" style={{ background: "radial-gradient(ellipse at 35% 30%, rgba(255,255,255,0.15), rgba(105,98,196,0.35) 45%, rgba(26,21,64,0.5))", boxShadow: "0 4px 12px rgba(0,0,0,0.3), inset 0 -3px 6px rgba(0,0,0,0.3), 0 0 10px rgba(105,98,196,0.15)", border: "1px solid rgba(105,98,196,0.25)" }} />
        </div>

        {/* Sphere - right middle */}
        <div className="absolute top-[50%] right-[4%] w-8 h-8" style={{ animation: "gentleFloat 10s ease-in-out infinite 2s" }}>
          <div className="w-full h-full rounded-full" style={{ background: "radial-gradient(ellipse at 30% 25%, rgba(255,255,255,0.18), rgba(105,98,196,0.3) 45%, rgba(26,21,64,0.5))", boxShadow: "0 6px 16px rgba(0,0,0,0.3), inset 0 -3px 6px rgba(0,0,0,0.3), 0 0 12px rgba(105,98,196,0.15)", border: "1px solid rgba(105,98,196,0.25)" }} />
        </div>

        {/* 3D Small cube - top center-left */}
        <div className="absolute top-[6%] left-[14%] w-10 h-10" style={{ transformStyle: "preserve-3d", animation: "slowRotate3 25s linear infinite" }}>
          <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
            {/* Front face */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(105,98,196,0.4), rgba(61,53,128,0.2))", border: "1.5px solid rgba(105,98,196,0.5)", transform: "translateZ(20px)", boxShadow: "inset 0 0 8px rgba(105,98,196,0.25), 0 0 6px rgba(105,98,196,0.15)" }} />
            {/* Back face */}
            <div className="absolute inset-0" style={{ background: "rgba(42,33,88,0.3)", border: "1px solid rgba(105,98,196,0.25)", transform: "translateZ(-20px)" }} />
            {/* Left face */}
            <div className="absolute inset-0" style={{ background: "rgba(61,53,128,0.25)", border: "1px solid rgba(105,98,196,0.3)", transform: "rotateY(-90deg) translateZ(20px)" }} />
            {/* Right face */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(105,98,196,0.3), rgba(42,33,88,0.15))", border: "1px solid rgba(105,98,196,0.35)", transform: "rotateY(90deg) translateZ(20px)" }} />
            {/* Top face */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(105,98,196,0.22))", border: "1px solid rgba(105,98,196,0.4)", transform: "rotateX(90deg) translateZ(20px)" }} />
            {/* Bottom face */}
            <div className="absolute inset-0" style={{ background: "rgba(13,10,37,0.4)", border: "1px solid rgba(105,98,196,0.15)", transform: "rotateX(-90deg) translateZ(20px)" }} />
          </div>
        </div>
      </div>

      <div className="relative z-10 h-full flex items-center justify-center px-6">
        {/* Glass container wrapping both sides — fixed height */}
        <div
          className="relative w-full max-w-5xl h-[680px] rounded-3xl overflow-hidden"
          style={{
            background: "rgba(26,21,64,0.95)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(105,98,196,0.18)",
            boxShadow: "0 12px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(105,98,196,0.12), 0 0 0 1px rgba(105,98,196,0.06)",
          }}
        >
          {/* Top edge highlight for 3D effect */}
          <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          {/* Bottom subtle shadow line */}
          <div className="absolute bottom-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-black/20 to-transparent" />

          <div className="flex flex-col lg:flex-row items-stretch h-full">
            {/* Left - Branding */}
            <div className="hidden lg:flex flex-1 flex-col justify-center px-12 py-10 border-r border-white/[0.06]">
              <div className="text-white">
                <BrandingSide />
              </div>
            </div>

            {/* Right - Auth Card */}
            <div className="w-full lg:w-[400px] flex-shrink-0 relative h-full overflow-y-auto scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {/* Inner glow on right panel */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none rounded-r-3xl" />
              <div className="relative z-10 px-8 py-8 min-h-full flex flex-col justify-center">
                {/* Inner glass card for auth form */}
                <div className="dark-inputs rounded-2xl border border-white/[0.08] p-6" style={{ background: "rgba(255,255,255,0.04)" }}>
          {/* Mobile logo - only shows on small screens */}
          <div className="lg:hidden text-center mb-6">
            <img src="/images/logo-3.png" alt="Inertia Leads" className="h-14 mx-auto" />
          </div>

          {emailSent ? (
          /* Verification email sent — rendered inside the SAME card/background as the auth form */
          <div className="text-center py-2">
            <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.35))", boxShadow: "0 0 16px rgba(139,92,246,0.2)" }}>
              <svg className="w-8 h-8" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white">Check your email</h2>
            <p className="mt-3 text-white/60 text-sm leading-relaxed">
              We sent a verification link to <span className="font-medium text-white">{email}</span>. Click the link to verify your account.
            </p>
            <p className="mt-4 text-xs text-white/30">
              Didn&apos;t receive it? Check your spam folder.
            </p>
            <div className="mt-6 space-y-3">
              <button
                onClick={() => { setEmailSent(false); resetForm(); setMode("login"); }}
                className="w-full py-3 px-4 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg, #8b84e0, #6962c4)", boxShadow: "0 4px 16px rgba(105,98,196,0.4)" }}
              >
                Go to Sign In
              </button>
              <button
                onClick={() => { setEmailSent(false); resetForm(); }}
                className="w-full py-2.5 px-4 text-sm font-medium text-white/70 bg-white/[0.06] border border-white/[0.12] rounded-xl hover:bg-white/[0.10] transition-all"
              >
                Try again
              </button>
            </div>
          </div>
          ) : (
          <>
          {/* Tab switcher */}
          <div className="flex mb-6 bg-white/[0.06] rounded-xl p-1 border border-white/[0.08]">
            <button
              onClick={() => switchMode("login")}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                mode === "login"
                  ? "bg-white/[0.12] text-white shadow-sm"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => switchMode("signup")}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                mode === "signup"
                  ? "bg-white/[0.12] text-white shadow-sm"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Google OAuth */}
          <button
            onClick={handleGoogleAuth}
            type="button"
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-white/[0.12] rounded-xl text-sm font-medium text-white bg-white/[0.06] hover:bg-white/[0.10] transition-all"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 border-t border-white/[0.10]"></div>
            <span className="text-sm text-white/30">or</span>
            <div className="flex-1 border-t border-white/[0.10]"></div>
          </div>

          {/* Form */}
          <form className="space-y-4" onSubmit={mode === "login" ? handleLogin : handleSignup}>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-300 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {mode === "signup" && (
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-white/70">
                  Full Name
                </label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2.5 border border-white/[0.12] rounded-xl bg-white/[0.06] text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400/50 text-sm transition-all"
                  placeholder="John Doe"
                />
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
                className="mt-1 block w-full px-3 py-2.5 border border-white/[0.12] rounded-xl bg-white/[0.06] text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400/50 text-sm transition-all"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-white/70">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full px-3 py-2.5 pr-10 border border-white/[0.12] rounded-xl bg-white/[0.06] text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400/50 text-sm transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" /></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
              {mode === "login" && (
                <div className="mt-1 text-right">
                  <Link href="/forgot-password" className="text-xs text-violet-400 hover:text-violet-300">
                    Forgot password?
                  </Link>
                </div>
              )}
            </div>

            {mode === "signup" && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-white/70">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="mt-1 block w-full px-3 py-2.5 pr-10 border border-white/[0.12] rounded-xl bg-white/[0.06] text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400/50 text-sm transition-all"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" /></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl text-sm font-bold text-white focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed relative group overflow-hidden transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]"
              style={{ background: "linear-gradient(135deg, #8b84e0, #6962c4)", boxShadow: "0 4px 16px rgba(105,98,196,0.4)", animation: "btnLift 3s ease-in-out infinite paused" }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 8px 32px rgba(105,98,196,0.6), 0 0 60px rgba(139,132,224,0.3)"; e.currentTarget.style.animationPlayState = "running"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(105,98,196,0.4)"; e.currentTarget.style.animationPlayState = "paused"; }}
            >
              {/* Liquid flowing gradient that activates on hover */}
              <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: "linear-gradient(270deg, #a78bfa, #8b84e0, #6962c4, #3d3580, #8b84e0, #a78bfa)", backgroundSize: "300% 300%", animation: "btnLiquidBg 3s linear infinite" }} />
              
              {/* Dual wave sweeps */}
              <span className="absolute inset-0 rounded-xl overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                <span className="absolute -inset-1 bg-gradient-to-r from-transparent via-white/20 to-transparent w-[40%] h-[120%]" style={{ animation: "btnWaveSweep 2.2s ease-in-out infinite" }} />
              </span>
              <span className="absolute inset-0 rounded-xl overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ animationDelay: "0.8s" }}>
                <span className="absolute -inset-1 bg-gradient-to-r from-transparent via-white/10 to-transparent w-[30%] h-[120%]" style={{ animation: "btnWaveSweep 2.2s ease-in-out infinite", animationDelay: "1s" }} />
              </span>

              {/* Sparkle particles - wrapped so animation doesn't override opacity */}
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                <span className="absolute top-[20%] left-[15%] w-1.5 h-1.5 bg-white rounded-full" style={{ animation: "btnSparkle1 1.8s ease-in-out infinite", animationDelay: "0.2s" }} />
                <span className="absolute top-[60%] left-[75%] w-1 h-1 bg-white rounded-full" style={{ animation: "btnSparkle2 2.2s ease-in-out infinite", animationDelay: "0.6s" }} />
                <span className="absolute top-[30%] left-[55%] w-1 h-1 bg-purple-200 rounded-full" style={{ animation: "btnSparkle3 2s ease-in-out infinite", animationDelay: "1s" }} />
                <span className="absolute top-[70%] left-[30%] w-1 h-1 bg-white rounded-full" style={{ animation: "btnSparkle1 2.5s ease-in-out infinite", animationDelay: "1.4s" }} />
                <span className="absolute top-[40%] left-[88%] w-1.5 h-1.5 bg-purple-100 rounded-full" style={{ animation: "btnSparkle2 1.6s ease-in-out infinite", animationDelay: "0.4s" }} />
                <span className="absolute top-[80%] left-[50%] w-0.5 h-0.5 bg-white rounded-full" style={{ animation: "btnSparkle3 2.8s ease-in-out infinite", animationDelay: "0.9s" }} />
              </span>

              {/* Soft pulsing underglow (no box, just blur) */}
              <span className="absolute -bottom-4 left-[15%] right-[15%] h-8 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-700 pointer-events-none" style={{ background: "radial-gradient(ellipse at center, rgba(139,132,224,0.8), rgba(105,98,196,0.4), transparent)", filter: "blur(12px)", animation: "btnGlowPulse 2s ease-in-out infinite" }} />

              {/* Text with neon glow on hover */}
              <span className="relative z-10 flex justify-center transition-all duration-300 group-hover:tracking-wider group-hover:[text-shadow:0_0_8px_rgba(255,255,255,0.6),0_0_20px_rgba(139,132,224,0.5),0_0_40px_rgba(105,98,196,0.3)]">
              {loading
                ? mode === "login"
                  ? "Signing in..."
                  : "Creating account..."
                : mode === "login"
                ? "Sign in"
                : "Sign up"}
              </span>
            </button>
          </form>
          </>
          )}
                </div>
              </div>
            </div>
          </div>
        </div>


      </div>
    </div>
  );
}

function BrandingSide() {
  return (
    <>
      <div className="flex justify-center mb-8">
        <img src="/images/logo-3.png" alt="Inertia Leads" className="h-16" />
      </div>
      <p className="text-lg text-white/60 mb-12 max-w-md text-center mx-auto">
        AI-Powered Lead Generation & Cold Email Outreach
      </p>

      <div className="space-y-5">
        <div className="flex items-start gap-4 group">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.35))", boxShadow: "0 0 12px rgba(139,92,246,0.15)" }}>
            <svg className="w-5 h-5" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-base text-white">Find Leads Automatically</h3>
            <p className="text-white/40 text-sm mt-1">
              Search by niche & location — we find businesses with emails, phones, and websites instantly.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 group">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.35))", boxShadow: "0 0 12px rgba(139,92,246,0.15)" }}>
            <svg className="w-5 h-5" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-base text-white">AI-Generated Emails</h3>
            <p className="text-white/40 text-sm mt-1">
              Personalized cold emails written by AI — with automated follow-ups that land in inboxes.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 group">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.35))", boxShadow: "0 0 12px rgba(139,92,246,0.15)" }}>
            <svg className="w-5 h-5" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-base text-white">Send on Autopilot</h3>
            <p className="text-white/40 text-sm mt-1">
              Smart inbox rotation, warmup protection, and business-hours scheduling — all handled for you.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 group">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.35))", boxShadow: "0 0 12px rgba(139,92,246,0.15)" }}>
            <svg className="w-5 h-5" style={{ color: "#c4b5fd" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-base text-white">Track Everything</h3>
            <p className="text-white/40 text-sm mt-1">
              Real-time dashboard with sent, replied, and campaign performance stats at a glance.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-12 flex items-center gap-3 text-xs">
        <Link href="/privacy" className="text-white/50 hover:text-white/70 transition-colors">
          Privacy Policy
        </Link>
        <span className="text-white/30">·</span>
        <Link href="/terms" className="text-white/50 hover:text-white/70 transition-colors">
          Terms of Service
        </Link>
      </div>
    </>
  );
}
