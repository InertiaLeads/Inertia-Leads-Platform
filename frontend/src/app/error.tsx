"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // React handles anything an error boundary catches, so it never reaches
    // window.onerror and Sentry's global handler never sees it. Report explicitly
    // or these errors are lost — global-error.tsx only covers root layout crashes.
    Sentry.captureException(error);
    console.error("Global error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0d0a25" }}>
      <div className="text-center max-w-md px-6">
        <h2 className="text-2xl font-bold text-white mb-2">
          Something went wrong
        </h2>
        <p className="text-white/60 mb-6">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          className="px-5 py-2.5 bg-violet-600 text-white font-medium rounded-lg hover:bg-violet-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
