"use client";

import { usePathname } from "next/navigation";
import FeatureAccessGuard from "./FeatureAccessGuard";

// Pages that must stay reachable even when the trial/subscription is inactive,
// so the user can actually pay or get help. Everything else is locked once the
// 7-day free trial expires (or the subscription lapses).
const EXEMPT_PREFIXES = ["/settings", "/help", "/user-guide"];

export default function GlobalAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isExempt = EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );

  if (isExempt) {
    return <>{children}</>;
  }

  return <FeatureAccessGuard>{children}</FeatureAccessGuard>;
}
