// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://aedbc98b2e27f4908045d4d422fa2f41@o4512027705737216.ingest.us.sentry.io/4512027738505216",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Trace everything locally, 10% in production. At 100% a moderately busy app
  // exhausts the span quota quickly, and performance data is statistical anyway —
  // a 10% sample answers the same questions.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  // Replays of ERROR-FREE sessions are off in production: they are the expensive
  // part of the quota (50/month on the free plan) and rarely get watched. Raise
  // this if you specifically want to study normal user behaviour.
  replaysSessionSampleRate: process.env.NODE_ENV === "production" ? 0 : 0.1,

  // Every session that errors is recorded. This is the replay data worth having.
  replaysOnErrorSampleRate: 1.0,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
