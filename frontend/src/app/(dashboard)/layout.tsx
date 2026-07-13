import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import SidebarNav from "./SidebarNav";
import PageTitle from "./PageTitle";
import TrialBadge from "./TrialBadge";
import { PlanProvider } from "./PlanContext";
import GlobalAccessGuard from "./GlobalAccessGuard";

function AvatarDropdown({ displayName, avatarUrl }: { displayName: string; avatarUrl?: string }) {
  const initial = (displayName?.[0] || "U").toUpperCase();

  return (
    <div className="relative group">
      {/* Avatar */}
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={displayName}
          className="w-10 h-10 rounded-xl object-cover cursor-pointer ring-2 ring-transparent group-hover:ring-[#6962c4] transition-all shadow-sm"
        />
      ) : (
        <div className="w-10 h-10 rounded-xl text-white flex items-center justify-center text-sm font-bold cursor-pointer ring-2 ring-transparent group-hover:ring-[#6962c4] transition-all shadow-sm" style={{ background: "linear-gradient(135deg, #3d3580 0%, #6962c4 100%)" }}>
          {initial}
        </div>
      )}

      {/* Dropdown */}
      <div className="absolute right-0 top-full mt-2 w-60 rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden bg-white" style={{ border: "1px solid rgba(61,53,128,0.3)", boxShadow: "0 12px 40px rgba(13,10,37,0.12), 0 0 0 1px rgba(105,98,196,0.08)" }}>
        <div className="px-4 py-3.5" style={{ background: "rgba(105,98,196,0.04)", borderBottom: "1px solid rgba(105,98,196,0.1)" }}>
          <p className="text-sm font-bold truncate" style={{ color: "#1a1540" }}>{displayName}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "#6962c4" }}>Manage your account</p>
        </div>
        <div className="py-2 px-2">
          <Link
            href="/settings"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-[#6962c4]/10"
            style={{ color: "#3d3580" }}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(105,98,196,0.1)" }}>
              <svg className="w-4 h-4" style={{ color: "#6962c4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            Settings
          </Link>
          <div className="mx-3 my-1.5 h-px" style={{ background: "rgba(105,98,196,0.1)" }} />
          <form action={signOut}>
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-red-50"
              style={{ color: "#dc2626" }}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(220,38,38,0.06)" }}>
                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const displayName = user.user_metadata?.full_name || user.email;
  const avatarUrl = user.user_metadata?.avatar_url;

  return (
    <PlanProvider>
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, #f5f3ff 0%, #ede9fe 50%, #f5f3ff 100%)" }}>
      {/* Fixed top header */}
      <header className="fixed top-0 left-64 right-0 h-16 flex items-center justify-between px-8 z-40" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(245,243,255,0.95) 100%)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(105,98,196,0.1)", boxShadow: "0 1px 8px rgba(105,98,196,0.04)" }}>
        {/* Subtle decorative accent line at top */}
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #6962c4 0%, #a78bfa 40%, #6962c4 70%, transparent 100%)" }} />
        <PageTitle />
        <div className="absolute left-1/2 -translate-x-1/2">
          <TrialBadge />
        </div>
        <AvatarDropdown displayName={displayName} avatarUrl={avatarUrl} />
      </header>

      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-64 z-50 overflow-hidden" style={{ background: "linear-gradient(180deg, #0d0a25 0%, #1a1540 40%, #0d0a25 100%)" }}>
        {/* Subtle right edge border */}
        <div className="absolute top-0 right-0 bottom-0 w-px" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(105,98,196,0.3) 30%, rgba(105,98,196,0.15) 70%, transparent 100%)" }} />
        
        {/* Ambient glow blobs */}
        <div className="absolute -top-20 -left-20 w-60 h-60 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(105,98,196,0.15) 0%, transparent 70%)" }} />
        <div className="absolute top-[40%] -right-16 w-48 h-48 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(61,53,128,0.12) 0%, transparent 70%)" }} />
        <div className="absolute -bottom-16 left-[20%] w-52 h-52 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(105,98,196,0.08) 0%, transparent 70%)" }} />

        <div className="relative flex flex-col h-full">
          {/* Brand */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-3">
              <img src="/images/logo-3.png" alt="Inertia Leads" className="h-14" />
            </div>
          </div>

          <div className="mx-5 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(105,98,196,0.3), transparent)" }} />

          <SidebarNav />
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 pt-[88px] p-8">
        <GlobalAccessGuard>{children}</GlobalAccessGuard>
      </main>
    </div>
    </PlanProvider>
  );
}
