"use client";

import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/auto-leads": "Auto Lead Finder",
  "/campaigns": "Campaigns",
  "/inbox": "Inbox",
  "/upload": "Upload Leads",
  "/hot-leads": "Hot Leads",
  "/settings": "Settings",
  "/help": "Help & Support",
  "/user-guide": "User Guide",
};

export default function PageTitle() {
  const pathname = usePathname();

  // Exact match first, then check for dynamic routes like /campaigns/[id]
  const title =
    pageTitles[pathname] ||
    (pathname.startsWith("/campaigns/") ? "Campaign Details" : "Dashboard");

  return (
    <div className="flex items-center gap-3">
      <div className="w-1.5 h-5 rounded-full" style={{ background: "linear-gradient(180deg, #6962c4, #a78bfa)" }} />
      <h2 className="text-base font-semibold tracking-tight" style={{ color: "#1a1540" }}>{title}</h2>
    </div>
  );
}
